"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Boxes,
  CheckCircle2,
  Loader2,
  Play,
  RefreshCw,
  Send,
  ShoppingCart,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { apiClient } from "../../../../../lib/api-client";
import {
  PlannerDecision,
  PlannerDecisionDialog,
} from "./PlannerDecisionDialog";

type Line = {
  id: string;
  item_code?: string | null;
  item_name?: string | null;
  gross_requirement: number;
  issued_quantity: number;
  available_quantity: number;
  scheduled_receipt_quantity?: number;
  scheduled_purchase_quantity?: number;
  scheduled_production_quantity?: number;
  open_requisition_quantity?: number;
  open_draft_po_quantity?: number;
  late_supply_quantity?: number;
  undated_supply_quantity?: number;
  reschedule_quantity?: number;
  confirm_date_quantity?: number;
  new_supply_requirement?: number;
  recommended_intervention?: string;
  projected_available_quantity?: number;
  approved_forecast_quantity?: number;
  demand_mix?: Record<string, number>;
  physical_stock_quantity?: number;
  unreserved_stock_quantity?: number;
  active_reserved_quantity?: number;
  reserved_for_plan_quantity?: number;
  reserved_elsewhere_quantity?: number;
  reservation_mismatch_quantity?: number;
  reservation_evidence?: Array<{
    reservation_id: string;
    reference_type?: string;
    reference_number?: string;
    reserved_quantity: number;
    allocation: "CURRENT_PLAN" | "OTHER_DEMAND";
    expires_at?: string | null;
  }>;
  safety_stock_calculation?: {
    method: string;
    configured_value: number;
    minimum_stock_quantity: number;
    calculated_quantity: number;
    protected_quantity: number;
    forecast_accuracy_pct?: number | null;
    explanation: string;
  } | null;
  lot_sizing_policy?: string;
  rounding_excess_quantity?: number;
  maximum_stock_quantity?: number | null;
  maximum_stock_conflict?: boolean;
  shelf_life_policy_risk?: boolean;
  batch_constraint?: string;
  substitution_candidates?: Array<{
    item_id: string;
    item_code?: string | null;
    item_name?: string | null;
    available_quantity: number;
    coverage_quantity: number;
    coverage_status: "FULL" | "PARTIAL";
    lead_time_days: number;
    approval_required: boolean;
  }>;
  substitution_approval_required?: boolean;
  planning_horizon?: {
    start_date?: string | null;
    end_date?: string | null;
    bucket_count: number;
  } | null;
  supply_interventions?: SupplyIntervention[];
  unpegged_supply_quantity?: number;
  unpegged_supply_documents?: SupplyIntervention[];
  run_change?: {
    previous_run_id?: string | null;
    previous_recommended_quantity: number;
    quantity_delta: number;
    previous_required_by_date?: string | null;
    previous_release_by_date?: string | null;
    previous_supply_action?: string | null;
    change_codes: string[];
    classification: string;
    planning_time_fence_days: number;
    planning_time_fence_date?: string | null;
    action_date?: string | null;
    inside_time_fence: boolean;
    requires_planner_reapproval: boolean;
  } | null;
  demand_supply_pegging?: DemandSupplyPegging[];
  time_buckets?: Array<{
    required_by_date?: string | null;
    demand_quantity: number;
    on_time_supply_quantity: number;
    timing_gap_quantity: number;
    reschedule_quantity: number;
    confirm_date_quantity: number;
    recommended_supply_quantity: number;
    projected_available_quantity: number;
    demand_supply_pegging?: DemandSupplyPegging[];
    supply_interventions?: SupplyIntervention[];
  }>;
  safety_stock_quantity?: number;
  net_requirement: number;
  recommended_quantity?: number;
  required_by_date?: string | null;
  release_by_date?: string | null;
  exception_codes?: string[];
  supply_action: "MONITOR" | "BUY" | "BUILD";
  demand_references: Array<{
    source_type?: "JOB_ORDER" | "SALES_ORDER" | "APPROVED_FORECAST";
    job_order_number?: string;
    sales_order_number?: string;
    demand_plan_cycle_name?: string;
    forecast_month?: string;
    parent_item_id?: string;
    bom_level?: number;
    customer_due_date?: string | null;
    job_order_due_date?: string | null;
    parent_required_by_date?: string | null;
    parent_release_by_date?: string | null;
  }>;
  planner_decision?: {
    decision: string;
    adjusted_quantity?: number | null;
    adjusted_required_by_date?: string | null;
    preferred_supplier_id?: string | null;
    preferred_work_centre_id?: string | null;
    reason?: string | null;
  } | null;
};
type DemandSupplyPegging = {
  coverage_type:
    | "INITIAL_SUPPLY"
    | "ON_TIME_RECEIPT"
    | "RESCHEDULE_IN"
    | "CONFIRM_DATE"
    | "NEW_SUPPLY_RECOMMENDATION";
  source: string;
  document_type?: SupplyIntervention["document_type"] | null;
  document_id?: string | null;
  document_number?: string | null;
  document_line_id?: string | null;
  supply_date?: string | null;
  required_by_date?: string | null;
  quantity: number;
};
type SupplyIntervention = {
  intervention_type:
    | "RESCHEDULE_IN"
    | "CONFIRM_DATE"
    | "REVIEW_UNPEGGED_SUPPLY";
  source: "OPEN_PO" | "OPEN_BUILD" | "OPEN_PR" | "DRAFT_PO";
  document_type:
    | "PURCHASE_ORDER"
    | "PURCHASE_REQUISITION"
    | "PRODUCTION_JOB_ORDER";
  document_id: string;
  document_number: string;
  document_line_id?: string | null;
  status?: string;
  current_date?: string | null;
  required_date?: string | null;
  quantity: number;
  review_reason?:
    | "EXCESS_AFTER_HORIZON"
    | "FUTURE_UNPEGGED_RECEIPT"
    | "UNDATED_UNPEGGED_RECEIPT";
  suggested_action?:
    | "RESCHEDULE_OUT_OR_REDUCE"
    | "REVIEW_FUTURE_SUPPLY"
    | "CONFIRM_OR_CANCEL";
};
type Plan = {
  run: {
    demand_orders: number;
    material_lines: number;
    shortage_lines: number;
  } | null;
  lines: Line[];
  comparison?: {
    previous_run_id?: string | null;
    changed_lines: number;
    inside_time_fence: number;
    requires_planner_reapproval: number;
    by_classification: Record<string, number>;
  };
  forecast_consumption?: {
    active: boolean;
    demand_plan_cycle_id?: string | null;
    demand_plan_cycle_name?: string | null;
    forecast_buckets: number;
    residual_buckets: number;
    original_forecast_quantity: number;
    sales_consumed_quantity: number;
    residual_forecast_quantity: number;
  };
  reservation_summary?: {
    reserved_for_plan_quantity: number;
    reserved_elsewhere_quantity: number;
    mismatched_items: number;
  };
  policy_summary?: {
    substitution_opportunities: number;
    shelf_life_risks: number;
    maximum_stock_conflicts: number;
    single_batch_requirements: number;
    service_level_items: number;
  };
};
type ReleasePacket = {
  insight_id: string;
  type: "BUY" | "BUILD" | "SUPPLY_RESCHEDULE";
  title: string;
  explanation: string;
  line_ids: string[];
  tool_code: string;
  can_submit: boolean;
  governance?: ReleaseGovernance | null;
  readiness?: BuildReadiness;
  intervention?: SupplyIntervention;
  input: {
    required_date?: string;
    start_date?: string;
    end_date?: string;
    quantity?: number;
    items?: Array<{
      item_code?: string;
      item_name?: string;
      requested_qty: number;
      uom: string;
    }>;
  };
};
type ReleaseGovernance = {
  id: string;
  status:
    | "PENDING_APPROVAL"
    | "APPROVED"
    | "REJECTED"
    | "EXECUTING"
    | "EXECUTED"
    | "FAILED";
  created_at: string;
  approved_at?: string | null;
  rejected_at?: string | null;
  rejection_reason?: string | null;
  execution_started_at?: string | null;
  executed_at?: string | null;
  failure_reason?: string | null;
  native_resource_id?: string | null;
  native_result?: {
    id?: string | null;
    number?: string | null;
    route?: string | null;
  } | null;
};
type BuildReadiness = {
  ready: boolean;
  status: "READY" | "BLOCKED";
  reason?: string | null;
  required_capacity_minutes: number;
  available_capacity_minutes: number;
  committed_capacity_minutes: number;
  remaining_capacity_minutes: number;
  work_centres: Array<{
    work_station_id: string;
    operation_count: number;
    required_minutes: number;
    available_minutes: number;
    committed_minutes: number;
    remaining_minutes: number;
    status: "AVAILABLE" | "INSUFFICIENT" | "UNCONFIGURED";
  }>;
  checks: string[];
};
type ReleasePreview = {
  run: { id: string; run_at?: string; shortage_lines: number } | null;
  summary?: {
    selected_lines: number;
    eligible_lines: number;
    releasable_lines: number;
    blocked_lines: number;
    buy_packets: number;
    build_packets: number;
    supply_reschedule_packets: number;
    native_documents_created: number;
  };
  packets: ReleasePacket[];
  blocked_lines: Array<{
    line_id: string;
    item_code?: string;
    item_name?: string;
    reason: string;
    readiness?: BuildReadiness;
  }>;
  confirmation_required?: boolean;
  control: string;
};
type ReleaseLineTrace = {
  insight_id: string;
  title?: string | null;
  route?: string | null;
  release_type?: "BUY" | "BUILD" | "SUPPLY_RESCHEDULE" | null;
  governance: ReleaseGovernance;
};
type ReleaseStatus = {
  run_id: string | null;
  by_line: Record<string, ReleaseLineTrace>;
  release_count?: number;
};

const num = (value: number) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(
    Number(value || 0),
  );
const isReleaseEligible = (line: Line) =>
  ["APPROVED", "CHANGED"].includes(line.planner_decision?.decision || "") &&
  (((line.recommended_quantity || 0) > 0 &&
    ["BUY", "BUILD"].includes(line.supply_action)) ||
    (line.supply_interventions || []).length > 0 ||
    (line.unpegged_supply_documents || []).length > 0);

export default function MrpPage() {
  const [plan, setPlan] = useState<Plan>({ run: null, lines: [] });
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [release, setRelease] = useState<ReleasePreview | null>(null);
  const [releaseByLine, setReleaseByLine] = useState<
    Record<string, ReleaseLineTrace>
  >({});
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [review, setReview] = useState<{
    line: Line;
    decision: PlannerDecision;
  } | null>(null);
  const [submitted, setSubmitted] = useState<{
    submitted: number;
    reused: number;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await apiClient.get<Plan>("/mrp/latest");
      setPlan(next);
      if (next.run) {
        try {
          const releaseStatus = await apiClient.get<ReleaseStatus>(
            "/intelligence/mrp-release/status",
          );
          setReleaseByLine(releaseStatus.by_line || {});
        } catch {
          setReleaseByLine({});
        }
      } else {
        setReleaseByLine({});
      }
      setSelected((current) =>
        current.filter((id) => next.lines.some((line) => line.id === id)),
      );
    } catch (nextError: any) {
      setError(nextError?.message || "Unable to load MRP.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const eligibleIds = useMemo(
    () =>
      plan.lines
        .filter(isReleaseEligible)
        .filter((line) => {
          const status = releaseByLine[line.id]?.governance.status;
          return !status || ["REJECTED", "FAILED"].includes(status);
        })
        .map((line) => line.id),
    [plan.lines, releaseByLine],
  );
  const allEligibleSelected =
    eligibleIds.length > 0 && eligibleIds.every((id) => selected.includes(id));

  const run = async () => {
    setRunning(true);
    setError("");
    setRelease(null);
    setSelected([]);
    try {
      setPlan(await apiClient.post<Plan>("/mrp/run"));
    } catch (nextError: any) {
      setError(nextError?.message || "Unable to run material planning.");
    } finally {
      setRunning(false);
    }
  };
  const saveDecision = async (line: Line, payload: Record<string, unknown>) => {
    const next = await apiClient.patch<Plan>(
      `/mrp/lines/${line.id}/decision`,
      payload,
    );
    setPlan(next);
    setSelected((current) =>
      current.filter((id) =>
        next.lines.some(
          (candidate) => candidate.id === id && isReleaseEligible(candidate),
        ),
      ),
    );
    setRelease(null);
  };
  const previewRelease = async () => {
    if (!selected.length) return;
    setPreviewing(true);
    setError("");
    setSubmitted(null);
    try {
      setRelease(
        await apiClient.post<ReleasePreview>(
          "/intelligence/mrp-release/preview",
          { selected_line_ids: selected },
        ),
      );
    } catch (nextError: any) {
      setError(nextError?.message || "Release preview could not be prepared.");
    } finally {
      setPreviewing(false);
    }
  };
  const submitRelease = async () => {
    if (!release?.packets.some((packet) => packet.can_submit)) return;
    setSubmitting(true);
    setError("");
    try {
      const result = await apiClient.post<{
        summary: { submitted: number; reused: number };
      }>("/intelligence/mrp-release/request", {
        selected_line_ids: selected,
        confirm: true,
      });
      setSubmitted(result.summary);
      setRelease(null);
      await load();
    } catch (nextError: any) {
      setError(
        nextError?.message || "Release requests could not be submitted.",
      );
    } finally {
      setSubmitting(false);
    }
  };
  const toggle = (id: string) => {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((entry) => entry !== id)
        : [...current, id],
    );
    setRelease(null);
    setSubmitted(null);
  };

  return (
    <main className="mx-auto max-w-[1500px] space-y-5 p-2 sm:p-4">
      <section className="rounded-2xl bg-gradient-to-r from-[#253A63] to-[#476E9F] p-5 text-white shadow-lg sm:p-7">
        <div className="flex flex-col justify-between gap-4 sm:flex-row">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm text-blue-100">
              <Boxes size={18} />
              Controlled planning
            </div>
            <h1 className="text-2xl font-bold">
              Material Requirements Planning
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-blue-50">
              Net demand against stock, scheduled receipts and safety stock;
              apply MOQ/order multiples and capture an auditable planner
              decision.
            </p>
          </div>
          <button
            onClick={run}
            disabled={running}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-bold text-[#253A63] disabled:opacity-60"
          >
            {running ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Play size={16} />
            )}
            Run MRP
          </button>
        </div>
      </section>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {submitted && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <span>
            <CheckCircle2 className="mr-1 inline" size={16} />
            {submitted.submitted} maker-checker request(s) submitted. No PR or
            job order was created.
          </span>
          <Link
            href="/dashboard/command-center"
            className="font-bold underline"
          >
            Open approval queue
          </Link>
        </div>
      )}

      {plan.forecast_consumption?.active && (
        <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3 text-sm text-cyan-900">
          <b>
            Approved forecast:{" "}
            {plan.forecast_consumption.demand_plan_cycle_name}
          </b>{" "}
          · {num(plan.forecast_consumption.original_forecast_quantity)} forecast
          units · {num(plan.forecast_consumption.sales_consumed_quantity)}{" "}
          consumed by open sales orders ·{" "}
          {num(plan.forecast_consumption.residual_forecast_quantity)} residual
          units included in MRP. Actual and forecast demand are not
          double-counted.
        </div>
      )}

      {(plan.reservation_summary?.mismatched_items || 0) > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <b>Reservation reconciliation required:</b>{" "}
          {plan.reservation_summary?.mismatched_items} material item(s) have a
          difference between the inventory reserved balance and active
          reservation records. Their recommendations are escalated as critical
          exceptions.
        </div>
      )}

      {plan.policy_summary &&
        plan.policy_summary.substitution_opportunities +
          plan.policy_summary.shelf_life_risks +
          plan.policy_summary.maximum_stock_conflicts +
          plan.policy_summary.single_batch_requirements >
          0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <b>Planning-policy review:</b>{" "}
            {plan.policy_summary.substitution_opportunities} substitute
            opportunity(s), {plan.policy_summary.shelf_life_risks} shelf-life
            risk(s), {plan.policy_summary.maximum_stock_conflicts} maximum-stock
            conflict(s), and {plan.policy_summary.single_batch_requirements}{" "}
            single-batch requirement(s). No substitution or supply document has
            been created automatically.
          </div>
        )}

      <section className="grid gap-3 sm:grid-cols-4 xl:grid-cols-8">
        <Metric
          label="Demand sources / buckets"
          value={plan.run?.demand_orders || 0}
        />
        <Metric
          label="Materials planned"
          value={plan.run?.material_lines || 0}
        />
        <Metric
          label="Shortages to act on"
          value={plan.run?.shortage_lines || 0}
        />
        <Metric
          label="Changed since last run"
          value={plan.comparison?.changed_lines || 0}
        />
        <Metric
          label="Inside time fence"
          value={plan.comparison?.inside_time_fence || 0}
        />
        <Metric
          label="Forecast residual"
          value={plan.forecast_consumption?.residual_forecast_quantity || 0}
        />
        <Metric
          label="Reserved elsewhere"
          value={plan.reservation_summary?.reserved_elsewhere_quantity || 0}
        />
        <Metric
          label="Policy reviews"
          value={
            (plan.policy_summary?.substitution_opportunities || 0) +
            (plan.policy_summary?.shelf_life_risks || 0) +
            (plan.policy_summary?.maximum_stock_conflicts || 0) +
            (plan.policy_summary?.single_batch_requirements || 0)
          }
        />
      </section>

      <section className="rounded-xl border border-[#E8DCC4] bg-white p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">Planner workbench</h2>
            <p className="text-sm text-slate-500">
              Approve a recommendation, select it, then preview its governed
              release packet.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/dashboard/command-center/exceptions"
              className="rounded-lg border border-[#C7A770] bg-white px-3 py-2 text-sm font-semibold text-[#76552B]"
            >
              Exception queue
            </Link>
            <button
              onClick={previewRelease}
              disabled={!selected.length || previewing}
              className="inline-flex items-center gap-2 rounded-lg bg-[#76552B] px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {previewing ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <ShieldCheck size={15} />
              )}
              Preview release ({selected.length})
            </button>
            <button
              onClick={load}
              disabled={loading}
              className="inline-flex items-center gap-1 text-sm font-semibold"
            >
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>
        </div>
        {loading ? (
          <Loading />
        ) : !plan.run ? (
          <Empty text="No plan has been run." />
        ) : !plan.lines.length ? (
          <Empty text="No material requirements exist on open job orders." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[1940px] text-left text-sm">
              <thead className="border-b text-xs uppercase text-slate-500">
                <tr>
                  <th className="p-2">
                    <input
                      aria-label="Select all approved recommendations"
                      type="checkbox"
                      checked={allEligibleSelected}
                      disabled={!eligibleIds.length}
                      onChange={() => {
                        setSelected(allEligibleSelected ? [] : eligibleIds);
                        setRelease(null);
                      }}
                    />
                  </th>
                  <th className="p-2">Material</th>
                  {[
                    "Gross",
                    "Issued",
                    "Physical",
                    "For this plan",
                    "Reserved elsewhere",
                    "Usable",
                    "Open PR",
                    "Draft PO",
                    "Open PO",
                    "Open build",
                    "Late / undated",
                    "Safety",
                    "Net",
                    "Plan qty",
                  ].map((label) => (
                    <th key={label} className="p-2 text-right">
                      {label}
                    </th>
                  ))}
                  <th className="p-2">Dates / exceptions</th>
                  <th className="p-2">Action</th>
                  <th className="p-2">Planner control</th>
                </tr>
              </thead>
              <tbody>
                {plan.lines.map((line) => {
                  const trace = releaseByLine[line.id];
                  const eligible = eligibleIds.includes(line.id);
                  const demandLabels = Array.from(
                    new Set(
                      (line.demand_references || [])
                        .map(
                          (entry) =>
                            entry.job_order_number ||
                            entry.sales_order_number ||
                            (entry.source_type === "APPROVED_FORECAST"
                              ? `${entry.demand_plan_cycle_name || "Approved forecast"} ${entry.forecast_month || ""}`.trim()
                              : undefined),
                        )
                        .filter(Boolean),
                    ),
                  );
                  const deepestBomLevel = Math.max(
                    0,
                    ...(line.demand_references || []).map((entry) =>
                      Number(entry.bom_level || 0),
                    ),
                  );
                  const originDueDate = (line.demand_references || [])
                    .map(
                      (entry) =>
                        entry.customer_due_date || entry.job_order_due_date,
                    )
                    .filter(Boolean)
                    .sort()[0];
                  const decisionLocked = Boolean(
                    trace &&
                    [
                      "PENDING_APPROVAL",
                      "APPROVED",
                      "EXECUTING",
                      "EXECUTED",
                    ].includes(trace.governance.status),
                  );
                  return (
                    <tr key={line.id} className="border-b align-top">
                      <td className="p-2">
                        <input
                          aria-label={`Select ${line.item_code || line.item_name || "line"}`}
                          type="checkbox"
                          checked={selected.includes(line.id)}
                          disabled={!eligible}
                          onChange={() => toggle(line.id)}
                        />
                      </td>
                      <td className="p-2">
                        <b>{line.item_name || "Unnamed item"}</b>
                        <small className="block text-slate-500">
                          {line.item_code || "—"} ·{" "}
                          {demandLabels.join(", ") || "Open demand"}
                          {deepestBomLevel > 1
                            ? ` · BOM level ${deepestBomLevel}`
                            : ""}
                        </small>
                        {(line.approved_forecast_quantity || 0) > 0 && (
                          <small className="mt-1 block font-semibold text-cyan-700">
                            Forecast residual:{" "}
                            {num(line.approved_forecast_quantity || 0)}
                          </small>
                        )}
                        {(line.reservation_evidence || []).length > 0 && (
                          <details className="mt-1 text-xs text-slate-600">
                            <summary className="cursor-pointer font-semibold text-violet-700">
                              {(line.reservation_evidence || []).length}{" "}
                              reservation record(s)
                            </summary>
                            {(line.reservation_evidence || []).map(
                              (reservation) => (
                                <div key={reservation.reservation_id}>
                                  {reservation.reference_number ||
                                    reservation.reference_type ||
                                    "Reservation"}{" "}
                                  · {num(reservation.reserved_quantity)} ·{" "}
                                  {reservation.allocation === "CURRENT_PLAN"
                                    ? "for this plan"
                                    : "other demand"}
                                </div>
                              ),
                            )}
                          </details>
                        )}
                        <details className="mt-1 text-xs text-slate-600">
                          <summary className="cursor-pointer font-semibold text-blue-700">
                            Planning policy ·{" "}
                            {(
                              line.lot_sizing_policy || "LOT_FOR_LOT"
                            ).replaceAll("_", " ")}
                          </summary>
                          <div>
                            Safety: {num(line.safety_stock_quantity || 0)} ·{" "}
                            {line.safety_stock_calculation?.explanation ||
                              "No calculation evidence"}
                          </div>
                          {(line.rounding_excess_quantity || 0) > 0 && (
                            <div>
                              Lot-rounding excess:{" "}
                              {num(line.rounding_excess_quantity || 0)}
                            </div>
                          )}
                          {line.maximum_stock_quantity != null && (
                            <div
                              className={
                                line.maximum_stock_conflict
                                  ? "font-semibold text-red-700"
                                  : ""
                              }
                            >
                              Maximum stock: {num(line.maximum_stock_quantity)}
                              {line.maximum_stock_conflict ? " · conflict" : ""}
                            </div>
                          )}
                          {line.batch_constraint &&
                            line.batch_constraint !== "NONE" && (
                              <div>Batch policy: {line.batch_constraint}</div>
                            )}
                          {line.planning_horizon && (
                            <div>
                              Horizon: {line.planning_horizon.start_date || "—"}{" "}
                              to {line.planning_horizon.end_date || "—"} ·{" "}
                              {line.planning_horizon.bucket_count} bucket(s)
                            </div>
                          )}
                          {(line.substitution_candidates || []).map(
                            (candidate) => (
                              <div
                                key={candidate.item_id}
                                className="font-semibold text-emerald-700"
                              >
                                Alternate{" "}
                                {candidate.item_code || candidate.item_name}:{" "}
                                {num(candidate.coverage_quantity)} coverage (
                                {candidate.coverage_status}) · approval required
                              </div>
                            ),
                          )}
                        </details>
                      </td>
                      <N v={line.gross_requirement} />
                      <N v={line.issued_quantity} />
                      <N v={line.physical_stock_quantity || 0} />
                      <N v={line.reserved_for_plan_quantity || 0} />
                      <N
                        v={line.reserved_elsewhere_quantity || 0}
                        risk={(line.reserved_elsewhere_quantity || 0) > 0}
                      />
                      <N v={line.available_quantity} />
                      <N v={line.open_requisition_quantity || 0} />
                      <N v={line.open_draft_po_quantity || 0} />
                      <N v={line.scheduled_purchase_quantity || 0} />
                      <N v={line.scheduled_production_quantity || 0} />
                      <N
                        v={
                          (line.late_supply_quantity || 0) +
                          (line.undated_supply_quantity || 0)
                        }
                        risk={
                          (line.late_supply_quantity || 0) +
                            (line.undated_supply_quantity || 0) >
                          0
                        }
                      />
                      <N v={line.safety_stock_quantity || 0} />
                      <N
                        v={line.net_requirement}
                        risk={line.net_requirement > 0}
                      />
                      <N v={line.recommended_quantity || 0} />
                      <td className="p-2 text-xs">
                        {originDueDate &&
                          originDueDate !== line.required_by_date && (
                            <div>Origin due: {originDueDate}</div>
                          )}
                        <div>Need: {line.required_by_date || "—"}</div>
                        <div>Release: {line.release_by_date || "—"}</div>
                        {(line.reschedule_quantity || 0) > 0 && (
                          <div className="font-semibold text-amber-700">
                            Reschedule in: {num(line.reschedule_quantity || 0)}
                          </div>
                        )}
                        {(line.confirm_date_quantity || 0) > 0 && (
                          <div className="font-semibold text-amber-700">
                            Confirm supply date:{" "}
                            {num(line.confirm_date_quantity || 0)}
                          </div>
                        )}
                        {line.recommended_intervention &&
                          line.recommended_intervention !== "MONITOR" && (
                            <div className="font-semibold text-blue-700">
                              {line.recommended_intervention.replaceAll(
                                "_",
                                " ",
                              )}
                            </div>
                          )}
                        {line.run_change && (
                          <details
                            className={`mt-1 rounded border p-1 ${
                              line.run_change.requires_planner_reapproval
                                ? "border-red-200 bg-red-50"
                                : "border-blue-200 bg-blue-50"
                            }`}
                          >
                            <summary
                              className={`cursor-pointer font-semibold ${
                                line.run_change.requires_planner_reapproval
                                  ? "text-red-800"
                                  : "text-blue-800"
                              }`}
                            >
                              {line.run_change.classification.replaceAll(
                                "_",
                                " ",
                              )}
                              {line.run_change.inside_time_fence
                                ? " · inside time fence"
                                : ""}
                            </summary>
                            <div className="mt-1 space-y-0.5 text-slate-600">
                              <div>
                                Previous qty{" "}
                                {num(
                                  line.run_change.previous_recommended_quantity,
                                )}{" "}
                                · delta {num(line.run_change.quantity_delta)}
                              </div>
                              {line.run_change.previous_required_by_date && (
                                <div>
                                  Previous need:{" "}
                                  {line.run_change.previous_required_by_date}
                                </div>
                              )}
                              <div>
                                Fence:{" "}
                                {line.run_change.planning_time_fence_date} (
                                {line.run_change.planning_time_fence_days} days)
                              </div>
                              {line.run_change.change_codes.map((code) => (
                                <div key={code}>
                                  {code.replaceAll("_", " ")}
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                        {(line.supply_interventions || []).length > 0 && (
                          <details className="mt-1 rounded border border-amber-200 bg-amber-50 p-1">
                            <summary className="cursor-pointer font-semibold text-amber-800">
                              {line.supply_interventions?.length} pegged
                              document action(s)
                            </summary>
                            <div className="mt-1 space-y-1">
                              {(line.supply_interventions || []).map(
                                (intervention, index) => (
                                  <div
                                    key={`${intervention.document_line_id || intervention.document_id}-${index}`}
                                    className="border-t border-amber-200 pt-1"
                                  >
                                    <b>{intervention.document_number}</b> ·{" "}
                                    {num(intervention.quantity)} ·{" "}
                                    {intervention.intervention_type ===
                                    "CONFIRM_DATE"
                                      ? "confirm for"
                                      : `${intervention.current_date || "undated"} →`}{" "}
                                    {intervention.required_date ||
                                      "date required"}
                                  </div>
                                ),
                              )}
                            </div>
                          </details>
                        )}
                        {(line.unpegged_supply_documents || []).length > 0 && (
                          <details className="mt-1 rounded border border-violet-200 bg-violet-50 p-1">
                            <summary className="cursor-pointer font-semibold text-violet-800">
                              {num(line.unpegged_supply_quantity || 0)} unpegged
                              across {line.unpegged_supply_documents?.length}{" "}
                              document line(s)
                            </summary>
                            <div className="mt-1 space-y-1">
                              {(line.unpegged_supply_documents || []).map(
                                (review, index) => (
                                  <div
                                    key={`${review.document_line_id || review.document_id}-${index}`}
                                    className="border-t border-violet-200 pt-1"
                                  >
                                    <b>{review.document_number}</b> ·{" "}
                                    {num(review.quantity)} ·{" "}
                                    {String(
                                      review.suggested_action || "REVIEW",
                                    ).replaceAll("_", " ")}
                                    {review.current_date
                                      ? ` · ${review.current_date}`
                                      : " · no date"}
                                  </div>
                                ),
                              )}
                            </div>
                          </details>
                        )}
                        {(line.time_buckets || []).length > 0 && (
                          <details className="mt-1 rounded border border-slate-200 bg-slate-50 p-1">
                            <summary className="cursor-pointer font-semibold text-slate-700">
                              {line.time_buckets?.length} time bucket(s) · PAB{" "}
                              {num(line.projected_available_quantity || 0)}
                            </summary>
                            <div className="mt-1 space-y-1">
                              {(line.time_buckets || []).map(
                                (bucket, index) => (
                                  <div
                                    key={`${bucket.required_by_date || "unscheduled"}-${index}`}
                                    className="border-t border-slate-200 pt-1"
                                  >
                                    <div>
                                      {bucket.required_by_date || "Unscheduled"}
                                      : demand {num(bucket.demand_quantity)},
                                      on-time{" "}
                                      {num(bucket.on_time_supply_quantity)}, gap{" "}
                                      {num(bucket.timing_gap_quantity)}, new{" "}
                                      {num(bucket.recommended_supply_quantity)},
                                      PAB{" "}
                                      {num(bucket.projected_available_quantity)}
                                    </div>
                                    {(bucket.demand_supply_pegging || []).map(
                                      (pegging, peggingIndex) => (
                                        <div
                                          key={`${pegging.document_line_id || pegging.coverage_type}-${peggingIndex}`}
                                          className="ml-2 text-slate-500"
                                        >
                                          Covered: {num(pegging.quantity)} from{" "}
                                          <b>
                                            {pegging.document_number ||
                                              pegging.coverage_type.replaceAll(
                                                "_",
                                                " ",
                                              )}
                                          </b>
                                          {pegging.supply_date
                                            ? ` (${pegging.supply_date})`
                                            : ""}
                                        </div>
                                      ),
                                    )}
                                  </div>
                                ),
                              )}
                            </div>
                          </details>
                        )}
                        {(line.exception_codes || []).map((code) => (
                          <div
                            key={code}
                            className="font-semibold text-red-700"
                          >
                            {code.replaceAll("_", " ")}
                          </div>
                        ))}
                      </td>
                      <td className="p-2">
                        {line.supply_action === "BUY" ? (
                          <Badge
                            icon={<ShoppingCart size={13} />}
                            text="Buy"
                            colour="amber"
                          />
                        ) : line.supply_action === "BUILD" ? (
                          <Badge
                            icon={<Wrench size={13} />}
                            text="Build"
                            colour="blue"
                          />
                        ) : (
                          <Badge
                            icon={<Boxes size={13} />}
                            text="Monitor"
                            colour="green"
                          />
                        )}
                      </td>
                      <td className="p-2">
                        <div className="mb-1 text-xs font-bold">
                          {line.planner_decision?.decision || "PENDING"}
                        </div>
                        {trace ? (
                          <div className="mb-2 space-y-1 rounded border border-slate-200 bg-slate-50 p-2 text-xs">
                            <ReleaseState status={trace.governance.status} />
                            <div className="flex flex-wrap gap-2 pt-1 font-semibold">
                              <Link
                                href="/dashboard/command-center/actions"
                                className="text-blue-700 hover:underline"
                              >
                                Approval trail
                              </Link>
                              {trace.governance.status === "EXECUTED" &&
                                trace.governance.native_result?.route && (
                                  <Link
                                    href={trace.governance.native_result.route}
                                    className="text-emerald-700 hover:underline"
                                  >
                                    {trace.governance.native_result.number ||
                                      "Created document"}
                                  </Link>
                                )}
                            </div>
                          </div>
                        ) : (
                          isReleaseEligible(line) && (
                            <div className="mb-2 text-xs font-semibold text-slate-500">
                              Not released
                            </div>
                          )
                        )}
                        {line.planner_decision?.adjusted_quantity != null && (
                          <div className="mb-1 text-xs text-slate-500">
                            Approved qty{" "}
                            {num(line.planner_decision.adjusted_quantity)}
                          </div>
                        )}
                        {line.planner_decision?.adjusted_required_by_date && (
                          <div className="mb-1 text-xs text-slate-500">
                            Due{" "}
                            {line.planner_decision.adjusted_required_by_date}
                          </div>
                        )}
                        {(line.net_requirement > 0 ||
                          (line.unpegged_supply_documents || []).length > 0) &&
                          !decisionLocked && (
                            <div className="flex flex-wrap gap-1">
                              {(
                                [
                                  "APPROVED",
                                  "CHANGED",
                                  "DEFERRED",
                                  "REJECTED",
                                ] as PlannerDecision[]
                              ).map((decision) => (
                                <button
                                  key={decision}
                                  onClick={() => setReview({ line, decision })}
                                  className="rounded border px-2 py-1 text-xs"
                                >
                                  {decision[0] +
                                    decision.slice(1).toLowerCase()}
                                </button>
                              ))}
                            </div>
                          )}
                        {decisionLocked && (
                          <div className="text-xs font-semibold text-slate-500">
                            Planner decision locked by governed release
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {release && (
        <section className="space-y-4 rounded-xl border-2 border-[#C7A770] bg-[#FFFCF6] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 font-bold text-[#5C421F]">
                <ShieldCheck size={18} />
                Planner release control
              </div>
              <p className="mt-1 max-w-4xl text-sm text-slate-600">
                {release.control}
              </p>
            </div>
            <div className="rounded-lg bg-white px-3 py-2 text-sm">
              <b>{release.packets.length}</b> request packet(s) ·{" "}
              <b>{release.summary?.native_documents_created || 0}</b> native
              document(s)
            </div>
          </div>
          {release.blocked_lines.length > 0 && (
            <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <b>{release.blocked_lines.length} selected line(s) are blocked</b>
              {release.blocked_lines.map((line) => (
                <div
                  key={line.line_id}
                  className="rounded border border-amber-200 bg-white/70 p-2 text-xs"
                >
                  <b>{line.item_code || line.item_name || line.line_id}</b> ·{" "}
                  {line.reason}
                </div>
              ))}
            </div>
          )}
          <div className="grid gap-3 lg:grid-cols-2">
            {release.packets.map((packet) => (
              <article
                key={packet.insight_id}
                className="rounded-lg border bg-white p-4"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <Badge
                    icon={
                      packet.type === "BUY" ? (
                        <ShoppingCart size={13} />
                      ) : packet.type === "SUPPLY_RESCHEDULE" ? (
                        <RefreshCw size={13} />
                      ) : (
                        <Wrench size={13} />
                      )
                    }
                    text={
                      packet.type === "BUY"
                        ? "Draft PR request"
                        : packet.type === "SUPPLY_RESCHEDULE"
                          ? "Supply review request"
                          : "Draft job-order request"
                    }
                    colour={
                      packet.type === "BUY" ||
                      packet.type === "SUPPLY_RESCHEDULE"
                        ? "amber"
                        : "blue"
                    }
                  />
                  <div className="flex items-center gap-2">
                    {packet.governance && (
                      <ReleaseState status={packet.governance.status} />
                    )}
                    <span className="text-xs text-slate-500">
                      {packet.line_ids.length} MRP line(s)
                    </span>
                  </div>
                </div>
                <h3 className="font-semibold">{packet.title}</h3>
                <p className="mt-1 text-sm text-slate-600">
                  {packet.explanation}
                </p>
                {packet.type === "BUY" ? (
                  <ul className="mt-3 space-y-1 text-xs text-slate-600">
                    {(packet.input.items || []).map((item, index) => (
                      <li key={`${item.item_code}-${index}`}>
                        {item.item_code || item.item_name}:{" "}
                        {num(item.requested_qty)} {item.uom}
                      </li>
                    ))}
                  </ul>
                ) : packet.type === "SUPPLY_RESCHEDULE" ? (
                  <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                    <b>{packet.intervention?.document_number}</b> ·{" "}
                    {num(packet.intervention?.quantity || 0)} ·{" "}
                    {packet.intervention?.current_date || "No current date"} →{" "}
                    {packet.intervention?.required_date || "Date required"}
                    <div className="mt-1">
                      Approval creates a review task only. The source document
                      is unchanged.
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 space-y-2 text-xs text-slate-600">
                    <div>
                      Quantity {num(packet.input.quantity || 0)} · Start{" "}
                      {packet.input.start_date} · Due {packet.input.end_date}
                    </div>
                    {packet.readiness && (
                      <div className="rounded border border-emerald-200 bg-emerald-50 p-2 text-emerald-800">
                        <b>Finite capacity passed</b> · Required{" "}
                        {num(packet.readiness.required_capacity_minutes / 60)} h
                        · Remaining{" "}
                        {num(packet.readiness.remaining_capacity_minutes / 60)}{" "}
                        h across {packet.readiness.work_centres.length} routed
                        work centre(s)
                      </div>
                    )}
                  </div>
                )}
                {packet.governance && (
                  <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                    <div className="font-semibold">
                      Governed request {packet.governance.id.slice(0, 8)}
                    </div>
                    {packet.governance.status === "PENDING_APPROVAL" && (
                      <p className="mt-1">
                        Waiting for an independent approver.
                      </p>
                    )}
                    {packet.governance.status === "APPROVED" && (
                      <p className="mt-1">
                        Approved and waiting for explicit execution.
                      </p>
                    )}
                    {packet.governance.status === "EXECUTING" && (
                      <p className="mt-1">
                        Native draft creation is in progress.
                      </p>
                    )}
                    {packet.governance.status === "REJECTED" && (
                      <p className="mt-1 text-red-700">
                        Rejected:{" "}
                        {packet.governance.rejection_reason ||
                          "No reason recorded."}{" "}
                        Change the planner decision before releasing again.
                      </p>
                    )}
                    {packet.governance.status === "FAILED" && (
                      <p className="mt-1 text-red-700">
                        Execution failed:{" "}
                        {packet.governance.failure_reason ||
                          "No reason recorded."}{" "}
                        Review this request in the action queue.
                      </p>
                    )}
                    {packet.governance.status === "EXECUTED" && (
                      <p className="mt-1 text-emerald-800">
                        Created{" "}
                        {packet.governance.native_result?.number ||
                          "native draft"}
                        .
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-3 font-semibold">
                      <Link
                        href="/dashboard/command-center/actions"
                        className="text-blue-700 hover:underline"
                      >
                        Open approval trail
                      </Link>
                      {packet.governance.status === "EXECUTED" &&
                        packet.governance.native_result?.route && (
                          <Link
                            href={packet.governance.native_result.route}
                            className="text-emerald-700 hover:underline"
                          >
                            Open created document
                          </Link>
                        )}
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <p className="text-xs text-slate-600">
              Submission only enters the approval queue. A different authorized
              user must approve, and execution is a separate step.
            </p>
            <button
              onClick={submitRelease}
              disabled={
                !release.packets.some((packet) => packet.can_submit) ||
                submitting
              }
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
            >
              {submitting ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Send size={16} />
              )}
              {release.packets.some((packet) => packet.can_submit)
                ? "Confirm and submit new packet(s)"
                : "Already in governed workflow"}
            </button>
          </div>
        </section>
      )}

      <p className="text-xs text-slate-500">
        Recommendations remain advisory until maker-checker release is approved
        and explicitly executed. Native PRs and job orders remain drafts in
        their own workflows.
      </p>
      {review && (
        <PlannerDecisionDialog
          line={review.line}
          initialDecision={review.decision}
          onClose={() => setReview(null)}
          onSave={(payload) => saveDecision(review.line, payload)}
        />
      )}
    </main>
  );
}

function N({ v, risk = false }: { v: number; risk?: boolean }) {
  return (
    <td
      className={`p-2 text-right ${risk ? "font-semibold text-red-700" : ""}`}
    >
      {num(v)}
    </td>
  );
}
function ReleaseState({ status }: { status: ReleaseGovernance["status"] }) {
  const labels: Record<ReleaseGovernance["status"], string> = {
    PENDING_APPROVAL: "Pending approval",
    APPROVED: "Approved",
    REJECTED: "Rejected",
    EXECUTING: "Executing",
    EXECUTED: "Executed",
    FAILED: "Failed",
  };
  const style =
    status === "EXECUTED"
      ? "bg-emerald-100 text-emerald-800"
      : status === "REJECTED" || status === "FAILED"
        ? "bg-red-100 text-red-800"
        : status === "APPROVED"
          ? "bg-blue-100 text-blue-800"
          : "bg-amber-100 text-amber-800";
  return (
    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${style}`}>
      {labels[status]}
    </span>
  );
}
function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-[#E8DCC4] bg-white p-4">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}
function Badge({
  icon,
  text,
  colour,
}: {
  icon: React.ReactNode;
  text: string;
  colour: "amber" | "blue" | "green";
}) {
  const styles = {
    amber: "bg-amber-50 text-amber-700",
    blue: "bg-blue-50 text-blue-700",
    green: "bg-emerald-50 text-emerald-700",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${styles[colour]}`}
    >
      {icon}
      {text}
    </span>
  );
}
function Loading() {
  return (
    <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
      <Loader2 size={16} className="animate-spin" />
      Loading plan...
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-6 text-sm text-slate-500">
      {text}
    </div>
  );
}
