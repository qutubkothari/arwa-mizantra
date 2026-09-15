import { BadRequestException, Injectable } from "@nestjs/common";
import { createHash } from "crypto";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { AuditService } from "../audit/audit.service";
import { ValueRealizationService } from "./value-realization.service";
import { AiProviderService } from "../ai/ai-provider.service";

type TransformationAdvice = {
  executive_summary: string;
  business_health: "NO_DATA" | "ON_TRACK" | "AT_RISK" | "CRITICAL";
  priorities: Array<{
    objective_id: string;
    title: string;
    category:
      | "EVIDENCE_GAP"
      | "OVERDUE_ACTION"
      | "TARGET_RISK"
      | "VALUE_LEAKAGE"
      | "GOVERNANCE";
    evidence: string;
    rationale: string;
    recommended_action: string;
    expected_impact: string;
    confidence: number;
    requires_human_approval: boolean;
  }>;
  missing_evidence: string[];
  guardrails: string[];
};

export function buildDeterministicTransformationAdvice(
  dashboard: any,
): TransformationAdvice {
  const objectives = Array.isArray(dashboard?.objectives)
    ? dashboard.objectives
    : [];
  if (!objectives.length) {
    return {
      executive_summary:
        "No measurable transformation objectives exist yet. Establish approved baselines and target KPIs before asking the system to recommend improvement priorities.",
      business_health: "NO_DATA",
      priorities: [],
      missing_evidence: [
        "Approved business objective with baseline evidence",
        "Primary KPI definition and first measured snapshot",
      ],
      guardrails: [
        "Advisory only; no business record or transaction is created.",
        "A human owner must approve and execute every recommendation.",
        "Financial benefit remains subject to independent Finance verification.",
      ],
    };
  }
  const ranked = [...objectives]
    .sort((a: any, b: any) => {
      const risk = (row: any) =>
        row.health === "OVERDUE" ? 3 : row.health === "AT_RISK" ? 2 : 0;
      return (
        risk(b) - risk(a) ||
        Number(a.progress_pct || 0) - Number(b.progress_pct || 0)
      );
    })
    .slice(0, 5);
  const priorities = ranked
    .filter(
      (row: any) =>
        row.health !== "ACHIEVED" ||
        !(row.kpis || []).some((kpi: any) => kpi.latest_snapshot),
    )
    .map((row: any) => {
      const hasSnapshot = (row.kpis || []).some(
        (kpi: any) => kpi.latest_snapshot,
      );
      const overdueAction = (row.actions || []).find(
        (action: any) =>
          !["VERIFIED", "REJECTED", "CANCELLED"].includes(action.status) &&
          action.due_date < new Date().toISOString().slice(0, 10),
      );
      const category = !hasSnapshot
        ? "EVIDENCE_GAP"
        : overdueAction
          ? "OVERDUE_ACTION"
          : "TARGET_RISK";
      return {
        objective_id: String(row.id),
        title: String(row.title),
        category,
        evidence: !hasSnapshot
          ? "No current KPI snapshot is available."
          : `${Number(row.progress_pct || 0).toFixed(1)}% progress; health ${row.health}.`,
        rationale: !hasSnapshot
          ? "The objective cannot be managed reliably without current measured evidence."
          : "This objective has the highest evidence-backed delivery risk in the current portfolio.",
        recommended_action: !hasSnapshot
          ? "Record and independently review the primary KPI actual from its approved source."
          : overdueAction
            ? `Escalate overdue action ${overdueAction.action_code} to its accountable owner for recovery commitment.`
            : "Run a root-cause review and propose a time-bound corrective action for human approval.",
        expected_impact: `Improve control over ${row.objective_code} target delivery.`,
        confidence: hasSnapshot ? 80 : 55,
        requires_human_approval: true,
      } as TransformationAdvice["priorities"][number];
    });
  const critical = objectives.some((row: any) => row.health === "OVERDUE");
  const atRisk = objectives.some((row: any) => row.health === "AT_RISK");
  return {
    executive_summary: `${objectives.length} objective(s) are governed; ${Number(dashboard?.kpis?.objectives_at_risk || 0)} currently require management attention.`,
    business_health: critical ? "CRITICAL" : atRisk ? "AT_RISK" : "ON_TRACK",
    priorities,
    missing_evidence: objectives
      .filter(
        (row: any) => !(row.kpis || []).some((kpi: any) => kpi.latest_snapshot),
      )
      .map((row: any) => `${row.objective_code}: current primary KPI snapshot`),
    guardrails: [
      "Advisory only; no business record or transaction is created.",
      "A human owner must approve and execute every recommendation.",
      "Financial benefit remains subject to independent Finance verification.",
    ],
  };
}

export function calculateTransformationProgress(
  baseline: number,
  target: number,
  actual: number,
  direction: "INCREASE" | "DECREASE",
) {
  const range = Math.abs(target - baseline);
  if (!Number.isFinite(range) || range === 0) return 0;
  const movement =
    direction === "DECREASE" ? baseline - actual : actual - baseline;
  return Math.max(0, Math.min(100, (movement / range) * 100));
}

@Injectable()
export class BusinessTransformationService {
  private readonly db: SupabaseClient = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!,
  );

  constructor(
    private readonly valueRealization: ValueRealizationService,
    private readonly audit: AuditService,
    private readonly ai: AiProviderService,
  ) {}

  private text(value: unknown) {
    return String(value ?? "").trim();
  }

  private number(value: unknown) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  private fail(error: any, fallback: string): never {
    throw new BadRequestException(error?.message || fallback);
  }

  private async objective(tenantId: string, id: string) {
    const { data, error } = await this.db
      .from("transformation_objectives")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    if (error || !data) this.fail(error, "Transformation objective not found.");
    return data;
  }

  private async kpi(tenantId: string, id: string) {
    const { data, error } = await this.db
      .from("transformation_kpi_definitions")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    if (error || !data) this.fail(error, "Transformation KPI not found.");
    return data;
  }

  private async action(tenantId: string, id: string) {
    const { data, error } = await this.db
      .from("transformation_actions")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    if (error || !data) this.fail(error, "Transformation action not found.");
    return data;
  }

  async dashboard(tenantId: string) {
    const [
      objectivesResult,
      kpisResult,
      snapshotsResult,
      initiativesResult,
      actionsResult,
      claimsResult,
    ] = await Promise.all([
      this.db
        .from("transformation_objectives")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("target_date"),
      this.db
        .from("transformation_kpi_definitions")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .order("kpi_code"),
      this.db
        .from("transformation_kpi_snapshots")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("period_to", { ascending: false }),
      this.db
        .from("value_realization_initiatives")
        .select("*")
        .eq("tenant_id", tenantId)
        .not("transformation_objective_id", "is", null)
        .order("created_at", { ascending: false }),
      this.db
        .from("transformation_actions")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("due_date"),
      this.db
        .from("value_realization_claims")
        .select("id,initiative_id,status,claimed_amount,verified_amount")
        .eq("tenant_id", tenantId),
    ]);
    const error =
      objectivesResult.error ||
      kpisResult.error ||
      snapshotsResult.error ||
      initiativesResult.error ||
      actionsResult.error ||
      claimsResult.error;
    if (error)
      this.fail(error, "Unable to load Business Transformation control.");

    const kpis = kpisResult.data || [];
    const snapshots = snapshotsResult.data || [];
    const initiatives = initiativesResult.data || [];
    const actions = actionsResult.data || [];
    const claims = claimsResult.data || [];
    const latestByKpi = new Map<string, any>();
    for (const snapshot of snapshots) {
      if (!latestByKpi.has(String(snapshot.kpi_id)))
        latestByKpi.set(String(snapshot.kpi_id), snapshot);
    }
    const kpisByObjective = new Map<string, any[]>();
    for (const kpi of kpis) {
      const key = String(kpi.objective_id);
      const values = kpisByObjective.get(key) || [];
      values.push({ ...kpi, latest_snapshot: latestByKpi.get(String(kpi.id)) });
      kpisByObjective.set(key, values);
    }
    const initiativesByObjective = new Map<string, any[]>();
    for (const initiative of initiatives) {
      const key = String(initiative.transformation_objective_id);
      const values = initiativesByObjective.get(key) || [];
      values.push(initiative);
      initiativesByObjective.set(key, values);
    }
    const actionsByObjective = new Map<string, any[]>();
    for (const item of actions) {
      const key = String(item.objective_id);
      const values = actionsByObjective.get(key) || [];
      values.push(item);
      actionsByObjective.set(key, values);
    }

    const today = new Date().toISOString().slice(0, 10);
    const objectives = (objectivesResult.data || []).map((objective: any) => {
      const objectiveKpis = kpisByObjective.get(String(objective.id)) || [];
      const primary =
        objectiveKpis.find((item) => item.is_primary) ||
        objectiveKpis[0] ||
        null;
      const latest = primary?.latest_snapshot || null;
      const actual = latest
        ? this.number(latest.actual_value)
        : this.number(objective.baseline_value);
      const progress = calculateTransformationProgress(
        this.number(objective.baseline_value),
        this.number(objective.target_value),
        actual,
        objective.improvement_direction,
      );
      const objectiveActions =
        actionsByObjective.get(String(objective.id)) || [];
      return {
        ...objective,
        current_value: actual,
        progress_pct: progress,
        latest_period_to: latest?.period_to || null,
        health:
          progress >= 100
            ? "ACHIEVED"
            : objective.target_date < today
              ? "OVERDUE"
              : objectiveActions.some(
                    (item) =>
                      !["VERIFIED", "REJECTED", "CANCELLED"].includes(
                        item.status,
                      ) && item.due_date < today,
                  )
                ? "AT_RISK"
                : "ON_TRACK",
        kpis: objectiveKpis,
        initiatives: initiativesByObjective.get(String(objective.id)) || [],
        actions: objectiveActions,
      };
    });

    const verifiedClaims = claims.filter(
      (claim: any) => claim.status === "VERIFIED",
    );
    return {
      kpis: {
        active_objectives: objectives.filter((item: any) =>
          ["ACTIVE", "AT_RISK", "ACHIEVED"].includes(item.status),
        ).length,
        achieved_objectives: objectives.filter(
          (item: any) => item.progress_pct >= 100,
        ).length,
        objectives_at_risk: objectives.filter((item: any) =>
          ["AT_RISK", "OVERDUE"].includes(item.health),
        ).length,
        open_actions: actions.filter(
          (item: any) =>
            !["VERIFIED", "REJECTED", "CANCELLED"].includes(item.status),
        ).length,
        overdue_actions: actions.filter(
          (item: any) =>
            !["VERIFIED", "REJECTED", "CANCELLED"].includes(item.status) &&
            item.due_date < today,
        ).length,
        operational_verified_benefit: actions
          .filter((item: any) => item.status === "VERIFIED")
          .reduce(
            (sum: number, item: any) =>
              sum + (this.number(item.operational_benefit) || 0),
            0,
          ),
        finance_verified_benefit: verifiedClaims.reduce(
          (sum: number, claim: any) =>
            sum + (this.number(claim.verified_amount) || 0),
          0,
        ),
      },
      objectives,
      actions,
      initiatives,
      safety: {
        operational_documents_unchanged: true,
        accounting_posting_unchanged: true,
        action_outcomes_independently_verified: true,
        financial_benefits_require_finance_verification: true,
        ai_advisory_only: true,
      },
    };
  }

  async advisor(tenantId: string, userId: string, body: any) {
    const question = this.text(body?.question).slice(0, 500);
    const dashboard = await this.dashboard(tenantId);
    const fallback = buildDeterministicTransformationAdvice(dashboard);
    const boundedContext = {
      question: question || "What should management prioritize next?",
      metrics: dashboard.kpis,
      objectives: dashboard.objectives.slice(0, 50).map((row: any) => ({
        id: row.id,
        code: row.objective_code,
        title: row.title,
        perspective: row.perspective,
        owner: row.owner_reference,
        baseline: row.baseline_value,
        current: row.current_value,
        target: row.target_value,
        unit: row.unit_of_measure,
        progress_pct: row.progress_pct,
        health: row.health,
        target_date: row.target_date,
        latest_period_to: row.latest_period_to,
        kpis: (row.kpis || []).slice(0, 10).map((kpi: any) => ({
          code: kpi.kpi_code,
          name: kpi.kpi_name,
          source: kpi.source_reference,
          latest_actual: kpi.latest_snapshot?.actual_value ?? null,
          latest_period_to: kpi.latest_snapshot?.period_to ?? null,
        })),
        actions: (row.actions || []).slice(0, 20).map((action: any) => ({
          code: action.action_code,
          title: action.title,
          owner: action.owner_reference,
          priority: action.priority,
          due_date: action.due_date,
          status: action.status,
          expected_impact: action.expected_operational_impact,
        })),
      })),
    };
    const result = await this.ai.structuredJson<TransformationAdvice>({
      capability: "business_transformation_advisor",
      scope: `tenant:${tenantId}`,
      actorId: userId,
      cacheTtlMs: 300000,
      system:
        "You are an advisory-only business transformation analyst. Use only the supplied tenant-scoped evidence. Never invent facts, create transactions, approve controls, or claim financial benefit. Rank no more than five priorities. Every recommendation requires human approval. If evidence is missing, state the gap instead of guessing. Preserve the supplied objective_id exactly.",
      data: boundedContext,
      fallback,
      jsonSchema: {
        type: "object",
        additionalProperties: false,
        required: [
          "executive_summary",
          "business_health",
          "priorities",
          "missing_evidence",
          "guardrails",
        ],
        properties: {
          executive_summary: { type: "string" },
          business_health: {
            type: "string",
            enum: ["NO_DATA", "ON_TRACK", "AT_RISK", "CRITICAL"],
          },
          priorities: {
            type: "array",
            maxItems: 5,
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "objective_id",
                "title",
                "category",
                "evidence",
                "rationale",
                "recommended_action",
                "expected_impact",
                "confidence",
                "requires_human_approval",
              ],
              properties: {
                objective_id: { type: "string" },
                title: { type: "string" },
                category: {
                  type: "string",
                  enum: [
                    "EVIDENCE_GAP",
                    "OVERDUE_ACTION",
                    "TARGET_RISK",
                    "VALUE_LEAKAGE",
                    "GOVERNANCE",
                  ],
                },
                evidence: { type: "string" },
                rationale: { type: "string" },
                recommended_action: { type: "string" },
                expected_impact: { type: "string" },
                confidence: { type: "number", minimum: 0, maximum: 100 },
                requires_human_approval: { type: "boolean" },
              },
            },
          },
          missing_evidence: { type: "array", items: { type: "string" } },
          guardrails: { type: "array", items: { type: "string" } },
        },
      },
    });
    return {
      ...result.value,
      provider: result.provider,
      model: result.model,
      fallback_used: result.fallback_used,
      generated_at: new Date().toISOString(),
      advisory_only: true,
      records_created: 0,
      records_modified: 0,
    };
  }

  async createObjective(tenantId: string, userId: string, body: any) {
    const direction = this.text(body.improvement_direction).toUpperCase();
    const perspective = this.text(body.perspective).toUpperCase();
    const baseline = this.number(body.baseline_value);
    const target = this.number(body.target_value);
    const from = this.text(body.baseline_period_from);
    const to = this.text(body.baseline_period_to);
    const targetDate = this.text(body.target_date);
    if (
      !this.text(body.objective_code) ||
      !this.text(body.title) ||
      !this.text(body.description) ||
      !this.text(body.owner_reference) ||
      !this.text(body.unit_of_measure) ||
      !this.text(body.baseline_evidence) ||
      !["INCREASE", "DECREASE"].includes(direction) ||
      ![
        "SALES",
        "CUSTOMER",
        "DELIVERY",
        "PROCUREMENT",
        "INVENTORY",
        "PRODUCTION",
        "QUALITY",
        "FINANCE",
        "PEOPLE",
        "CUSTOM",
      ].includes(perspective) ||
      !Number.isFinite(baseline) ||
      !Number.isFinite(target) ||
      baseline === target ||
      (direction === "INCREASE" && target <= baseline) ||
      (direction === "DECREASE" && target >= baseline) ||
      !from ||
      !to ||
      !targetDate ||
      to < from ||
      targetDate < to
    ) {
      throw new BadRequestException(
        "Objective code, owner, evidence, valid baseline period and a directionally valid target are required.",
      );
    }
    const { data, error } = await this.db
      .from("transformation_objectives")
      .insert({
        tenant_id: tenantId,
        objective_code: this.text(body.objective_code).toUpperCase(),
        title: this.text(body.title),
        description: this.text(body.description),
        perspective,
        owner_user_id: body.owner_user_id || null,
        owner_reference: this.text(body.owner_reference),
        baseline_value: baseline,
        target_value: target,
        unit_of_measure: this.text(body.unit_of_measure),
        improvement_direction: direction,
        baseline_period_from: from,
        baseline_period_to: to,
        target_date: targetDate,
        review_frequency:
          this.text(body.review_frequency).toUpperCase() || "MONTHLY",
        baseline_evidence: this.text(body.baseline_evidence),
        created_by: userId,
      })
      .select()
      .single();
    if (error) this.fail(error, "Unable to create transformation objective.");
    await this.audit.logActivity({
      tenantId,
      userId,
      action: "TRANSFORMATION_OBJECTIVE_CREATED",
      resourceType: "transformation_objective",
      resourceId: data.id,
      resourceName: data.objective_code,
      newValue: data,
    });
    return data;
  }

  async submitObjective(tenantId: string, userId: string, id: string) {
    const objective = await this.objective(tenantId, id);
    if (objective.status !== "DRAFT")
      throw new BadRequestException("Only a draft objective can be submitted.");
    const { data, error } = await this.db
      .from("transformation_objectives")
      .update({
        status: "SUBMITTED",
        submitted_by: userId,
        submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .eq("status", "DRAFT")
      .select()
      .maybeSingle();
    if (error || !data) this.fail(error, "Objective submission conflicted.");
    return data;
  }

  async approveObjective(
    tenantId: string,
    userId: string,
    id: string,
    body: any,
  ) {
    const objective = await this.objective(tenantId, id);
    const note = this.text(body.approval_note);
    if (
      objective.status !== "SUBMITTED" ||
      objective.created_by === userId ||
      !note
    )
      throw new BadRequestException(
        "Independent approval of a submitted objective requires an approval note.",
      );
    const { data, error } = await this.db
      .from("transformation_objectives")
      .update({
        status: "ACTIVE",
        approved_by: userId,
        approved_at: new Date().toISOString(),
        approval_note: note,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .eq("status", "SUBMITTED")
      .select()
      .maybeSingle();
    if (error || !data) this.fail(error, "Objective approval conflicted.");
    return data;
  }

  async createKpi(tenantId: string, userId: string, body: any) {
    const objective = await this.objective(
      tenantId,
      this.text(body.objective_id),
    );
    const direction =
      this.text(body.improvement_direction).toUpperCase() ||
      objective.improvement_direction;
    if (
      !this.text(body.kpi_code) ||
      !this.text(body.kpi_name) ||
      !this.text(body.source_module) ||
      !this.text(body.calculation_method) ||
      !this.text(body.source_reference) ||
      !this.text(body.unit_of_measure) ||
      !this.text(body.owner_reference) ||
      !["INCREASE", "DECREASE"].includes(direction)
    )
      throw new BadRequestException(
        "KPI code, formula, source, unit and owner are required.",
      );
    if (["CLOSED", "CANCELLED"].includes(objective.status))
      throw new BadRequestException("The objective is no longer configurable.");
    const { data, error } = await this.db
      .from("transformation_kpi_definitions")
      .insert({
        tenant_id: tenantId,
        objective_id: objective.id,
        kpi_code: this.text(body.kpi_code).toUpperCase(),
        kpi_name: this.text(body.kpi_name),
        source_module: this.text(body.source_module).toUpperCase(),
        calculation_method: this.text(body.calculation_method),
        source_reference: this.text(body.source_reference),
        unit_of_measure: this.text(body.unit_of_measure),
        improvement_direction: direction,
        warning_threshold:
          body.warning_threshold === "" || body.warning_threshold == null
            ? null
            : this.number(body.warning_threshold),
        critical_threshold:
          body.critical_threshold === "" || body.critical_threshold == null
            ? null
            : this.number(body.critical_threshold),
        owner_reference: this.text(body.owner_reference),
        is_primary: body.is_primary === true || body.is_primary === "true",
        created_by: userId,
      })
      .select()
      .single();
    if (error) this.fail(error, "Unable to create transformation KPI.");
    return data;
  }

  async recordSnapshot(tenantId: string, userId: string, body: any) {
    const kpi = await this.kpi(tenantId, this.text(body.kpi_id));
    const objective = await this.objective(tenantId, kpi.objective_id);
    const actual = this.number(body.actual_value);
    const from = this.text(body.period_from);
    const to = this.text(body.period_to);
    const evidence = this.text(body.evidence_reference);
    if (
      !Number.isFinite(actual) ||
      !from ||
      !to ||
      to < from ||
      !evidence ||
      !["ACTIVE", "AT_RISK", "ACHIEVED"].includes(objective.status)
    )
      throw new BadRequestException(
        "An active objective, valid period, actual value and evidence are required.",
      );
    const sourceSnapshot =
      body.source_snapshot && typeof body.source_snapshot === "object"
        ? body.source_snapshot
        : {};
    const { data, error } = await this.db
      .from("transformation_kpi_snapshots")
      .insert({
        tenant_id: tenantId,
        kpi_id: kpi.id,
        period_from: from,
        period_to: to,
        actual_value: actual,
        target_value: objective.target_value,
        baseline_value: objective.baseline_value,
        evidence_reference: evidence,
        source_snapshot: sourceSnapshot,
        source_snapshot_hash: createHash("sha256")
          .update(JSON.stringify(sourceSnapshot))
          .digest("hex"),
        captured_by: userId,
      })
      .select()
      .single();
    if (error) this.fail(error, "Unable to record KPI snapshot.");
    const progress = calculateTransformationProgress(
      this.number(objective.baseline_value),
      this.number(objective.target_value),
      actual,
      objective.improvement_direction,
    );
    if (progress >= 100 && objective.status !== "ACHIEVED") {
      await this.db
        .from("transformation_objectives")
        .update({ status: "ACHIEVED", updated_at: new Date().toISOString() })
        .eq("tenant_id", tenantId)
        .eq("id", objective.id)
        .in("status", ["ACTIVE", "AT_RISK"]);
    }
    return { ...data, progress_pct: progress };
  }

  async createInitiative(tenantId: string, userId: string, body: any) {
    const objective = await this.objective(
      tenantId,
      this.text(body.objective_id),
    );
    if (!["ACTIVE", "AT_RISK", "ACHIEVED"].includes(objective.status))
      throw new BadRequestException(
        "Only an active objective can receive an initiative.",
      );
    let primaryKpi: any = null;
    if (body.primary_kpi_id) {
      primaryKpi = await this.kpi(tenantId, this.text(body.primary_kpi_id));
      if (primaryKpi.objective_id !== objective.id)
        throw new BadRequestException(
          "The primary KPI belongs to another objective.",
        );
    }
    const initiative = await this.valueRealization.createInitiative(
      tenantId,
      userId,
      body,
    );
    const { data, error } = await this.db
      .from("value_realization_initiatives")
      .update({
        transformation_objective_id: objective.id,
        primary_kpi_id: primaryKpi?.id || null,
        target_metric_value:
          body.target_metric_value === "" || body.target_metric_value == null
            ? null
            : this.number(body.target_metric_value),
        expected_direction: objective.improvement_direction,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", initiative.id)
      .select()
      .single();
    if (error)
      this.fail(error, "Unable to link the transformation initiative.");
    return data;
  }

  async createAction(tenantId: string, userId: string, body: any) {
    const objective = await this.objective(
      tenantId,
      this.text(body.objective_id),
    );
    if (!["ACTIVE", "AT_RISK", "ACHIEVED"].includes(objective.status))
      throw new BadRequestException(
        "Only an active objective can receive actions.",
      );
    if (body.initiative_id) {
      const { data: initiative, error } = await this.db
        .from("value_realization_initiatives")
        .select("id,transformation_objective_id")
        .eq("tenant_id", tenantId)
        .eq("id", body.initiative_id)
        .maybeSingle();
      if (
        error ||
        !initiative ||
        initiative.transformation_objective_id !== objective.id
      )
        throw new BadRequestException(
          "The selected initiative is not linked to this objective.",
        );
    }
    const expectedBenefit = this.number(body.expected_benefit || 0);
    if (
      !this.text(body.action_code) ||
      !this.text(body.title) ||
      !this.text(body.description) ||
      !this.text(body.owner_reference) ||
      !this.text(body.due_date) ||
      !this.text(body.expected_operational_impact) ||
      !Number.isFinite(expectedBenefit) ||
      expectedBenefit < 0
    )
      throw new BadRequestException(
        "Action code, owner, due date and expected operational impact are required.",
      );
    const { data, error } = await this.db
      .from("transformation_actions")
      .insert({
        tenant_id: tenantId,
        objective_id: objective.id,
        initiative_id: body.initiative_id || null,
        exception_id: body.exception_id || null,
        governed_action_request_id: body.governed_action_request_id || null,
        action_code: this.text(body.action_code).toUpperCase(),
        title: this.text(body.title),
        description: this.text(body.description),
        owner_user_id: body.owner_user_id || null,
        owner_reference: this.text(body.owner_reference),
        priority: this.text(body.priority).toUpperCase() || "MEDIUM",
        due_date: this.text(body.due_date),
        expected_operational_impact: this.text(
          body.expected_operational_impact,
        ),
        expected_benefit: expectedBenefit,
        created_by: userId,
      })
      .select()
      .single();
    if (error) this.fail(error, "Unable to create transformation action.");
    return data;
  }

  async acceptAction(tenantId: string, userId: string, id: string) {
    const action = await this.action(tenantId, id);
    if (
      action.status !== "PROPOSED" ||
      (action.owner_user_id && action.owner_user_id !== userId)
    )
      throw new BadRequestException(
        "Only the assigned owner can accept a proposed action.",
      );
    return this.updateActionState(tenantId, id, "PROPOSED", {
      status: "ACCEPTED",
      accepted_by: userId,
      accepted_at: new Date().toISOString(),
    });
  }

  async startAction(tenantId: string, userId: string, id: string) {
    const action = await this.action(tenantId, id);
    if (action.status !== "ACCEPTED" || action.accepted_by !== userId)
      throw new BadRequestException(
        "The accepting owner must start this action.",
      );
    return this.updateActionState(tenantId, id, "ACCEPTED", {
      status: "IN_PROGRESS",
    });
  }

  async completeAction(
    tenantId: string,
    userId: string,
    id: string,
    body: any,
  ) {
    const action = await this.action(tenantId, id);
    const evidence = this.text(body.completion_evidence);
    const outcome = this.number(body.outcome_value);
    if (
      !["ACCEPTED", "IN_PROGRESS"].includes(action.status) ||
      action.accepted_by !== userId ||
      !evidence ||
      !Number.isFinite(outcome)
    )
      throw new BadRequestException(
        "The accepting owner must provide completion evidence and an outcome value.",
      );
    return this.updateActionState(tenantId, id, action.status, {
      status: "COMPLETED",
      completed_by: userId,
      completed_at: new Date().toISOString(),
      completion_evidence: evidence,
      outcome_value: outcome,
    });
  }

  async verifyAction(tenantId: string, userId: string, id: string, body: any) {
    const action = await this.action(tenantId, id);
    const evidence = this.text(body.verification_evidence);
    const note = this.text(body.verifier_note);
    const benefit = this.number(body.operational_benefit || 0);
    if (
      action.status !== "COMPLETED" ||
      action.completed_by === userId ||
      !evidence ||
      !note ||
      !Number.isFinite(benefit) ||
      benefit < 0
    )
      throw new BadRequestException(
        "Independent verification requires evidence, a verifier note and a non-negative operational benefit. Finance verification remains separate.",
      );
    return this.updateActionState(tenantId, id, "COMPLETED", {
      status: "VERIFIED",
      operational_benefit: benefit,
      verified_by: userId,
      verified_at: new Date().toISOString(),
      verification_evidence: evidence,
      verifier_note: note,
    });
  }

  async rejectAction(tenantId: string, userId: string, id: string, body: any) {
    const action = await this.action(tenantId, id);
    const reason = this.text(body.rejection_reason);
    if (
      action.status !== "COMPLETED" ||
      action.completed_by === userId ||
      !reason
    )
      throw new BadRequestException(
        "Independent rejection of a completed action requires a reason.",
      );
    return this.updateActionState(tenantId, id, "COMPLETED", {
      status: "REJECTED",
      rejected_by: userId,
      rejected_at: new Date().toISOString(),
      rejection_reason: reason,
    });
  }

  private async updateActionState(
    tenantId: string,
    id: string,
    expectedStatus: string,
    update: Record<string, unknown>,
  ) {
    const { data, error } = await this.db
      .from("transformation_actions")
      .update({ ...update, updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .eq("status", expectedStatus)
      .select()
      .maybeSingle();
    if (error || !data)
      this.fail(error, "Transformation action was already changed.");
    return data;
  }
}
