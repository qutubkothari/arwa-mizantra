import { BadRequestException, Injectable } from "@nestjs/common";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

@Injectable()
export class ContinuousControlsService {
  private readonly db: SupabaseClient = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!,
  );
  private fail(error: any, message: string): never {
    throw new BadRequestException(error?.message || message);
  }
  private text(value: any) {
    return String(value || "").trim();
  }
  private number(value: any) {
    const result = Number(value || 0);
    return Number.isFinite(result) ? result : 0;
  }

  private async remediation(tenantId: string, id: string) {
    const { data, error } = await this.db
      .from("control_remediation_actions")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    if (error || !data)
      this.fail(error, "Control remediation action not found.");
    return data;
  }

  private async ensureDefaults(tenantId: string, userId: string) {
    const defaults = [
      {
        control_code: "POSTER_INDEPENDENCE",
        control_name: "Journal preparer and poster independence",
        severity: "CRITICAL",
        parameters: {},
      },
      {
        control_code: "POSTED_BALANCE",
        control_name: "Posted journal balance integrity",
        severity: "CRITICAL",
        parameters: {},
      },
      {
        control_code: "DUPLICATE_SOURCE_POSTING",
        control_name: "Duplicate operational source posting",
        severity: "HIGH",
        parameters: {},
      },
      {
        control_code: "HIGH_VALUE_MANUAL",
        control_name: "High-value manual journal review",
        severity: "HIGH",
        parameters: { threshold: 100000 },
      },
    ];
    const { error } = await this.db
      .from("continuous_control_definitions")
      .upsert(
        defaults.map((row) => ({
          ...row,
          tenant_id: tenantId,
          control_type: "DETECTIVE",
          is_active: true,
          created_by: userId,
        })),
        { onConflict: "tenant_id,control_code", ignoreDuplicates: true },
      );
    if (error) this.fail(error, "Unable to initialize continuous controls.");
  }

  async dashboard(tenantId: string) {
    const [definitionsResult, findingsResult, actionsResult] =
      await Promise.all([
        this.db
          .from("continuous_control_definitions")
          .select("*")
          .eq("tenant_id", tenantId)
          .order("control_code"),
        this.db
          .from("continuous_control_findings")
          .select("*")
          .eq("tenant_id", tenantId)
          .order("detected_at", { ascending: false })
          .limit(500),
        this.db
          .from("control_remediation_actions")
          .select("*")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false }),
      ]);
    if (definitionsResult.error)
      this.fail(definitionsResult.error, "Unable to load control definitions.");
    if (findingsResult.error)
      this.fail(findingsResult.error, "Unable to load control findings.");
    if (actionsResult.error)
      this.fail(actionsResult.error, "Unable to load remediation actions.");
    const definitions = definitionsResult.data || [];
    const findings = findingsResult.data || [];
    const findingMap = new Map(
      findings.map((row: any) => [String(row.id), row]),
    );
    const actions = (actionsResult.data || []).map((row: any) => ({
      ...row,
      finding: findingMap.get(String(row.finding_id)),
    }));
    const open = findings.filter((row: any) =>
      ["OPEN", "ACCEPTED", "REMEDIATED"].includes(row.status),
    );
    return {
      kpis: {
        active_controls: definitions.filter((row: any) => row.is_active).length,
        open_findings: open.length,
        critical_findings: open.filter(
          (row: any) => row.severity === "CRITICAL",
        ).length,
        exposure_amount: open.reduce(
          (sum: number, row: any) => sum + this.number(row.exposure_amount),
          0,
        ),
        approved_prevention_pipeline: actions
          .filter((row: any) => ["APPROVED", "EXECUTED"].includes(row.status))
          .reduce(
            (sum: number, row: any) =>
              sum + this.number(row.target_loss_prevention),
            0,
          ),
        verified_loss_prevention: actions
          .filter((row: any) => row.status === "VERIFIED")
          .reduce(
            (sum: number, row: any) =>
              sum + this.number(row.realized_loss_prevention),
            0,
          ),
      },
      definitions,
      findings,
      actions,
    };
  }

  async scan(tenantId: string, userId: string) {
    await this.ensureDefaults(tenantId, userId);
    const since = new Date(Date.now() - 180 * 86400000)
      .toISOString()
      .slice(0, 10);
    const [
      { data: definitions, error: definitionError },
      { data: journals, error: journalError },
    ] = await Promise.all([
      this.db
        .from("continuous_control_definitions")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("is_active", true),
      this.db
        .from("accounting_journals")
        .select(
          "id,journal_number,journal_date,source_type,source_id,status,total_debit,total_credit,created_by,posted_by",
        )
        .eq("tenant_id", tenantId)
        .gte("journal_date", since)
        .eq("status", "POSTED"),
    ]);
    if (definitionError)
      this.fail(definitionError, "Unable to load active controls.");
    if (journalError)
      this.fail(journalError, "Unable to scan posted journals.");
    const definitionMap = new Map(
      (definitions || []).map((row: any) => [row.control_code, row]),
    );
    const findings: any[] = [];
    const add = (
      code: string,
      journal: any,
      summary: string,
      exposure: number,
      suffix = "",
    ) => {
      const definition: any = definitionMap.get(code);
      if (!definition) return;
      findings.push({
        tenant_id: tenantId,
        control_code: code,
        severity: definition.severity,
        source_table: "accounting_journals",
        source_id: String(journal.id),
        source_reference: journal.journal_number,
        fingerprint: `${code}:${journal.id}${suffix}`,
        finding_summary: summary,
        exposure_amount: Math.max(0, exposure),
        scan_evidence: {
          journal_date: journal.journal_date,
          source_type: journal.source_type,
          source_id: journal.source_id,
        },
      });
    };
    const sourceGroups = new Map<string, any[]>();
    for (const journal of journals || []) {
      if (
        journal.created_by &&
        journal.posted_by &&
        journal.created_by === journal.posted_by
      )
        add(
          "POSTER_INDEPENDENCE",
          journal,
          "The same user prepared and posted this journal.",
          this.number(journal.total_debit),
        );
      if (
        Math.abs(
          this.number(journal.total_debit) - this.number(journal.total_credit),
        ) > 0.005
      )
        add(
          "POSTED_BALANCE",
          journal,
          "Posted debit and credit totals are not balanced.",
          Math.abs(
            this.number(journal.total_debit) -
              this.number(journal.total_credit),
          ),
        );
      const threshold = this.number(
        (definitionMap.get("HIGH_VALUE_MANUAL") as any)?.parameters
          ?.threshold || 100000,
      );
      if (
        (!journal.source_type || journal.source_type === "MANUAL") &&
        this.number(journal.total_debit) >= threshold
      )
        add(
          "HIGH_VALUE_MANUAL",
          journal,
          `Manual journal exceeds the AED ${threshold.toFixed(0)} review threshold.`,
          this.number(journal.total_debit),
        );
      if (journal.source_type && journal.source_id) {
        const key = `${journal.source_type}:${journal.source_id}`;
        const group = sourceGroups.get(key) || [];
        group.push(journal);
        sourceGroups.set(key, group);
      }
    }
    for (const [key, group] of sourceGroups)
      if (group.length > 1)
        for (const journal of group.slice(1))
          add(
            "DUPLICATE_SOURCE_POSTING",
            journal,
            `Multiple posted journals reference operational source ${key}.`,
            this.number(journal.total_debit),
            `:${key}`,
          );
    if (findings.length) {
      const { error } = await this.db
        .from("continuous_control_findings")
        .upsert(findings, {
          onConflict: "tenant_id,fingerprint",
          ignoreDuplicates: true,
        });
      if (error)
        this.fail(error, "Unable to persist continuous-control findings.");
    }
    return this.dashboard(tenantId);
  }

  async definition(tenantId: string, userId: string, body: any) {
    const code = this.text(body.control_code).toUpperCase();
    const name = this.text(body.control_name);
    const severity = this.text(body.severity || "HIGH").toUpperCase();
    if (
      ![
        "POSTER_INDEPENDENCE",
        "POSTED_BALANCE",
        "DUPLICATE_SOURCE_POSTING",
        "HIGH_VALUE_MANUAL",
      ].includes(code) ||
      !name ||
      !["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(severity)
    )
      this.fail(
        null,
        "Supported control code, name and severity are required.",
      );
    const { data, error } = await this.db
      .from("continuous_control_definitions")
      .upsert(
        {
          tenant_id: tenantId,
          control_code: code,
          control_name: name,
          control_type: "DETECTIVE",
          severity,
          parameters:
            code === "HIGH_VALUE_MANUAL"
              ? { threshold: this.number(body.threshold) }
              : {},
          is_active: body.is_active !== false,
          created_by: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id,control_code" },
      )
      .select()
      .single();
    if (error) this.fail(error, "Unable to save control definition.");
    return data;
  }

  async action(tenantId: string, userId: string, body: any) {
    const findingId = this.text(body.finding_id);
    const description = this.text(body.action_description);
    const owner = this.text(body.owner_reference);
    const due = this.text(body.due_date);
    const { data: finding } = await this.db
      .from("continuous_control_findings")
      .select("id,exposure_amount,status")
      .eq("tenant_id", tenantId)
      .eq("id", findingId)
      .maybeSingle();
    if (
      !finding ||
      !["OPEN", "ACCEPTED"].includes(finding.status) ||
      !description ||
      !owner ||
      !due
    )
      this.fail(
        null,
        "Open finding, remediation, owner and due date are required.",
      );
    const { data, error } = await this.db
      .from("control_remediation_actions")
      .insert({
        tenant_id: tenantId,
        finding_id: findingId,
        action_description: description,
        owner_reference: owner,
        due_date: due,
        target_loss_prevention: this.number(
          body.target_loss_prevention || finding.exposure_amount,
        ),
        created_by: userId,
      })
      .select()
      .single();
    if (error) this.fail(error, "Unable to propose remediation action.");
    return data;
  }

  async approve(tenantId: string, userId: string, id: string, body: any) {
    const row = await this.remediation(tenantId, id);
    const note = this.text(body.approval_note);
    if (row.status !== "PROPOSED" || row.created_by === userId || !note)
      this.fail(null, "Independent approval with rationale is required.");
    return this.transition(
      tenantId,
      id,
      "PROPOSED",
      {
        status: "APPROVED",
        approval_note: note,
        approved_by: userId,
        approved_at: new Date().toISOString(),
      },
      "Unable to approve remediation.",
    );
  }
  async execute(tenantId: string, userId: string, id: string, body: any) {
    const row = await this.remediation(tenantId, id);
    const evidence = this.text(body.execution_evidence);
    if (row.status !== "APPROVED" || !evidence)
      this.fail(
        null,
        "Approved remediation and execution evidence are required.",
      );
    const result = await this.transition(
      tenantId,
      id,
      "APPROVED",
      {
        status: "EXECUTED",
        execution_evidence: evidence,
        executed_by: userId,
        executed_at: new Date().toISOString(),
      },
      "Unable to record remediation execution.",
    );
    await this.db
      .from("continuous_control_findings")
      .update({ status: "REMEDIATED" })
      .eq("tenant_id", tenantId)
      .eq("id", row.finding_id);
    return result;
  }
  async verify(tenantId: string, userId: string, id: string, body: any) {
    const row = await this.remediation(tenantId, id);
    const evidence = this.text(body.verification_evidence);
    const realized = this.number(body.realized_loss_prevention);
    if (
      row.status !== "EXECUTED" ||
      row.executed_by === userId ||
      !evidence ||
      realized < 0
    )
      this.fail(
        null,
        "Independent verification, evidence and non-negative loss prevention are required.",
      );
    const result = await this.transition(
      tenantId,
      id,
      "EXECUTED",
      {
        status: "VERIFIED",
        verification_evidence: evidence,
        realized_loss_prevention: realized,
        verified_by: userId,
        verified_at: new Date().toISOString(),
      },
      "Unable to verify remediation.",
    );
    await this.db
      .from("continuous_control_findings")
      .update({ status: "VERIFIED" })
      .eq("tenant_id", tenantId)
      .eq("id", row.finding_id);
    return result;
  }

  private async transition(
    tenantId: string,
    id: string,
    status: string,
    values: any,
    message: string,
  ) {
    const { data, error } = await this.db
      .from("control_remediation_actions")
      .update({ ...values, updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .eq("status", status)
      .select()
      .maybeSingle();
    if (error || !data) this.fail(error, message);
    return data;
  }
}
