import { BadRequestException, Injectable } from "@nestjs/common";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { DuplicateDetectionService } from "../common/services/duplicate-detection.service";

type EntityType =
  | "CUSTOMER"
  | "SUPPLIER"
  | "ITEM"
  | "BANK_ACCOUNT"
  | "TAX_CODE"
  | "GL_ACCOUNT";
type Operation = "CREATE" | "UPDATE" | "DEACTIVATE";
type EntityConfig = {
  table: string;
  exact: string[];
  fuzzy: string[];
  required: string[];
  allowed: string[];
};

const CONFIG: Record<EntityType, EntityConfig> = {
  CUSTOMER: {
    table: "customers",
    exact: ["customer_code", "email", "phone", "gst_number"],
    fuzzy: ["customer_name"],
    required: ["customer_code", "customer_name"],
    allowed: [
      "customer_code",
      "customer_name",
      "customer_type",
      "contact_person",
      "email",
      "phone",
      "mobile",
      "gst_number",
      "pan_number",
      "billing_address",
      "shipping_address",
      "city",
      "state",
      "country",
      "pincode",
      "credit_limit",
      "credit_days",
      "is_active",
    ],
  },
  SUPPLIER: {
    table: "vendors",
    exact: ["code", "email", "phone", "tax_id", "gst_number", "bank_account"],
    fuzzy: ["name", "legal_name"],
    required: ["code", "name"],
    allowed: [
      "code",
      "name",
      "legal_name",
      "tax_id",
      "category",
      "rating",
      "payment_terms",
      "credit_limit",
      "contact_person",
      "email",
      "phone",
      "address",
      "city",
      "state",
      "country",
      "pincode",
      "bank_name",
      "bank_account",
      "bank_ifsc",
      "gst_number",
      "pan_number",
      "is_active",
      "metadata",
    ],
  },
  ITEM: {
    table: "items",
    exact: ["code"],
    fuzzy: ["name"],
    required: ["code", "name"],
    allowed: [
      "code",
      "name",
      "description",
      "category",
      "uom",
      "reorder_level",
      "min_stock",
      "max_stock",
      "standard_cost",
      "uid_tracking",
      "uid_strategy",
      "is_active",
      "metadata",
    ],
  },
  BANK_ACCOUNT: {
    table: "accounting_bank_accounts",
    exact: ["account_number_masked"],
    fuzzy: ["bank_name", "account_name"],
    required: ["account_id", "bank_name"],
    allowed: [
      "account_id",
      "bank_name",
      "account_name",
      "account_number_masked",
      "ifsc_or_swift",
      "currency_code",
      "opening_balance",
      "is_active",
    ],
  },
  TAX_CODE: {
    table: "accounting_tax_codes",
    exact: ["tax_code"],
    fuzzy: ["tax_name"],
    required: ["tax_code", "tax_name", "tax_type"],
    allowed: [
      "tax_code",
      "tax_name",
      "tax_type",
      "rate",
      "input_account_id",
      "output_account_id",
      "is_active",
    ],
  },
  GL_ACCOUNT: {
    table: "accounting_accounts",
    exact: ["account_code"],
    fuzzy: ["account_name"],
    required: ["account_code", "account_name", "account_type"],
    allowed: [
      "account_code",
      "account_name",
      "account_type",
      "parent_id",
      "is_control_account",
      "currency_code",
      "opening_debit",
      "opening_credit",
      "is_active",
    ],
  },
};

@Injectable()
export class MasterDataGovernanceService {
  private readonly db: SupabaseClient = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!,
  );
  constructor(private readonly duplicates: DuplicateDetectionService) {}
  private fail(
    error: any,
    fallback = "Master-data governance request failed.",
  ): never {
    throw new BadRequestException(error?.message || fallback);
  }
  private hash(value: any) {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }
  private config(type: any): EntityConfig {
    const c = CONFIG[String(type || "").toUpperCase() as EntityType];
    if (!c)
      this.fail({
        message:
          "Supported entity types are CUSTOMER, SUPPLIER, ITEM, BANK_ACCOUNT, TAX_CODE and GL_ACCOUNT.",
      });
    return c;
  }
  private pick(data: any, fields: string[]) {
    return Object.fromEntries(
      Object.entries(data || {}).filter(
        ([k, v]) => fields.includes(k) && v !== undefined,
      ),
    );
  }
  private readonly slaDefaults: any = {
    PREPARE: {
      target_hours: 24,
      reminder_before_hours: 4,
      escalation_after_hours: 4,
      role: "JOURNAL_PREPARER",
    },
    REVIEW: {
      target_hours: 24,
      reminder_before_hours: 4,
      escalation_after_hours: 4,
      role: "JOURNAL_REVIEWER",
    },
    APPROVE: {
      target_hours: 24,
      reminder_before_hours: 4,
      escalation_after_hours: 4,
      role: "JOURNAL_APPROVER",
    },
    POST: {
      target_hours: 8,
      reminder_before_hours: 2,
      escalation_after_hours: 2,
      role: "JOURNAL_POSTER",
    },
  };

  private stage(row: any) {
    return row.status === "DRAFT"
      ? "PREPARE"
      : row.status === "SUBMITTED"
        ? "REVIEW"
        : row.status === "REVIEWED"
          ? "APPROVE"
          : row.status === "APPROVED"
            ? "POST"
            : null;
  }
  private stageStartedAt(row: any, stage: string) {
    return stage === "PREPARE"
      ? row.prepared_at
      : stage === "REVIEW"
        ? row.reviewed_at || row.updated_at
        : stage === "APPROVE"
          ? row.approved_at || row.updated_at
          : row.approved_at || row.updated_at;
  }
  async evaluateSla(tenantId: string, persist = false) {
    const [requestResult, policyResult] = await Promise.all([
      this.db
        .from("master_data_change_requests")
        .select("*")
        .eq("tenant_id", tenantId)
        .in("status", ["DRAFT", "SUBMITTED", "REVIEWED", "APPROVED"]),
      this.db
        .from("master_data_governance_sla_policies")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("is_active", true),
    ]);
    if (requestResult.error || policyResult.error)
      this.fail(
        requestResult.error || policyResult.error,
        "Unable to evaluate governance SLA.",
      );
    const policies = Object.fromEntries(
      (policyResult.data || []).map((x: any) => [
        x.stage,
        { ...this.slaDefaults[x.stage], ...x },
      ]),
    );
    const now = Date.now(),
      signals: any[] = [];
    for (const row of requestResult.data || []) {
      const stage = this.stage(row);
      if (!stage) continue;
      const policy = policies[stage] || this.slaDefaults[stage];
      const started = new Date(this.stageStartedAt(row, stage)).getTime();
      const dueAt = new Date(started + Number(policy.target_hours) * 3600000);
      const reminderAt = new Date(
        dueAt.getTime() - Number(policy.reminder_before_hours) * 3600000,
      );
      const escalationAt = new Date(
        dueAt.getTime() + Number(policy.escalation_after_hours) * 3600000,
      );
      const type =
        now >= escalationAt.getTime()
          ? "ESCALATION"
          : now >= reminderAt.getTime()
            ? "REMINDER"
            : null;
      signals.push({
        request_id: row.id,
        request_number: row.request_number,
        stage,
        due_at: dueAt.toISOString(),
        reminder_at: reminderAt.toISOString(),
        escalation_at: escalationAt.toISOString(),
        recipient_role: policy.role,
        state:
          now >= escalationAt.getTime()
            ? "ESCALATED"
            : now >= dueAt.getTime()
              ? "OVERDUE"
              : now >= reminderAt.getTime()
                ? "DUE_SOON"
                : "ON_TRACK",
        notification_type: type,
      });
    }
    if (persist) {
      for (const signal of signals.filter((x) => x.notification_type)) {
        const { error } = await this.db
          .from("master_data_governance_sla_notifications")
          .upsert(
            {
              tenant_id: tenantId,
              request_id: signal.request_id,
              stage: signal.stage,
              notification_type: signal.notification_type,
              recipient_role: signal.recipient_role,
              due_at: signal.due_at,
              details: signal,
            },
            {
              onConflict: "tenant_id,request_id,stage,notification_type",
              ignoreDuplicates: true,
            },
          );
        if (error)
          this.fail(error, "Unable to record governance SLA notification.");
      }
    }
    return {
      signals,
      summary: {
        due_soon: signals.filter((x) => x.state === "DUE_SOON").length,
        overdue: signals.filter((x) => x.state === "OVERDUE").length,
        escalated: signals.filter((x) => x.state === "ESCALATED").length,
      },
    };
  }

  private async assertWorkflowAssignment(
    tenantId: string,
    userId: string,
    role: string,
  ) {
    const { data, error } = await this.db
      .from("accounting_workflow_role_assignments")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("workflow_role", role)
      .eq("is_active", true);
    if (error) this.fail(error, "Unable to verify governance workflow role.");
    if (
      (data || []).length &&
      !(data || []).some((row: any) => row.user_id === userId)
    )
      this.fail({
        message: `You are not assigned as ${role.replace("JOURNAL_", "master-data ").replaceAll("_", " ").toLowerCase()} for this company.`,
      });
  }

  async dashboard(tenantId: string, userId?: string) {
    const [requestResult, settingResult, bypassResult, rolesResult] =
      await Promise.all([
        this.db
          .from("master_data_change_requests")
          .select("*")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false })
          .limit(100),
        this.db
          .from("master_data_governance_settings")
          .select("*")
          .eq("tenant_id", tenantId)
          .maybeSingle(),
        this.db
          .from("master_data_bypass_attempts")
          .select("*")
          .eq("tenant_id", tenantId)
          .order("blocked_at", { ascending: false })
          .limit(20),
        this.db
          .from("accounting_workflow_role_assignments")
          .select("user_id,workflow_role")
          .eq("tenant_id", tenantId)
          .eq("is_active", true)
          .in("workflow_role", [
            "JOURNAL_PREPARER",
            "JOURNAL_REVIEWER",
            "JOURNAL_APPROVER",
            "JOURNAL_POSTER",
          ]),
      ]);
    if (
      requestResult.error ||
      settingResult.error ||
      bypassResult.error ||
      rolesResult.error
    )
      this.fail(
        requestResult.error ||
          settingResult.error ||
          bypassResult.error ||
          rolesResult.error,
      );
    const rows = requestResult.data || [],
      bypass = bypassResult.data || [],
      roles = rolesResult.data || [];
    const has = (role: string) =>
      !roles.some((x: any) => x.workflow_role === role) ||
      roles.some((x: any) => x.workflow_role === role && x.user_id === userId);
    const worklist = {
      prepare: rows.filter(
        (x: any) =>
          x.status === "DRAFT" &&
          x.prepared_by === userId &&
          has("JOURNAL_PREPARER"),
      ),
      review: rows.filter(
        (x: any) =>
          x.status === "SUBMITTED" &&
          x.prepared_by !== userId &&
          has("JOURNAL_REVIEWER"),
      ),
      approve: rows.filter(
        (x: any) =>
          x.status === "REVIEWED" &&
          ![x.prepared_by, x.reviewed_by].includes(userId) &&
          has("JOURNAL_APPROVER"),
      ),
      post: rows.filter(
        (x: any) =>
          x.status === "APPROVED" &&
          ![x.prepared_by, x.reviewed_by, x.approved_by].includes(userId) &&
          has("JOURNAL_POSTER"),
      ),
    };
    const sla = await this.evaluateSla(tenantId);
    return {
      enforcement: {
        enabled: Boolean(settingResult.data?.enforcement_enabled),
        enabled_at: settingResult.data?.enabled_at || null,
      },
      workflow: {
        configured: roles.length > 0,
        roles: [
          ...new Set(
            roles
              .filter((x: any) => x.user_id === userId)
              .map((x: any) => x.workflow_role),
          ),
        ],
        actionable_count: Object.values(worklist).reduce(
          (n: any, x: any) => n + x.length,
          0,
        ),
        worklist,
      },
      sla,
      totals: {
        all: rows.length,
        pending: rows.filter((x: any) =>
          ["DRAFT", "SUBMITTED", "REVIEWED", "APPROVED"].includes(x.status),
        ).length,
        high_risk: rows.filter(
          (x: any) =>
            Number(x.risk_score) >= 70 &&
            !["APPLIED", "REJECTED"].includes(x.status),
        ).length,
        applied: rows.filter((x: any) => x.status === "APPLIED").length,
        duplicates_flagged: rows.filter(
          (x: any) => (x.duplicate_findings || []).length > 0,
        ).length,
        bypass_attempts: bypass.length,
      },
      requests: rows,
      bypass_attempts: bypass,
    };
  }
  async requests(tenantId: string, userId?: string) {
    return (await this.dashboard(tenantId, userId)).requests;
  }
  async request(tenantId: string, id: string) {
    const { data, error } = await this.db
      .from("master_data_change_requests")
      .select("*,events:master_data_change_events(*)")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    if (error || !data) this.fail(error, "Change request not found.");
    data.events = (data.events || []).sort((a: any, b: any) =>
      String(a.created_at).localeCompare(String(b.created_at)),
    );
    return data;
  }

  private async analyse(
    tenantId: string,
    type: EntityType,
    operation: Operation,
    targetId: string | null,
    proposed: any,
  ) {
    const cfg = this.config(type);
    let snapshot: any = null;
    if (operation !== "CREATE") {
      if (!targetId)
        this.fail({
          message: "Target ID is required for update or deactivation.",
        });
      const r = await this.db
        .from(cfg.table)
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("id", targetId)
        .maybeSingle();
      if (r.error || !r.data)
        this.fail(r.error, "Target master record not found.");
      snapshot = r.data;
    }
    const candidate = { ...(snapshot || {}), ...proposed };
    const existing = await this.db
      .from(cfg.table)
      .select("*")
      .eq("tenant_id", tenantId)
      .limit(5000);
    if (existing.error) this.fail(existing.error);
    const duplicate = await this.duplicates.checkDuplicates(
      candidate,
      existing.data || [],
      {
        exactMatchFields: cfg.exact,
        fuzzyMatchFields: cfg.fuzzy,
        fuzzyThreshold: 0.25,
        excludeId: targetId || undefined,
      },
    );
    const findings = [
      ...duplicate.exactMatches,
      ...duplicate.fuzzyMatches.filter(
        (x) => !duplicate.exactMatches.some((y) => y.id === x.id),
      ),
    ].map((x) => ({
      id: x.id,
      score: x.matchScore,
      fields: x.matchedFields,
      record: Object.fromEntries(
        [...cfg.exact, ...cfg.fuzzy].map((k) => [k, x.data?.[k]]),
      ),
    }));
    const impact = await this.impact(tenantId, type, targetId);
    const sensitive = [
      "bank_account",
      "bank_ifsc",
      "account_number_masked",
      "input_account_id",
      "output_account_id",
      "account_type",
      "opening_debit",
      "opening_credit",
      "credit_limit",
      "standard_cost",
      "rate",
    ];
    const sensitiveChanged = Object.keys(proposed).filter((k) =>
      sensitive.includes(k),
    );
    const risk = Math.min(
      100,
      (operation === "DEACTIVATE" ? 35 : operation === "CREATE" ? 15 : 20) +
        (findings.some((x) => x.score === 100)
          ? 35
          : findings.length
            ? 15
            : 0) +
        Math.min(30, impact.total_references * 3) +
        Math.min(20, sensitiveChanged.length * 10),
    );
    return {
      snapshot,
      findings,
      impact: { ...impact, sensitive_fields_changed: sensitiveChanged },
      risk,
    };
  }

  private async impact(
    tenantId: string,
    type: EntityType,
    targetId: string | null,
  ) {
    if (!targetId) return { total_references: 0, references: [] };
    const checks: Record<EntityType, Array<[string, string, string]>> = {
      CUSTOMER: [
        ["sales_invoices", "customer_id", "Sales invoices"],
        ["sales_orders", "customer_id", "Sales orders"],
        ["accounting_parties", "party_id", "Accounting party links"],
      ],
      SUPPLIER: [
        ["purchase_orders", "vendor_id", "Purchase orders"],
        ["grns", "vendor_id", "Goods receipts"],
        ["accounting_parties", "party_id", "Accounting party links"],
      ],
      ITEM: [
        ["purchase_order_items", "item_id", "Purchase-order lines"],
        ["sales_invoice_items", "item_id", "Sales-invoice lines"],
        ["inventory_cost_events", "item_id", "Inventory cost events"],
      ],
      BANK_ACCOUNT: [
        [
          "accounting_bank_transactions",
          "bank_account_id",
          "Bank transactions",
        ],
        [
          "accounting_bank_statement_batches",
          "bank_account_id",
          "Statement batches",
        ],
        ["accounting_payment_runs", "bank_account_id", "Payment runs"],
      ],
      TAX_CODE: [["accounting_journal_lines", "tax_code", "Journal tax lines"]],
      GL_ACCOUNT: [
        ["accounting_journal_lines", "account_id", "Journal lines"],
        ["accounting_bank_accounts", "account_id", "Bank mappings"],
        ["accounting_parties", "receivable_account_id", "Receivable mappings"],
        ["accounting_parties", "payable_account_id", "Payable mappings"],
        ["accounting_tax_codes", "input_account_id", "Input tax mappings"],
        ["accounting_tax_codes", "output_account_id", "Output tax mappings"],
      ],
    };
    const refs: any[] = [];
    for (const [table, column, label] of checks[type]) {
      const value = type === "TAX_CODE" ? null : targetId;
      if (value === null) continue;
      const q = await this.db
        .from(table)
        .select("*", { head: true, count: "exact" })
        .eq("tenant_id", tenantId)
        .eq(column, value);
      if (!q.error && Number(q.count || 0) > 0)
        refs.push({ table, label, count: q.count });
    }
    return {
      total_references: refs.reduce((n, x) => n + Number(x.count), 0),
      references: refs,
    };
  }

  async create(tenantId: string, userId: string, body: any) {
    await this.assertWorkflowAssignment(tenantId, userId, "JOURNAL_PREPARER");
    const entityType = String(
        body.entity_type || "",
      ).toUpperCase() as EntityType,
      operation = String(body.operation || "").toUpperCase() as Operation,
      cfg = this.config(entityType);
    if (!["CREATE", "UPDATE", "DEACTIVATE"].includes(operation))
      this.fail({ message: "Operation must be CREATE, UPDATE or DEACTIVATE." });
    const proposed = this.pick(body.proposed_data, cfg.allowed);
    if (operation === "CREATE") {
      const missing = cfg.required.filter(
        (k) =>
          proposed[k] === undefined ||
          proposed[k] === null ||
          String(proposed[k]).trim() === "",
      );
      if (missing.length)
        this.fail({ message: `Required fields: ${missing.join(", ")}.` });
    }
    if (operation === "UPDATE" && !Object.keys(proposed).length)
      this.fail({ message: "At least one permitted field must be proposed." });
    const analysis = await this.analyse(
      tenantId,
      entityType,
      operation,
      body.target_id || null,
      proposed,
    );
    const now = Date.now(),
      requestNumber = String(
        body.request_number ||
          `MDG-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${String(now).slice(-8)}`,
      ),
      evidence = {
        tenantId,
        entityType,
        operation,
        targetId: body.target_id || null,
        proposed,
        snapshot: analysis.snapshot,
        duplicates: analysis.findings,
        impact: analysis.impact,
        risk: analysis.risk,
        preparedBy: userId,
        preparedAt: new Date().toISOString(),
      };
    const row: any = {
      tenant_id: tenantId,
      request_number: requestNumber,
      entity_type: entityType,
      operation,
      target_id: body.target_id || null,
      current_snapshot: analysis.snapshot,
      proposed_data: proposed,
      duplicate_findings: analysis.findings,
      impact_analysis: analysis.impact,
      risk_score: analysis.risk,
      prepared_by: userId,
      idempotency_key: body.idempotency_key || null,
      evidence_hash: this.hash(evidence),
    };
    const { data, error } = await this.db
      .from("master_data_change_requests")
      .insert(row)
      .select()
      .single();
    if (error) this.fail(error);
    await this.event(
      tenantId,
      data.id,
      userId,
      "CREATE",
      null,
      "DRAFT",
      body.note,
      { risk_score: analysis.risk },
    );
    return this.request(tenantId, data.id);
  }

  async transition(
    tenantId: string,
    userId: string,
    id: string,
    action: "SUBMIT" | "REVIEW" | "APPROVE",
    note?: string,
  ) {
    await this.assertWorkflowAssignment(
      tenantId,
      userId,
      {
        SUBMIT: "JOURNAL_PREPARER",
        REVIEW: "JOURNAL_REVIEWER",
        APPROVE: "JOURNAL_APPROVER",
      }[action],
    );
    const request = await this.request(tenantId, id),
      rules: any = {
        SUBMIT: ["DRAFT", "SUBMITTED", "prepared_by"],
        REVIEW: ["SUBMITTED", "REVIEWED", "reviewed_by"],
        APPROVE: ["REVIEWED", "APPROVED", "approved_by"],
      },
      [from, to, actorField] = rules[action];
    if (request.status !== from)
      this.fail({
        message: `Only a ${from.toLowerCase()} request can be ${to.toLowerCase()}.`,
      });
    if (
      action !== "SUBMIT" &&
      [request.prepared_by, request.reviewed_by, request.approved_by]
        .filter(Boolean)
        .includes(userId)
    )
      this.fail({
        message: "Independent users are required at every governance stage.",
      });
    const atField = actorField.replace("_by", "_at"),
      patch: any = {
        status: to,
        [actorField]: userId,
        [atField]: new Date().toISOString(),
        decision_note:
          String(note || "").trim() || request.decision_note || null,
        updated_at: new Date().toISOString(),
      };
    patch.evidence_hash = this.hash({
      ...request,
      ...patch,
      events: undefined,
    });
    const { data, error } = await this.db
      .from("master_data_change_requests")
      .update(patch)
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .eq("status", from)
      .select()
      .maybeSingle();
    if (error || !data)
      this.fail(error, "The request changed concurrently. Refresh and retry.");
    await this.event(tenantId, id, userId, action, from, to, note, {});
    return this.request(tenantId, id);
  }

  async apply(tenantId: string, userId: string, id: string, note?: string) {
    await this.assertWorkflowAssignment(tenantId, userId, "JOURNAL_POSTER");
    const request = await this.request(tenantId, id);
    if (request.status !== "APPROVED")
      this.fail({ message: "Only an approved request can be applied." });
    if (
      [request.prepared_by, request.reviewed_by, request.approved_by].includes(
        userId,
      )
    )
      this.fail({
        message: "Application must be performed by a fourth independent user.",
      });
    const cfg = this.config(request.entity_type),
      now = new Date().toISOString();
    let target: any;
    if (request.operation === "CREATE") {
      const row = {
        ...this.pick(request.proposed_data, cfg.allowed),
        tenant_id: tenantId,
      };
      const result = await this.db
        .from(cfg.table)
        .insert(row)
        .select()
        .single();
      if (result.error)
        this.fail(result.error, "Approved master-data creation failed.");
      target = result.data;
    } else {
      const patch =
        request.operation === "DEACTIVATE"
          ? { is_active: false, updated_at: now }
          : {
              ...this.pick(request.proposed_data, cfg.allowed),
              updated_at: now,
            };
      const result = await this.db
        .from(cfg.table)
        .update(patch)
        .eq("tenant_id", tenantId)
        .eq("id", request.target_id)
        .select()
        .maybeSingle();
      if (result.error || !result.data)
        this.fail(result.error, "Approved master-data update failed.");
      target = result.data;
    }
    const applied = {
      status: "APPLIED",
      target_id: target.id,
      applied_by: userId,
      applied_at: now,
      decision_note: String(note || "").trim() || request.decision_note || null,
      updated_at: now,
    };
    const evidenceHash = this.hash({
      ...request,
      ...applied,
      result: target,
      events: undefined,
    });
    const { data, error } = await this.db
      .from("master_data_change_requests")
      .update({ ...applied, evidence_hash: evidenceHash })
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .eq("status", "APPROVED")
      .select()
      .maybeSingle();
    if (error || !data) this.fail(error, "The request changed concurrently.");
    await this.event(
      tenantId,
      id,
      userId,
      "APPLY",
      "APPROVED",
      "APPLIED",
      note,
      { target_id: target.id, result_hash: this.hash(target) },
    );
    return this.request(tenantId, id);
  }

  async reject(tenantId: string, userId: string, id: string, note?: string) {
    const request = await this.request(tenantId, id);
    if (!["SUBMITTED", "REVIEWED", "APPROVED"].includes(request.status))
      this.fail({
        message:
          "Only a submitted, reviewed or approved request can be rejected.",
      });
    if (!String(note || "").trim())
      this.fail({ message: "A rejection reason is required." });
    const now = new Date().toISOString(),
      patch = {
        status: "REJECTED",
        rejected_by: userId,
        rejected_at: now,
        decision_note: String(note).trim(),
        updated_at: now,
        evidence_hash: this.hash({
          ...request,
          status: "REJECTED",
          rejected_by: userId,
          rejected_at: now,
          events: undefined,
        }),
      };
    const { data, error } = await this.db
      .from("master_data_change_requests")
      .update(patch)
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .eq("status", request.status)
      .select()
      .maybeSingle();
    if (error || !data) this.fail(error, "The request changed concurrently.");
    await this.event(
      tenantId,
      id,
      userId,
      "REJECT",
      request.status,
      "REJECTED",
      note,
      {},
    );
    return this.request(tenantId, id);
  }

  private async event(
    tenantId: string,
    requestId: string,
    actorId: string,
    action: string,
    fromStatus: string | null,
    toStatus: string,
    note: any,
    payload: any,
  ) {
    const prior = await this.db
        .from("master_data_change_events")
        .select("evidence_hash")
        .eq("tenant_id", tenantId)
        .eq("request_id", requestId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      previous = prior.data?.evidence_hash || null,
      event = {
        request_id: requestId,
        action,
        from_status: fromStatus,
        to_status: toStatus,
        actor_id: actorId,
        note: String(note || "").trim() || null,
        payload,
        previous_hash: previous,
      };
    const { error } = await this.db
      .from("master_data_change_events")
      .insert({
        tenant_id: tenantId,
        ...event,
        evidence_hash: this.hash(event),
      });
    if (error)
      this.fail(error, "Unable to record immutable governance evidence.");
  }
}
