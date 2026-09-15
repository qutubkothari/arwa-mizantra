import { BadRequestException, Injectable } from "@nestjs/common";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

@Injectable()
export class ProjectPerformanceService {
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

  private metrics(snapshot: any) {
    const budget = this.number(snapshot.budget_at_completion);
    const planned = this.number(snapshot.planned_value);
    const earned = this.number(snapshot.earned_value);
    const actual = this.number(snapshot.actual_cost);
    const contract =
      this.number(snapshot.contract_value) +
      this.number(snapshot.approved_change_orders);
    const cpi = actual > 0 ? earned / actual : earned > 0 ? 1 : 0;
    const spi = planned > 0 ? earned / planned : earned > 0 ? 1 : 0;
    const eac =
      cpi > 0
        ? budget / cpi
        : Math.max(budget, actual + this.number(snapshot.committed_cost));
    const baselineMargin = contract - budget;
    const projectedMargin = contract - eac;
    return {
      cost_variance: earned - actual,
      schedule_variance: earned - planned,
      cpi,
      spi,
      estimate_at_completion: eac,
      estimate_to_complete: Math.max(0, eac - actual),
      variance_at_completion: budget - eac,
      baseline_margin: baselineMargin,
      projected_margin: projectedMargin,
      margin_leakage: Math.max(0, baselineMargin - projectedMargin),
      unbilled_earned_value: Math.max(
        0,
        earned - this.number(snapshot.billed_value),
      ),
      collection_gap: Math.max(
        0,
        this.number(snapshot.billed_value) -
          this.number(snapshot.cash_collected),
      ),
    };
  }

  private async recoveryAction(tenantId: string, id: string) {
    const { data, error } = await this.db
      .from("project_margin_recovery_actions")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    if (error || !data) this.fail(error, "Project recovery action not found.");
    return data;
  }

  async dashboard(tenantId: string) {
    const [projectsResult, snapshotsResult, actionsResult] = await Promise.all([
      this.db
        .from("projects")
        .select("id,project_code,project_name,department,status")
        .eq("tenant_id", tenantId)
        .order("project_code"),
      this.db
        .from("project_control_snapshots")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("as_of_date", { ascending: false }),
      this.db
        .from("project_margin_recovery_actions")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false }),
    ]);
    if (projectsResult.error)
      this.fail(projectsResult.error, "Unable to load projects.");
    if (snapshotsResult.error)
      this.fail(snapshotsResult.error, "Unable to load project snapshots.");
    if (actionsResult.error)
      this.fail(actionsResult.error, "Unable to load recovery actions.");
    const projects = projectsResult.data || [];
    const projectMap = new Map(
      projects.map((row: any) => [String(row.id), row]),
    );
    const latest = new Map<string, any>();
    for (const snapshot of snapshotsResult.data || [])
      if (!latest.has(String(snapshot.project_id)))
        latest.set(String(snapshot.project_id), snapshot);
    const performance = projects
      .map((project: any) => {
        const snapshot = latest.get(String(project.id));
        return snapshot
          ? { project, snapshot, ...this.metrics(snapshot) }
          : { project, snapshot: null };
      })
      .sort(
        (a: any, b: any) =>
          this.number(b.margin_leakage) - this.number(a.margin_leakage),
      );
    const actions = (actionsResult.data || []).map((row: any) => ({
      ...row,
      project: projectMap.get(String(row.project_id)),
    }));
    const measured = performance.filter((row: any) => row.snapshot);
    return {
      kpis: {
        controlled_projects: measured.length,
        margin_leakage: measured.reduce(
          (sum: number, row: any) => sum + this.number(row.margin_leakage),
          0,
        ),
        forecast_cost_overrun: measured.reduce(
          (sum: number, row: any) =>
            sum + Math.max(0, -this.number(row.variance_at_completion)),
          0,
        ),
        unbilled_value: measured.reduce(
          (sum: number, row: any) =>
            sum + this.number(row.unbilled_earned_value),
          0,
        ),
        collection_gap: measured.reduce(
          (sum: number, row: any) => sum + this.number(row.collection_gap),
          0,
        ),
        verified_recovery: actions
          .filter((row: any) => row.status === "VERIFIED")
          .reduce(
            (sum: number, row: any) =>
              sum +
              this.number(row.realized_margin_recovery) +
              this.number(row.realized_cash_acceleration),
            0,
          ),
      },
      projects,
      performance,
      actions,
    };
  }

  async snapshot(tenantId: string, userId: string, body: any) {
    const projectId = this.text(body.project_id);
    const date = this.text(body.as_of_date);
    const budget = this.number(body.budget_at_completion);
    const evidence = this.text(body.evidence_reference);
    if (
      !projectId ||
      !date ||
      date > new Date().toISOString().slice(0, 10) ||
      budget <= 0 ||
      !evidence
    )
      this.fail(
        null,
        "Project, non-future date, positive budget and evidence are required.",
      );
    const numericFields = [
      "planned_value",
      "earned_value",
      "actual_cost",
      "committed_cost",
      "contract_value",
      "billed_value",
      "cash_collected",
    ];
    if (numericFields.some((field) => this.number(body[field]) < 0))
      this.fail(null, "Project control values cannot be negative.");
    const { data, error } = await this.db
      .from("project_control_snapshots")
      .upsert(
        {
          tenant_id: tenantId,
          project_id: projectId,
          as_of_date: date,
          budget_at_completion: budget,
          planned_value: this.number(body.planned_value),
          earned_value: this.number(body.earned_value),
          actual_cost: this.number(body.actual_cost),
          committed_cost: this.number(body.committed_cost),
          contract_value: this.number(body.contract_value),
          approved_change_orders: this.number(body.approved_change_orders),
          billed_value: this.number(body.billed_value),
          cash_collected: this.number(body.cash_collected),
          evidence_reference: evidence,
          created_by: userId,
        },
        { onConflict: "tenant_id,project_id,as_of_date" },
      )
      .select()
      .single();
    if (error) this.fail(error, "Unable to save project control snapshot.");
    return { ...data, ...this.metrics(data) };
  }

  async action(tenantId: string, userId: string, body: any) {
    const category = this.text(body.issue_category).toUpperCase();
    const description = this.text(body.action_description);
    const owner = this.text(body.owner_reference);
    const dueDate = this.text(body.due_date);
    if (
      !this.text(body.project_id) ||
      ![
        "COST",
        "SCHEDULE",
        "SCOPE",
        "BILLING",
        "COLLECTION",
        "PROCUREMENT",
        "CHANGE_ORDER",
      ].includes(category) ||
      !description ||
      !owner ||
      !dueDate
    )
      this.fail(
        null,
        "Project, issue category, action, owner and due date are required.",
      );
    const { data, error } = await this.db
      .from("project_margin_recovery_actions")
      .insert({
        tenant_id: tenantId,
        project_id: body.project_id,
        snapshot_id: body.snapshot_id || null,
        issue_category: category,
        action_description: description,
        owner_reference: owner,
        due_date: dueDate,
        target_margin_recovery: this.number(body.target_margin_recovery),
        target_cash_acceleration: this.number(body.target_cash_acceleration),
        created_by: userId,
      })
      .select()
      .single();
    if (error) this.fail(error, "Unable to propose project recovery action.");
    return data;
  }

  async approve(tenantId: string, userId: string, id: string, body: any) {
    const row = await this.recoveryAction(tenantId, id);
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
      "Unable to approve recovery action.",
    );
  }

  async execute(tenantId: string, userId: string, id: string, body: any) {
    const row = await this.recoveryAction(tenantId, id);
    const evidence = this.text(body.execution_evidence);
    if (row.status !== "APPROVED" || !evidence)
      this.fail(
        null,
        "Approved recovery action and execution evidence are required.",
      );
    return this.transition(
      tenantId,
      id,
      "APPROVED",
      {
        status: "EXECUTED",
        execution_evidence: evidence,
        executed_by: userId,
        executed_at: new Date().toISOString(),
      },
      "Unable to record recovery execution.",
    );
  }

  async verify(tenantId: string, userId: string, id: string, body: any) {
    const row = await this.recoveryAction(tenantId, id);
    const evidence = this.text(body.verification_evidence);
    const margin = this.number(body.realized_margin_recovery);
    const cash = this.number(body.realized_cash_acceleration);
    if (
      row.status !== "EXECUTED" ||
      row.executed_by === userId ||
      !evidence ||
      margin < 0 ||
      cash < 0
    )
      this.fail(
        null,
        "Independent verification, evidence and non-negative realized benefits are required.",
      );
    return this.transition(
      tenantId,
      id,
      "EXECUTED",
      {
        status: "VERIFIED",
        verification_evidence: evidence,
        realized_margin_recovery: margin,
        realized_cash_acceleration: cash,
        verified_by: userId,
        verified_at: new Date().toISOString(),
      },
      "Unable to verify project recovery.",
    );
  }

  private async transition(
    tenantId: string,
    id: string,
    status: string,
    values: any,
    message: string,
  ) {
    const { data, error } = await this.db
      .from("project_margin_recovery_actions")
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
