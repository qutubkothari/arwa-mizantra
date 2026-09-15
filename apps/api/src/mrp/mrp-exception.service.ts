import { BadRequestException, Injectable } from "@nestjs/common";
import { createHash } from "crypto";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

type ExceptionCandidate = {
  source_key: string;
  title: string;
  explanation: string;
  recommendation: string;
  severity: "MEDIUM" | "HIGH" | "CRITICAL";
  priority_score: number;
  evidence: Record<string, any>;
};

@Injectable()
export class MrpExceptionService {
  private readonly db: SupabaseClient = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!,
  );

  private fingerprint(value: unknown) {
    return createHash("sha256")
      .update(JSON.stringify(value))
      .digest("hex")
      .slice(0, 24);
  }

  private dueDate(line: any) {
    const today = new Date().toISOString().slice(0, 10);
    const release = String(line.release_by_date || "").slice(0, 10);
    const required = String(line.required_by_date || "").slice(0, 10);
    return release || required || today;
  }

  private candidate(run: any, line: any, code: string): ExceptionCandidate {
    const itemLabel = line.item_code || line.item_name || line.item_id;
    const definitions: Record<
      string,
      {
        title: string;
        explanation: string;
        recommendation: string;
        severity: "MEDIUM" | "HIGH" | "CRITICAL";
        score: number;
      }
    > = {
      MATERIAL_SHORTAGE: {
        title: `${itemLabel}: material shortage`,
        explanation: `Net requirement ${Number(line.net_requirement || 0)} remains after stock, issues, safety stock and approved inbound supply.`,
        recommendation:
          "Review the recommendation, confirm demand and release an approved BUY or BUILD request.",
        severity: "HIGH",
        score: 86,
      },
      RELEASE_OVERDUE: {
        title: `${itemLabel}: planned release is overdue`,
        explanation: `The calculated release date ${line.release_by_date || "is missing"} is no longer achievable without intervention.`,
        recommendation:
          "Expedite, substitute, add approved capacity or revise the protected demand date.",
        severity: "CRITICAL",
        score: 94,
      },
      LATE_SCHEDULED_RECEIPT: {
        title: `${itemLabel}: inbound supply misses requirement`,
        explanation:
          "An approved purchase-order balance is dated after the earliest protected requirement.",
        recommendation:
          "Confirm the supplier date, expedite the PO or approve an alternate source before release.",
        severity: "HIGH",
        score: 90,
      },
      PLANNER_DECISION_REQUIRED: {
        title: `${itemLabel}: planner decision required`,
        explanation:
          "The MRP recommendation has positive net demand but has not been approved, changed, deferred or rejected.",
        recommendation:
          "Assign a planner and record a governed decision with quantity, date and sourcing/resource evidence.",
        severity: "MEDIUM",
        score: 76,
      },
      DEFERRED_OR_REJECTED_SUPPLY_RISK: {
        title: `${itemLabel}: supply recommendation not released`,
        explanation: `The recommendation is ${String(line.planner_decision?.decision || "").toLowerCase()} while protected demand remains open.`,
        recommendation:
          "Confirm the reason remains valid or replace the recommendation with another approved supply action.",
        severity: "HIGH",
        score: 84,
      },
      PLANNING_TIME_FENCE_CHANGE: {
        title: `${itemLabel}: near-term MRP recommendation changed`,
        explanation: `The latest MRP run changed a recommendation dated inside the ${Number(line.run_change?.planning_time_fence_days || 7)}-day planning time fence.`,
        recommendation:
          "Review the run comparison and record a fresh planner decision before releasing, rescheduling or reducing supply.",
        severity: "CRITICAL",
        score: 96,
      },
      STOCK_COMMITTED_ELSEWHERE: {
        title: `${itemLabel}: stock is committed to other demand`,
        explanation: `${Number(line.reserved_elsewhere_quantity || 0)} units are reserved for references outside this MRP demand set and cannot cover the current requirement.`,
        recommendation:
          "Review reservation priorities and expiry evidence. Reallocate only through the governed inventory workflow or release new supply.",
        severity: "HIGH",
        score: 88,
      },
      RESERVATION_LEDGER_MISMATCH: {
        title: `${itemLabel}: reservation ledger mismatch`,
        explanation: `The inventory reserved balance differs from active reservation records by ${Number(line.reservation_mismatch_quantity || 0)} units.`,
        recommendation:
          "Reconcile active, expired and released reservations before relying on the stock position or releasing supply.",
        severity: "CRITICAL",
        score: 97,
      },
      APPROVED_SUBSTITUTE_AVAILABLE: {
        title: `${itemLabel}: approved substitute can cover shortage`,
        explanation: `${Number(line.substitution_candidates?.[0]?.coverage_quantity || 0)} units can be covered by the highest-ranked approved alternate material.`,
        recommendation:
          "Review compatibility, quality and commercial evidence, then approve the substitution through the normal material-change workflow.",
        severity: "HIGH",
        score: 83,
      },
      MAXIMUM_STOCK_CONFLICT: {
        title: `${itemLabel}: replenishment conflicts with maximum stock`,
        explanation: `Lot rounding leaves projected stock above the configured maximum of ${Number(line.maximum_stock_quantity || 0)} units.`,
        recommendation:
          "Split or defer the supply lot, renegotiate MOQ/pack size, or approve a documented maximum-stock exception.",
        severity: "HIGH",
        score: 87,
      },
      SHELF_LIFE_POLICY_RISK: {
        title: `${itemLabel}: shelf-life coverage is unsafe`,
        explanation:
          "Configured replenishment lead time and minimum remaining shelf life leave insufficient usable shelf life.",
        recommendation:
          "Use a shorter-lead approved source, smaller dated lots or an approved substitute before releasing supply.",
        severity: "CRITICAL",
        score: 93,
      },
      SINGLE_BATCH_SOURCE_REQUIRED: {
        title: `${itemLabel}: single-batch sourcing evidence required`,
        explanation:
          "The material policy requires one batch, but the recommendation has not yet identified a compliant supply batch/source.",
        recommendation:
          "Confirm one approved batch can cover the quantity and required date before release.",
        severity: "HIGH",
        score: 85,
      },
      TRANSFER_SOURCE_REQUIRED: {
        title: `${itemLabel}: warehouse transfer source required`,
        explanation:
          "The item is governed as TRANSFER, so MRP has blocked automatic BUY/BUILD routing until a source warehouse is selected.",
        recommendation:
          "Select an approved source warehouse with available stock and release the transfer through inventory controls.",
        severity: "HIGH",
        score: 89,
      },
    };
    const definition = definitions[code] || definitions.MATERIAL_SHORTAGE;
    const state = {
      item_id: line.item_id,
      code,
      net_requirement: Number(line.net_requirement || 0),
      recommended_quantity: Number(line.recommended_quantity || 0),
      required_by_date: line.required_by_date || null,
      release_by_date: line.release_by_date || null,
      decision: line.planner_decision?.decision || "PENDING",
      run_change: line.run_change || null,
      reserved_for_plan_quantity: Number(line.reserved_for_plan_quantity || 0),
      reserved_elsewhere_quantity: Number(
        line.reserved_elsewhere_quantity || 0,
      ),
      reservation_mismatch_quantity: Number(
        line.reservation_mismatch_quantity || 0,
      ),
      substitution_candidates: line.substitution_candidates || [],
      maximum_stock_conflict: Boolean(line.maximum_stock_conflict),
      shelf_life_policy_risk: Boolean(line.shelf_life_policy_risk),
      batch_constraint: line.batch_constraint || "NONE",
      recommended_intervention: line.recommended_intervention || "MONITOR",
    };
    return {
      source_key: `MRP:${line.item_id}:${code}`,
      title: definition.title,
      explanation: definition.explanation,
      recommendation: definition.recommendation,
      severity: definition.severity,
      priority_score: definition.score,
      evidence: {
        ...state,
        run_id: run.id,
        line_id: line.id,
        item_code: line.item_code,
        item_name: line.item_name,
        action_due_date: this.dueDate(line),
        demand_references: line.demand_references || [],
        reservation_evidence: line.reservation_evidence || [],
        fingerprint: this.fingerprint(state),
      },
    };
  }

  async syncPlan(tenantId: string, plan: any) {
    if (!plan?.run) return { active: 0, closed: 0, reopened: 0 };
    const candidates: ExceptionCandidate[] = [];
    for (const line of plan.lines || []) {
      for (const code of line.exception_codes || [])
        candidates.push(this.candidate(plan.run, line, String(code)));
      if (Number(line.net_requirement || 0) > 0) {
        const decision = String(line.planner_decision?.decision || "PENDING");
        if (decision === "PENDING")
          candidates.push(
            this.candidate(plan.run, line, "PLANNER_DECISION_REQUIRED"),
          );
        if (["DEFERRED", "REJECTED"].includes(decision))
          candidates.push(
            this.candidate(plan.run, line, "DEFERRED_OR_REJECTED_SUPPLY_RISK"),
          );
      }
    }
    return this.syncCandidates(tenantId, candidates, "MRP_PLAN", true);
  }

  async syncReadiness(
    tenantId: string,
    run: any,
    assessments: Array<{ line: any; readiness: any }>,
  ) {
    const candidates = assessments
      .filter((assessment) => !assessment.readiness?.ready)
      .map((assessment) => {
        const line = assessment.line;
        const state = {
          item_id: line.item_id,
          reason: assessment.readiness?.reason,
          required_by_date: line.required_by_date || null,
          readiness_checks: assessment.readiness?.checks || [],
        };
        return {
          source_key: `MRP:${line.item_id}:BUILD_RELEASE_READINESS`,
          title: `${line.item_code || line.item_name || line.item_id}: build release blocked`,
          explanation:
            assessment.readiness?.reason || "Build release readiness failed.",
          recommendation:
            "Resolve the required-date, BOM, routing, work-centre or finite-capacity evidence and preview the release again.",
          severity: "HIGH" as const,
          priority_score: 91,
          evidence: {
            ...state,
            run_id: run.id,
            line_id: line.id,
            item_code: line.item_code,
            item_name: line.item_name,
            action_due_date: this.dueDate(line),
            readiness: assessment.readiness,
            fingerprint: this.fingerprint(state),
          },
        };
      });
    return this.syncCandidates(
      tenantId,
      candidates,
      "MRP_READINESS",
      false,
      assessments.map((assessment) => String(assessment.line.item_id)),
    );
  }

  private async syncCandidates(
    tenantId: string,
    candidates: ExceptionCandidate[],
    sourceGroup: "MRP_PLAN" | "MRP_READINESS",
    closeAllStale: boolean,
    scopedItemIds: string[] = [],
  ) {
    const now = new Date().toISOString();
    const existingResult = await this.db
      .from("mizantra_exception_register")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("source_type", sourceGroup);
    if (existingResult.error)
      throw new BadRequestException(existingResult.error.message);
    const existing = existingResult.data || [];
    const existingByKey = new Map(
      existing.map((row: any) => [String(row.source_key), row]),
    );
    let reopened = 0;
    const rows = candidates.map((candidate) => {
      const prior: any = existingByKey.get(candidate.source_key);
      const changed =
        prior?.evidence?.fingerprint !== candidate.evidence.fingerprint;
      const shouldReopen =
        prior && ["RESOLVED", "DISMISSED"].includes(prior.status) && changed;
      if (shouldReopen) reopened += 1;
      return {
        tenant_id: tenantId,
        source_key: candidate.source_key,
        source_type: sourceGroup,
        source_route: "/dashboard/production/mrp",
        title: candidate.title,
        explanation: candidate.explanation,
        recommendation: candidate.recommendation,
        severity: candidate.severity,
        priority_score: candidate.priority_score,
        confidence: "HIGH",
        evidence: candidate.evidence,
        status: shouldReopen ? "OPEN" : prior?.status || "OPEN",
        owner_user_id: prior?.owner_user_id || null,
        acknowledged_at: shouldReopen ? null : prior?.acknowledged_at || null,
        resolved_at: shouldReopen ? null : prior?.resolved_at || null,
        resolution_evidence: shouldReopen
          ? null
          : prior?.resolution_evidence || null,
        last_seen_at: now,
        updated_at: now,
      };
    });
    if (rows.length) {
      const upsert = await this.db
        .from("mizantra_exception_register")
        .upsert(rows, { onConflict: "tenant_id,source_key" });
      if (upsert.error) throw new BadRequestException(upsert.error.message);
    }
    const activeKeys = new Set(
      candidates.map((candidate) => candidate.source_key),
    );
    const stale = existing.filter((row: any) => {
      if (!["OPEN", "ACKNOWLEDGED"].includes(row.status)) return false;
      if (activeKeys.has(String(row.source_key))) return false;
      if (closeAllStale) return true;
      return scopedItemIds.includes(String(row.evidence?.item_id || ""));
    });
    if (stale.length) {
      const close = await this.db
        .from("mizantra_exception_register")
        .update({
          status: "RESOLVED",
          resolved_at: now,
          resolution_evidence:
            "System evidence: the condition was absent from the latest governed MRP calculation.",
          updated_at: now,
        })
        .eq("tenant_id", tenantId)
        .in(
          "id",
          stale.map((row: any) => row.id),
        );
      if (close.error) throw new BadRequestException(close.error.message);
    }
    return { active: candidates.length, closed: stale.length, reopened };
  }
}
