import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { PurchaseRequisitionsService } from "../purchase/services/purchase-requisitions.service";
import { JobOrderService } from "../production/services/job-order.service";

type Explosion = {
  itemId: string;
  parentItemId: string;
  level: number;
  quantity: number;
  scrapPct: number;
  buildable: boolean;
  bomId?: string;
};

export function salesOrderOpenQuantity(line: any) {
  const ordered = Number(line?.quantity || 0),
    dispatched = Number(line?.dispatched_quantity || 0);
  return Math.max(
    0,
    Number.isFinite(ordered - dispatched) ? ordered - dispatched : 0,
  );
}

export function salesOrderDemandDate(order: any, line: any) {
  return String(
    line?.promised_date || order?.expected_delivery_date || "",
  ).slice(0, 10);
}

export function toolResourceUsable(tool: any, planningDate: string): boolean {
  const date = String(planningDate || "").slice(0, 10);
  const cycles = Number(tool?.cycles_used || 0);
  const limit =
    tool?.life_limit_cycles == null ? null : Number(tool.life_limit_cycles);
  if (String(tool?.status || "").toUpperCase() !== "AVAILABLE") return false;
  if (Number(tool?.available_quantity || 0) <= 0) return false;
  if (tool?.valid_until && String(tool.valid_until).slice(0, 10) < date)
    return false;
  if (limit != null && Number.isFinite(limit) && cycles >= limit) return false;
  if (!tool?.calibration_required) return true;
  if (String(tool?.calibration_status || "").toUpperCase() !== "VALID")
    return false;
  return Boolean(
    tool?.next_calibration_due &&
    String(tool.next_calibration_due).slice(0, 10) >= date,
  );
}

export type DailyCapacity = {
  work_date: string;
  source: "CAPACITY_SLOT" | "SHIFT_PLAN" | "DEFAULT_WEEKDAY" | "CLOSED";
  base_minutes: number;
  downtime_minutes: number;
  maintenance_minutes: number;
  available_minutes: number;
};

export function buildDailyCapacityCalendar(input: {
  stationId: string;
  startDate: string;
  endDate: string;
  defaultDailyMinutes: number;
  slots?: any[];
  shifts?: any[];
  downtimes?: any[];
  maintenance?: Array<{ date: string; minutes: number }>;
  holidays?: Iterable<string>;
}): DailyCapacity[] {
  const number = (value: any) => {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const date = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00Z`);
  const holidays = new Set(input.holidays || []);
  const downtimeByShift = new Map<string, number>();
  for (const row of input.downtimes || []) {
    const id = String(row.shift_id || "");
    downtimeByShift.set(
      id,
      (downtimeByShift.get(id) || 0) + number(row.downtime_minutes),
    );
  }
  const maintenanceByDate = new Map<string, number>();
  for (const row of input.maintenance || []) {
    const day = String(row.date || "").slice(0, 10);
    if (!day) continue;
    maintenanceByDate.set(
      day,
      (maintenanceByDate.get(day) || 0) + number(row.minutes),
    );
  }
  const output: DailyCapacity[] = [];
  const cursor = date(input.startDate);
  const end = date(input.endDate);
  while (cursor <= end) {
    const day = cursor.toISOString().slice(0, 10);
    const daySlots = (input.slots || []).filter(
      (row: any) =>
        String(row.work_station_id) === input.stationId &&
        String(row.work_date).slice(0, 10) === day,
    );
    const dayShifts = (input.shifts || []).filter(
      (row: any) =>
        String(row.work_station_id) === input.stationId &&
        String(row.work_date).slice(0, 10) === day,
    );
    const weekend = [0, 6].includes(cursor.getUTCDay());
    let source: DailyCapacity["source"] = "CLOSED";
    let base = 0;
    let downtime = 0;
    if (daySlots.length) {
      source = "CAPACITY_SLOT";
      base = daySlots.reduce(
        (sum: number, row: any) => sum + number(row.available_minutes),
        0,
      );
    } else if (dayShifts.length) {
      source = "SHIFT_PLAN";
      base = dayShifts.reduce(
        (sum: number, row: any) => sum + number(row.planned_production_minutes),
        0,
      );
      downtime = dayShifts.reduce(
        (sum: number, row: any) =>
          sum + (downtimeByShift.get(String(row.id)) || 0),
        0,
      );
    } else if (!weekend && !holidays.has(day)) {
      source = "DEFAULT_WEEKDAY";
      base = Math.max(0, number(input.defaultDailyMinutes));
    }
    const maintenance = maintenanceByDate.get(day) || 0;
    output.push({
      work_date: day,
      source,
      base_minutes: Number(base.toFixed(2)),
      downtime_minutes: Number(downtime.toFixed(2)),
      maintenance_minutes: Number(maintenance.toFixed(2)),
      available_minutes: Number(
        Math.max(0, base - downtime - maintenance).toFixed(2),
      ),
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return output;
}

export function allocateCapacityBackward(
  requiredMinutes: number,
  dueDate: string,
  calendar: DailyCapacity[],
  reservations = new Map<string, number>(),
) {
  let remaining = Math.max(0, Number(requiredMinutes || 0));
  const allocations: Array<{ work_date: string; minutes: number }> = [];
  const eligible = calendar
    .filter((day) => day.work_date <= dueDate)
    .sort((a, b) => b.work_date.localeCompare(a.work_date));
  for (const day of eligible) {
    if (remaining <= 0) break;
    const free = Math.max(
      0,
      day.available_minutes - (reservations.get(day.work_date) || 0),
    );
    const minutes = Math.min(free, remaining);
    if (minutes <= 0) continue;
    reservations.set(
      day.work_date,
      (reservations.get(day.work_date) || 0) + minutes,
    );
    allocations.push({ work_date: day.work_date, minutes });
    remaining -= minutes;
  }
  const dates = allocations.map((row) => row.work_date).sort();
  return {
    allocations,
    planned_start: dates[0] || null,
    planned_end: dates.at(-1) || null,
    allocated_minutes: Number(
      allocations.reduce((sum, row) => sum + row.minutes, 0).toFixed(2),
    ),
    unallocated_minutes: Number(Math.max(0, remaining).toFixed(2)),
  };
}

export function projectCapacityRecoveryDate(
  dueDate: string,
  shortageMinutes: number,
  defaultDailyMinutes: number,
  holidays: Iterable<string> = [],
) {
  let remaining = Math.max(0, Number(shortageMinutes || 0));
  const daily = Math.max(1, Number(defaultDailyMinutes || 480));
  const closed = new Set(holidays);
  const cursor = new Date(`${dueDate.slice(0, 10)}T00:00:00Z`);
  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.toISOString().slice(0, 10);
    if ([0, 6].includes(cursor.getUTCDay()) || closed.has(day)) continue;
    remaining -= daily;
  }
  return cursor.toISOString().slice(0, 10);
}

export function simulatePlanningScenario(
  base: {
    dueDate: string;
    projectedCompletionDate: string;
    requiredOvertimeMinutes: number;
    deliveryConfidencePct: number;
    materialCashRequired: number;
    cashBudget?: number | null;
    criticalMaterialCount: number;
    defaultDailyMinutes?: number;
  },
  changes: {
    overtimeMinutes?: number;
    alternateCapacityMinutes?: number;
    supplierAccelerationDays?: number;
    additionalBudget?: number;
    dueDateExtensionDays?: number;
  },
) {
  const n = (value: any) => {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  };
  const addDays = (value: string, days: number) => {
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };
  const daysBetween = (from: string, to: string) =>
    Math.max(
      0,
      Math.ceil(
        (new Date(`${to}T00:00:00Z`).getTime() -
          new Date(`${from}T00:00:00Z`).getTime()) /
          86400000,
      ),
    );
  const requiredCapacity = n(base.requiredOvertimeMinutes);
  const addedCapacity =
    n(changes.overtimeMinutes) + n(changes.alternateCapacityMinutes);
  const recoveredCapacity = Math.min(requiredCapacity, addedCapacity);
  const residualCapacity = Math.max(0, requiredCapacity - addedCapacity);
  const dailyMinutes = Math.max(1, n(base.defaultDailyMinutes) || 480);
  const capacityDaysRecovered = Math.min(
    daysBetween(base.dueDate, base.projectedCompletionDate),
    Math.ceil(recoveredCapacity / dailyMinutes),
  );
  const supplierDays =
    n(base.criticalMaterialCount) > 0
      ? Math.floor(n(changes.supplierAccelerationDays))
      : 0;
  const scenarioDueDate = addDays(
    base.dueDate,
    Math.floor(n(changes.dueDateExtensionDays)),
  );
  const projectedCompletionDate = addDays(
    base.projectedCompletionDate,
    -(capacityDaysRecovered + supplierDays),
  );
  const budgetConfigured = base.cashBudget != null;
  const availableBudget = budgetConfigured
    ? n(base.cashBudget) + n(changes.additionalBudget)
    : null;
  const cashGap = budgetConfigured
    ? Math.max(0, n(base.materialCashRequired) - Number(availableBudget))
    : 0;
  const capacityImprovement = requiredCapacity
    ? recoveredCapacity / requiredCapacity
    : 0;
  const cashImprovement =
    budgetConfigured && n(base.materialCashRequired)
      ? Math.min(1, n(changes.additionalBudget) / n(base.materialCashRequired))
      : 0;
  const confidence = Math.min(
    98,
    n(base.deliveryConfidencePct) +
      capacityImprovement * 20 +
      Math.min(15, supplierDays * 3) +
      cashImprovement * 10 +
      Math.min(10, n(changes.dueDateExtensionDays) * 2),
  );
  const delayDays = daysBetween(scenarioDueDate, projectedCompletionDate);
  const riskScore = Math.max(
    0,
    Math.min(
      100,
      delayDays * 12 +
        (requiredCapacity ? (residualCapacity / requiredCapacity) * 35 : 0) +
        (cashGap > 0 ? 20 : 0) +
        Math.max(0, n(base.criticalMaterialCount) * 5 - supplierDays * 2),
    ),
  );
  return {
    scenario_due_date: scenarioDueDate,
    projected_completion_date: projectedCompletionDate,
    delivery_status:
      projectedCompletionDate <= scenarioDueDate && residualCapacity === 0
        ? "ON_TIME"
        : "AT_RISK",
    confidence_pct: Number(confidence.toFixed(2)),
    risk_score: Number(riskScore.toFixed(2)),
    added_capacity_minutes: Number(addedCapacity.toFixed(2)),
    recovered_capacity_minutes: Number(recoveredCapacity.toFixed(2)),
    residual_capacity_shortage_minutes: Number(residualCapacity.toFixed(2)),
    capacity_days_recovered: capacityDaysRecovered,
    supplier_acceleration_days: supplierDays,
    available_budget: availableBudget,
    residual_cash_gap: Number(cashGap.toFixed(2)),
    critical_material_count: Math.floor(n(base.criticalMaterialCount)),
  };
}

export function buildExecutionVarianceSnapshot(input: {
  conversions?: any[];
  jobs?: any[];
  materials?: any[];
  stages?: any[];
  today: string;
}) {
  const n = (value: any) => {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const dateOnly = (value: any) => String(value || "").slice(0, 10);
  const dayVariance = (planned: string, actual: string) => {
    if (!planned || !actual) return null;
    return Math.round(
      (new Date(`${actual}T00:00:00Z`).getTime() -
        new Date(`${planned}T00:00:00Z`).getTime()) /
        86400000,
    );
  };
  const planByConversion = new Map<string, any>();
  for (const stage of input.stages || []) {
    const key = `${stage.wave_id}|${stage.bom_id}`;
    const start = dateOnly(stage.planned_start);
    const end = dateOnly(stage.planned_end);
    const current = planByConversion.get(key) || {
      planned_start: start,
      planned_end: end,
      planned_quantity: 0,
      planned_capacity_minutes: 0,
      stage_count: 0,
    };
    if (start && (!current.planned_start || start < current.planned_start))
      current.planned_start = start;
    if (end && (!current.planned_end || end > current.planned_end))
      current.planned_end = end;
    current.planned_quantity = Math.max(
      current.planned_quantity,
      n(stage.quantity),
    );
    current.planned_capacity_minutes += n(stage.required_capacity_minutes);
    current.stage_count++;
    planByConversion.set(key, current);
  }
  const jobs = new Map(
    (input.jobs || []).map((job: any) => [String(job.id), job]),
  );
  const materialsByJob = new Map<string, any[]>();
  for (const material of input.materials || []) {
    const id = String(material.job_order_id || "");
    materialsByJob.set(id, [...(materialsByJob.get(id) || []), material]);
  }
  const rows = (input.conversions || []).map((conversion: any) => {
    const job = jobs.get(String(conversion.job_order_id || ""));
    const plan = planByConversion.get(
      `${conversion.wave_id}|${conversion.bom_id}`,
    ) || {
      planned_start: null,
      planned_end: null,
      planned_quantity: 0,
      planned_capacity_minutes: 0,
      stage_count: 0,
    };
    const materialRows = job ? materialsByJob.get(String(job.id)) || [] : [];
    const materialRequired = materialRows.reduce(
      (sum, row) => sum + n(row.required_quantity),
      0,
    );
    const netIssued = materialRows.reduce(
      (sum, row) =>
        sum + Math.max(0, n(row.issued_quantity) - n(row.returned_quantity)),
      0,
    );
    const plannedQuantity =
      n(plan.planned_quantity) > 0
        ? n(plan.planned_quantity)
        : n(job?.quantity);
    const completed = n(job?.completed_quantity);
    const rejected = n(job?.rejected_quantity);
    const actualStart = dateOnly(job?.actual_start_date);
    const actualEnd = dateOnly(job?.actual_end_date);
    const plannedStart = dateOnly(plan.planned_start);
    const plannedEnd = dateOnly(plan.planned_end);
    const status = String(
      job?.status || conversion.status || "UNLINKED",
    ).toUpperCase();
    const finished =
      Boolean(actualEnd) || ["COMPLETED", "CLOSED"].includes(status);
    const started =
      Boolean(actualStart) ||
      !["DRAFT", "PLANNED", "PROPOSED", "UNLINKED"].includes(status);
    const comparisonDate = actualEnd || (!finished ? input.today : "");
    const finishVarianceDays = dayVariance(plannedEnd, comparisonDate);
    const late = Boolean(
      plannedEnd && comparisonDate && Number(finishVarianceDays) > 0,
    );
    const risks: string[] = [];
    if (!job) risks.push("JOB_LINK_MISSING");
    if (late) risks.push(finished ? "COMPLETED_LATE" : "SCHEDULE_OVERDUE");
    if (
      started &&
      materialRequired > 0 &&
      netIssued + 0.0001 < materialRequired
    )
      risks.push("MATERIAL_UNDER_ISSUED");
    if (rejected > 0) risks.push("REJECTION_REPORTED");
    if (finished && completed + 0.0001 < plannedQuantity)
      risks.push("COMPLETED_SHORT");
    return {
      conversion_id: conversion.id,
      wave_id: conversion.wave_id,
      bom_id: conversion.bom_id,
      item_id: conversion.item_id,
      job_order_id: job?.id || conversion.job_order_id || null,
      job_link_valid: Boolean(job),
      job_order_number:
        job?.job_order_number || conversion.job_order_number || "Not linked",
      status,
      planned_start: plannedStart || null,
      planned_end: plannedEnd || null,
      actual_start: actualStart || null,
      actual_end: actualEnd || null,
      planned_quantity: Number(plannedQuantity.toFixed(4)),
      completed_quantity: Number(completed.toFixed(4)),
      rejected_quantity: Number(rejected.toFixed(4)),
      progress_pct: Number(
        (plannedQuantity
          ? Math.min(100, (completed / plannedQuantity) * 100)
          : 0
        ).toFixed(2),
      ),
      planned_capacity_minutes: Number(
        n(plan.planned_capacity_minutes).toFixed(2),
      ),
      start_variance_days: dayVariance(plannedStart, actualStart),
      finish_variance_days: finishVarianceDays,
      material_required_quantity: Number(materialRequired.toFixed(4)),
      material_net_issued_quantity: Number(netIssued.toFixed(4)),
      material_issue_variance_quantity: Number(
        (netIssued - materialRequired).toFixed(4),
      ),
      material_issue_pct: Number(
        (materialRequired
          ? Math.min(100, (netIssued / materialRequired) * 100)
          : 100
        ).toFixed(2),
      ),
      stage_count: plan.stage_count,
      schedule_status: !job
        ? "UNLINKED"
        : late
          ? finished
            ? "COMPLETED_LATE"
            : "OVERDUE"
          : finished
            ? "COMPLETED_ON_TIME"
            : started
              ? "IN_PROGRESS_ON_TRACK"
              : "NOT_STARTED",
      risks,
    };
  });
  const linked = rows.filter((row: any) => row.job_link_valid);
  const completed = linked.filter((row: any) =>
    String(row.schedule_status).startsWith("COMPLETED_"),
  );
  return {
    summary: {
      planned_job_orders: rows.length,
      linked_job_orders: linked.length,
      completed_job_orders: completed.length,
      jobs_at_risk: rows.filter((row: any) => row.risks.length > 0).length,
      planned_quantity: Number(
        rows
          .reduce((sum: number, row: any) => sum + row.planned_quantity, 0)
          .toFixed(4),
      ),
      completed_quantity: Number(
        rows
          .reduce((sum: number, row: any) => sum + row.completed_quantity, 0)
          .toFixed(4),
      ),
      rejected_quantity: Number(
        rows
          .reduce((sum: number, row: any) => sum + row.rejected_quantity, 0)
          .toFixed(4),
      ),
      on_time_completion_pct: Number(
        (completed.length
          ? (completed.filter(
              (row: any) => row.schedule_status === "COMPLETED_ON_TIME",
            ).length /
              completed.length) *
            100
          : 0
        ).toFixed(2),
      ),
    },
    rows,
  };
}

export function buildProductionTransformationQueue(programs: any[]) {
  const n = (value: any) => {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const actions: any[] = [];
  for (const program of programs || []) {
    const base = {
      program_id: program.program_id,
      program_code: program.program_code,
      program_name: program.program_name,
      due_date: program.due_date,
      route: "/dashboard/production/smart-planning",
      evidence_source: "production_planning_runs",
      evidence_id: program.latest_run_id || program.program_id,
    };
    if (program.feasible === false || n(program.confidence_pct) < 80) {
      actions.push({
        ...base,
        id: `${program.program_id}:DELIVERY`,
        domain: "DELIVERY",
        priority_score: program.feasible === false ? 100 : 86,
        title: `${program.program_code}: customer promise at risk`,
        explanation: `Projected completion ${program.projected_completion_date || "is unavailable"}; confidence ${n(program.confidence_pct).toFixed(0)}%.`,
        next_action:
          "Review the constrained plan and agree a governed recovery or revised promise.",
      });
    }
    if (n(program.critical_materials) > 0) {
      actions.push({
        ...base,
        id: `${program.program_id}:MATERIAL`,
        domain: "MATERIAL",
        priority_score: Math.min(98, 84 + n(program.critical_materials)),
        title: `${program.program_code}: critical material shortages`,
        explanation: `${n(program.critical_materials).toFixed(0)} high/critical material line(s) threaten the program.`,
        next_action:
          "Open the pegged material plan and resolve the governed supply recommendations.",
      });
    }
    if (n(program.required_overtime_minutes) > 0) {
      actions.push({
        ...base,
        id: `${program.program_id}:CAPACITY`,
        domain: "CAPACITY",
        priority_score: Math.min(
          97,
          82 + Math.ceil(n(program.required_overtime_minutes) / 480),
        ),
        title: `${program.program_code}: capacity is not fully covered`,
        explanation: `${(n(program.required_overtime_minutes) / 60).toFixed(1)} additional capacity hour(s) are indicated.`,
        next_action:
          "Test overtime or alternate capacity, then approve any operating-calendar change.",
      });
    }
    if (n(program.execution?.jobs_at_risk) > 0) {
      actions.push({
        ...base,
        id: `${program.program_id}:EXECUTION`,
        domain: "EXECUTION",
        priority_score: Math.min(99, 88 + n(program.execution.jobs_at_risk)),
        title: `${program.program_code}: actual execution is diverging`,
        explanation: `${n(program.execution.jobs_at_risk).toFixed(0)} linked job order(s) have schedule, output, rejection or material-issue exceptions.`,
        next_action:
          "Refresh plan-versus-actual evidence and correct the source workflow before replanning.",
        evidence_source: "production_execution_conversions",
      });
    }
    if (n(program.excess_wip_cash_risk) > 0) {
      actions.push({
        ...base,
        id: `${program.program_id}:CASH`,
        domain: "CASH",
        priority_score: 74,
        title: `${program.program_code}: excess WIP cash exposure`,
        explanation: `${n(program.excess_wip_cash_risk).toFixed(2)} is exposed in excess or early WIP.`,
        next_action:
          "Review wave sizes and release timing before committing additional material.",
      });
    }
    if (!program.approved || !program.frozen) {
      actions.push({
        ...base,
        id: `${program.program_id}:GOVERNANCE`,
        domain: "GOVERNANCE",
        priority_score: 65,
        title: `${program.program_code}: plan release control is incomplete`,
        explanation: `${program.approved ? "Approved" : "Approval pending"}; ${program.frozen ? "freeze horizon set" : "freeze horizon missing"}.`,
        next_action:
          "Complete maker-checker approval and freeze only after evidence is current.",
      });
    }
  }
  return actions.sort(
    (a, b) =>
      b.priority_score - a.priority_score ||
      String(a.title).localeCompare(String(b.title)),
  );
}

@Injectable()
export class AdvancedProductionPlanningService {
  private readonly db: SupabaseClient = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!,
  );
  constructor(
    private readonly purchaseRequisitions: PurchaseRequisitionsService,
    private readonly jobOrders: JobOrderService,
  ) {}
  private n(v: any) {
    const x = Number(v || 0);
    return Number.isFinite(x) ? x : 0;
  }
  private t(v: any) {
    return String(v || "").trim();
  }
  private fail(e: any, m: string): never {
    throw new BadRequestException(e?.message || m);
  }
  private date(v: any) {
    const d = new Date(`${String(v).slice(0, 10)}T00:00:00Z`);
    if (!Number.isFinite(d.getTime()))
      this.fail(null, "A valid date is required.");
    return d;
  }
  private addDays(value: any, days: number) {
    const d = this.date(value);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
  private workdays(from: any, to: any) {
    let d = this.date(from),
      end = this.date(to),
      n = 0;
    while (d <= end) {
      const day = d.getUTCDay();
      if (day !== 0 && day !== 6) n++;
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return Math.max(0, n);
  }
  private async sourceState(tenantId: string, program: any) {
    const tables = [
      "items",
      "bom_headers",
      "production_routing",
      "production_stage_policies",
      "production_item_planning_policies",
      "production_routing_constraints",
      "production_resource_alternatives",
      "production_changeover_matrix",
      "production_employee_skills",
      "production_tool_resources",
      "production_cost_sheet_templates",
      "production_tool_events",
      "purchase_orders",
      "grns",
      "stock_entries",
      "inventory_stock",
      "manufacturing_shift_plans",
      "manufacturing_downtime_events",
      "plant_maintenance_work_orders",
      "hr_holidays",
      "quality_inspections",
      "quality_capa_cases",
      "attendance",
      "attendance_records",
      "leave_requests",
    ];
    const counts: any = {};
    for (const table of tables) {
      let countQuery = this.db
        .from(table)
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantId);
      if (table === "manufacturing_shift_plans")
        countQuery = countQuery.neq("shift_code", "APS-PUBLISHED");
      const r = await countQuery;
      let latest: any = null;
      for (const column of ["updated_at", "created_at"]) {
        let highQuery = this.db
          .from(table)
          .select(column)
          .eq("tenant_id", tenantId);
        if (table === "manufacturing_shift_plans")
          highQuery = highQuery.neq("shift_code", "APS-PUBLISHED");
        const high = await highQuery
          .order(column, { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!high.error) {
          latest = high.data?.[column] || null;
          break;
        }
      }
      counts[table] = r.error ? null : { count: r.count || 0, latest };
    }
    const headers = await this.db
      .from("bom_headers")
      .select("id")
      .eq("tenant_id", tenantId);
    if (!headers.error && headers.data?.length) {
      const ids = headers.data.map((x: any) => x.id),
        r = await this.db
          .from("bom_items")
          .select("*", { count: "exact", head: true })
          .in("bom_id", ids),
        high = await this.db
          .from("bom_items")
          .select("created_at")
          .in("bom_id", ids)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
      counts.bom_items = r.error
        ? null
        : { count: r.count || 0, latest: high.data?.created_at || null };
    }
    let salesDemand: any = null;
    if (
      program.demand_source === "SALES_ORDER" &&
      program.sales_order_id &&
      program.sales_order_item_id
    ) {
      const [{ data: order }, { data: line }] = await Promise.all([
        this.db
          .from("sales_orders")
          .select(
            "id,status,release_status,credit_status,delivery_block,expected_delivery_date,updated_at",
          )
          .eq("tenant_id", tenantId)
          .eq("id", program.sales_order_id)
          .maybeSingle(),
        this.db
          .from("sales_order_items")
          .select(
            "id,sales_order_id,item_id,quantity,dispatched_quantity,promised_date",
          )
          .eq("id", program.sales_order_item_id)
          .maybeSingle(),
      ]);
      salesDemand = { order, line };
    }
    const state = {
      program_target: program.target_quantity,
      program_start: program.start_date,
      program_due: program.due_date,
      finished_item_id: program.finished_item_id,
      demand_source: program.demand_source || "MANUAL",
      sales_order_id: program.sales_order_id || null,
      sales_order_item_id: program.sales_order_item_id || null,
      sales_demand: salesDemand,
      planning_policy: program.planning_policy,
      assumptions: program.assumptions || {},
      waves: (program.waves || []).map((x: any) => ({
        id: x.id,
        quantity: x.quantity,
        planned_start: x.planned_start,
        required_by: x.required_by,
        priority: x.priority,
        cancelled: String(x.status).toUpperCase() === "CANCELLED",
      })),
      counts,
    };
    return {
      state,
      hash: createHash("sha256").update(JSON.stringify(state)).digest("hex"),
    };
  }

  async masters(tenantId: string) {
    const [{ data: items, error: ie }, { data: stations, error: se }] =
      await Promise.all([
        this.db
          .from("items")
          .select("id,code,name,uom,category,lead_time_days,standard_cost")
          .eq("tenant_id", tenantId)
          .eq("is_active", true)
          .order("name"),
        this.db
          .from("work_stations")
          .select("id,station_code,station_name,capacity_per_hour,is_active")
          .eq("tenant_id", tenantId)
          .eq("is_active", true)
          .order("station_name"),
      ]);
    if (ie) this.fail(ie, "Unable to load planning items.");
    if (se) this.fail(se, "Unable to load work stations.");
    return { items: items || [], stations: stations || [] };
  }

  async salesOrderDemands(tenantId: string) {
    const { data: orders, error } = await this.db
      .from("sales_orders")
      .select(
        "id,so_number,status,release_status,credit_status,delivery_block,expected_delivery_date,currency_code,customer:customers(id,customer_code,customer_name),lines:sales_order_items(id,sales_order_id,item_id,item_description,quantity,dispatched_quantity,ordered_uom,promised_date)",
      )
      .eq("tenant_id", tenantId)
      .order("order_date", { ascending: false });
    if (error) this.fail(error, "Unable to load sales-order demand.");
    const itemIds = [
      ...new Set(
        (orders || [])
          .flatMap((order: any) =>
            (order.lines || []).map((line: any) => line.item_id),
          )
          .filter(Boolean),
      ),
    ];
    const programResult = await this.db
      .from("production_programs")
      .select("id,sales_order_item_id,target_quantity,status")
      .eq("tenant_id", tenantId)
      .eq("demand_source", "SALES_ORDER");
    if (programResult.error)
      this.fail(
        programResult.error,
        "Unable to read existing sales-order production links.",
      );
    const activeProgramByLine = new Map<string, any>();
    for (const program of programResult.data || [])
      if (
        program.sales_order_item_id &&
        !["CANCELLED", "CLOSED"].includes(this.t(program.status).toUpperCase())
      )
        activeProgramByLine.set(String(program.sales_order_item_id), program);
    const [{ data: items, error: itemError }, { data: boms, error: bomError }] =
      await Promise.all([
        itemIds.length
          ? this.db
              .from("items")
              .select("id,code,name,uom,is_active")
              .eq("tenant_id", tenantId)
              .in("id", itemIds)
          : Promise.resolve({ data: [], error: null } as any),
        itemIds.length
          ? this.db
              .from("bom_headers")
              .select("id,item_id")
              .eq("tenant_id", tenantId)
              .eq("is_active", true)
              .eq("lifecycle_status", "APPROVED")
              .in("item_id", itemIds)
          : Promise.resolve({ data: [], error: null } as any),
      ]);
    if (itemError || bomError)
      this.fail(
        itemError || bomError,
        "Unable to validate sales-order production items.",
      );
    const itemMap = new Map(
        (items || []).map((item: any) => [String(item.id), item]),
      ),
      bomItems = new Set((boms || []).map((bom: any) => String(bom.item_id)));
    const today = new Date().toISOString().slice(0, 10);
    return (orders || [])
      .map((order: any) => {
        const orderStatus = this.t(order.status).toUpperCase(),
          releaseStatus = this.t(
            order.release_status || "RELEASED",
          ).toUpperCase(),
          creditStatus = this.t(order.credit_status || "CLEAR").toUpperCase();
        const orderBlockReason = ["CANCELLED", "CLOSED", "COMPLETED"].includes(
          orderStatus,
        )
          ? "Sales order is closed or cancelled."
          : releaseStatus !== "RELEASED"
            ? "Sales order requires commercial release."
            : creditStatus === "BLOCKED"
              ? "Sales order is credit blocked."
              : order.delivery_block
                ? "Sales order has a delivery block."
                : "";
        const lines = (order.lines || []).map((line: any) => {
          const item: any = itemMap.get(String(line.item_id)),
            open = salesOrderOpenQuantity(line),
            due = salesOrderDemandDate(order, line),
            linked = activeProgramByLine.get(String(line.id));
          const reason =
            orderBlockReason ||
            (!item || item.is_active === false
              ? "Sales-order item is inactive or missing."
              : open <= 0
                ? "Nothing remains to manufacture for this line."
                : !due
                  ? "Add a promised delivery date to the sales-order line or header."
                  : due < today
                    ? "Sales-order promised date is overdue."
                    : !bomItems.has(String(line.item_id))
                      ? "An active BOM is required for this product."
                      : linked
                        ? "This sales-order line already has an active production program."
                        : "");
          return {
            ...line,
            item: item || null,
            open_quantity: open,
            due_date: due,
            eligible: !reason,
            blocked_reason: reason || null,
            linked_program: linked || null,
          };
        });
        return {
          ...order,
          customer_name: order.customer?.customer_name || null,
          eligible: lines.some((line: any) => line.eligible),
          lines,
        };
      })
      .filter((order: any) =>
        order.lines.some((line: any) => line.open_quantity > 0),
      );
  }

  private async resolveSalesOrderDemand(
    tenantId: string,
    salesOrderId: string,
    salesOrderItemId: string,
  ) {
    const [
      { data: order, error: orderError },
      { data: line, error: lineError },
      { data: existing, error: existingError },
    ] = await Promise.all([
      this.db
        .from("sales_orders")
        .select(
          "id,so_number,status,release_status,credit_status,delivery_block,expected_delivery_date,currency_code",
        )
        .eq("tenant_id", tenantId)
        .eq("id", salesOrderId)
        .maybeSingle(),
      this.db
        .from("sales_order_items")
        .select(
          "id,sales_order_id,item_id,item_description,quantity,dispatched_quantity,promised_date",
        )
        .eq("id", salesOrderItemId)
        .maybeSingle(),
      this.db
        .from("production_programs")
        .select("id,program_code,status")
        .eq("tenant_id", tenantId)
        .eq("sales_order_item_id", salesOrderItemId)
        .not("status", "in", "(CANCELLED,CLOSED)")
        .maybeSingle(),
    ]);
    if (orderError || lineError || existingError)
      this.fail(
        orderError || lineError || existingError,
        "Unable to validate sales-order demand.",
      );
    if (!order || !line || String(line.sales_order_id) !== String(order.id))
      this.fail(null, "Select a valid sales-order product line.");
    if (existing)
      this.fail(
        null,
        `Sales-order line is already linked to production program ${existing.program_code}.`,
      );
    const status = this.t(order.status).toUpperCase(),
      release = this.t(order.release_status || "RELEASED").toUpperCase(),
      credit = this.t(order.credit_status || "CLEAR").toUpperCase();
    if (["CANCELLED", "CLOSED", "COMPLETED"].includes(status))
      this.fail(
        null,
        "Closed or cancelled sales orders cannot create production demand.",
      );
    if (release !== "RELEASED")
      this.fail(
        null,
        "Release the sales order before creating its production plan.",
      );
    if (credit === "BLOCKED" || order.delivery_block)
      this.fail(
        null,
        "Remove the sales-order credit/delivery block before creating its production plan.",
      );
    const quantity = salesOrderOpenQuantity(line),
      dueDate = salesOrderDemandDate(order, line);
    if (quantity <= 0)
      this.fail(
        null,
        "This sales-order line has no remaining quantity to manufacture.",
      );
    if (!dueDate)
      this.fail(
        null,
        "Add a promised delivery date to the sales-order line or order before planning production.",
      );
    if (dueDate < new Date().toISOString().slice(0, 10))
      this.fail(
        null,
        "The sales-order promised date is overdue. Update the customer commitment before planning production.",
      );
    const { data: item, error: itemError } = await this.db
      .from("items")
      .select("id,code,name,uom,is_active")
      .eq("tenant_id", tenantId)
      .eq("id", line.item_id)
      .maybeSingle();
    if (itemError || !item || item.is_active === false)
      this.fail(itemError, "The sales-order product is not an active item.");
    const { data: bom, error: bomError } = await this.db
      .from("bom_headers")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("item_id", line.item_id)
      .eq("is_active", true)
      .eq("lifecycle_status", "APPROVED")
      .lte("effective_from", salesOrderDemandDate(order, line))
      .or(
        `effective_to.is.null,effective_to.gte.${salesOrderDemandDate(order, line)}`,
      )
      .limit(1)
      .maybeSingle();
    if (bomError || !bom)
      this.fail(
        bomError,
        "An active BOM is required for the sales-order product.",
      );
    return { order, line, item, quantity, dueDate };
  }

  async dashboard(tenantId: string) {
    const { data: programs, error } = await this.db
      .from("production_programs")
      .select("*,waves:production_build_waves(*)")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
    if (error) this.fail(error, "Unable to load production programs.");
    const finishedIds = [
      ...new Set(
        (programs || []).map((x: any) => x.finished_item_id).filter(Boolean),
      ),
    ];
    const itemResult = finishedIds.length
      ? await this.db
          .from("items")
          .select("id,code,name,uom")
          .eq("tenant_id", tenantId)
          .in("id", finishedIds)
      : ({ data: [], error: null } as any);
    if (itemResult.error)
      this.fail(itemResult.error, "Unable to load finished items.");
    const finishedMap = new Map(
      (itemResult.data || []).map((x: any) => [String(x.id), x]),
    );
    const salesOrderIds = [
      ...new Set(
        (programs || []).map((x: any) => x.sales_order_id).filter(Boolean),
      ),
    ];
    const salesResult = salesOrderIds.length
      ? await this.db
          .from("sales_orders")
          .select(
            "id,so_number,expected_delivery_date,customer:customers(customer_code,customer_name)",
          )
          .eq("tenant_id", tenantId)
          .in("id", salesOrderIds)
      : ({ data: [], error: null } as any);
    if (salesResult.error)
      this.fail(salesResult.error, "Unable to load linked sales orders.");
    const salesMap = new Map(
      (salesResult.data || []).map((x: any) => [String(x.id), x]),
    );
    const ids = (programs || []).map((x: any) => x.id);
    let runs: any[] = [];
    if (ids.length) {
      const r = await this.db
        .from("production_planning_runs")
        .select("*")
        .eq("tenant_id", tenantId)
        .in("program_id", ids)
        .order("created_at", { ascending: false });
      if (r.error) this.fail(r.error, "Unable to load planning runs.");
      runs = r.data || [];
    }
    const latest = new Map<string, any>();
    for (const run of runs)
      if (!latest.has(run.program_id)) latest.set(run.program_id, run);
    return {
      programs: (programs || []).map((p: any) => ({
        ...p,
        finished_item: finishedMap.get(String(p.finished_item_id)) || null,
        sales_order: salesMap.get(String(p.sales_order_id)) || null,
        waves: (p.waves || []).sort(
          (a: any, b: any) => a.wave_number - b.wave_number,
        ),
        latest_run: latest.get(p.id) || null,
      })),
    };
  }

  async createProgram(tenantId: string, userId: string, b: any) {
    const demandSource = this.t(b.demand_source || "MANUAL").toUpperCase();
    if (!["MANUAL", "SALES_ORDER"].includes(demandSource))
      this.fail(null, "Demand source must be Manual or Sales Order.");
    const salesDemand =
      demandSource === "SALES_ORDER"
        ? await this.resolveSalesOrderDemand(
            tenantId,
            this.t(b.sales_order_id),
            this.t(b.sales_order_item_id),
          )
        : null;
    const finishedItemId = salesDemand?.line.item_id || b.finished_item_id,
      qty = salesDemand?.quantity || this.n(b.target_quantity),
      start = this.t(b.start_date).slice(0, 10),
      due = salesDemand?.dueDate || this.t(b.due_date).slice(0, 10),
      waves = Array.isArray(b.waves) ? b.waves : [];
    const generatedName = salesDemand
      ? `${salesDemand.order.so_number} - ${salesDemand.item.code || salesDemand.item.name}`
      : "";
    const programName = this.t(b.program_name || generatedName),
      currency = this.t(
        salesDemand?.order.currency_code || b.currency_code || "AED",
      ).toUpperCase();
    if (
      !finishedItemId ||
      !programName ||
      qty <= 0 ||
      !start ||
      !due ||
      due < start
    )
      this.fail(
        null,
        "Finished item, positive target quantity and valid start/due dates are required.",
      );
    if (!waves.length) this.fail(null, "Add at least one build wave.");
    const waveTotal = waves.reduce(
      (s: number, x: any) => s + this.n(x.quantity),
      0,
    );
    if (Math.abs(waveTotal - qty) > 0.0001)
      this.fail(
        null,
        `Build-wave quantity ${waveTotal} must equal target quantity ${qty}.`,
      );
    if (
      waves.some(
        (x: any) =>
          this.n(x.quantity) <= 0 ||
          !this.t(x.required_by) ||
          String(x.required_by).slice(0, 10) > due,
      )
    )
      this.fail(
        null,
        "Every wave needs a positive quantity and a required date no later than the program due date.",
      );
    const salesCode = salesDemand
      ? `PLAN-${this.t(salesDemand.order.so_number).replace(/[^A-Za-z0-9]+/g, "-")}-${String(salesDemand.line.id).slice(0, 8)}`
      : "";
    const code = this.t(
      b.program_code || salesCode || `PLAN-${Date.now()}`,
    ).toUpperCase();
    const { data: p, error } = await this.db
      .from("production_programs")
      .insert({
        tenant_id: tenantId,
        program_code: code,
        program_name: programName,
        finished_item_id: finishedItemId,
        target_quantity: qty,
        start_date: start,
        due_date: due,
        currency_code: currency,
        cash_budget:
          b.cash_budget === "" || b.cash_budget == null
            ? null
            : this.n(b.cash_budget),
        planning_policy: b.planning_policy || "BOTTLENECK_PULL",
        demand_source: demandSource,
        sales_order_id: salesDemand?.order.id || null,
        sales_order_item_id: salesDemand?.line.id || null,
        assumptions: {
          default_efficiency_pct: this.n(b.default_efficiency_pct || 85),
          default_daily_minutes: this.n(b.default_daily_minutes || 480),
          safety_pct: this.n(b.safety_pct || 0),
          overtime_cost_per_hour: this.n(b.overtime_cost_per_hour || 45),
          second_shift_cost_per_hour: this.n(
            b.second_shift_cost_per_hour || 60,
          ),
          subcontract_cost_per_hour: this.n(b.subcontract_cost_per_hour || 90),
          late_delivery_cost_per_day: this.n(
            b.late_delivery_cost_per_day || 500,
          ),
        },
        created_by: userId,
      })
      .select()
      .single();
    if (error || !p) this.fail(error, "Unable to create production program.");
    const rows = waves.map((x: any, i: number) => ({
      tenant_id: tenantId,
      program_id: p.id,
      wave_number: i + 1,
      wave_name: this.t(x.wave_name || `Wave ${i + 1}`),
      quantity: this.n(x.quantity),
      planned_start: this.t(x.planned_start).slice(0, 10) || null,
      required_by: this.t(x.required_by).slice(0, 10),
      priority: Math.min(
        100,
        Math.max(1, Math.round(this.n(x.priority || 50))),
      ),
      transfer_batch_quantity: x.transfer_batch_quantity
        ? this.n(x.transfer_batch_quantity)
        : null,
      status: x.status || "PLANNED",
    }));
    const inserted = await this.db
      .from("production_build_waves")
      .insert(rows)
      .select();
    if (inserted.error)
      this.fail(inserted.error, "Unable to create build waves.");
    return { ...p, waves: inserted.data || [] };
  }

  async updateStagePolicy(tenantId: string, b: any) {
    if (!b.routing_id) this.fail(null, "Routing operation is required.");
    const row = {
      tenant_id: tenantId,
      routing_id: b.routing_id,
      stage_group_code: this.t(b.stage_group_code) || null,
      execution_mode: b.execution_mode || "SEQUENTIAL",
      predecessor_routing_ids: Array.isArray(b.predecessor_routing_ids)
        ? b.predecessor_routing_ids
        : [],
      transfer_batch_quantity: b.transfer_batch_quantity
        ? this.n(b.transfer_batch_quantity)
        : null,
      buffer_limit_quantity: b.buffer_limit_quantity
        ? this.n(b.buffer_limit_quantity)
        : null,
      queue_minutes: Math.max(0, Math.round(this.n(b.queue_minutes))),
      move_minutes: Math.max(0, Math.round(this.n(b.move_minutes))),
      wait_minutes: Math.max(0, Math.round(this.n(b.wait_minutes))),
      overlap_percent: Math.min(100, Math.max(0, this.n(b.overlap_percent))),
      efficiency_percent: Math.min(
        150,
        Math.max(1, this.n(b.efficiency_percent || 85)),
      ),
      is_bottleneck: Boolean(b.is_bottleneck),
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await this.db
      .from("production_stage_policies")
      .upsert(row, { onConflict: "tenant_id,routing_id" })
      .select()
      .single();
    if (error) this.fail(error, "Unable to save stage policy.");
    return data;
  }

  async planningConfiguration(tenantId: string) {
    const tables = [
      "production_item_planning_policies",
      "production_routing_constraints",
      "production_resource_alternatives",
      "production_changeover_matrix",
      "production_employee_skills",
      "production_tool_resources",
      "production_cost_sheet_templates",
    ];
    const out: any = {};
    for (const table of tables) {
      const r = await this.db.from(table).select("*").eq("tenant_id", tenantId);
      if (r.error) this.fail(r.error, `Unable to load ${table}.`);
      out[table] = r.data || [];
    }
    const [
      { data: items, error: ie },
      { data: stations, error: se },
      { data: routings, error: re },
      { data: boms, error: be },
      { data: employees, error: ee },
    ] = await Promise.all([
      this.db
        .from("items")
        .select("id,code,name,uom,category")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .order("code"),
      this.db
        .from("work_stations")
        .select("id,station_code,station_name,capacity_per_hour")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .order("station_code"),
      this.db
        .from("production_routing")
        .select(
          "id,bom_id,sequence_no,operation_name,work_station_id,cycle_time_minutes,setup_time_minutes",
        )
        .eq("tenant_id", tenantId)
        .order("sequence_no"),
      this.db
        .from("bom_headers")
        .select("id,item_id,version")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .eq("lifecycle_status", "APPROVED")
        .lte("effective_from", new Date().toISOString().slice(0, 10))
        .or(
          `effective_to.is.null,effective_to.gte.${new Date().toISOString().slice(0, 10)}`,
        ),
      this.db.from("employees").select("*").eq("tenant_id", tenantId),
    ]);
    if (ie || se || re || be || ee)
      this.fail(
        ie || se || re || be || ee,
        "Unable to load production-planning masters.",
      );
    const itemMap = new Map((items || []).map((x: any) => [String(x.id), x])),
      bomMap = new Map((boms || []).map((x: any) => [String(x.id), x]));
    out.items = items || [];
    out.stations = stations || [];
    out.employees = employees || [];
    out.routings = (routings || []).map((x: any) => {
      const bom = bomMap.get(String(x.bom_id));
      return {
        ...x,
        item: bom ? itemMap.get(String(bom.item_id)) || null : null,
        bom_version: bom?.version || null,
      };
    });
    return out;
  }
  async saveCostSheetTemplate(tenantId: string, userId: string, b: any) {
    const allowedBases = new Set([
      "PER_UNIT", "KG_INPUT", "KG_OUTPUT", "MACHINE_HOUR", "LABOUR_HOUR",
      "BATCH", "SHOT", "FIXED_RUN", "PERCENT_MATERIAL",
      "SUBCONTRACT_QUANTITY", "PACKING_UNIT",
    ]);
    const finishedItemId = this.t(b.finished_item_id),
      templateName = this.t(b.template_name),
      currency = this.t(b.currency_code || "INR").toUpperCase(),
      outputQuantity = this.n(b.output_quantity);
    if (!finishedItemId) this.fail(null, "Finished item is required.");
    if (!templateName) this.fail(null, "Cost sheet name is required.");
    if (!/^[A-Z]{3}$/.test(currency)) this.fail(null, "Currency must be a three-letter code.");
    if (!(outputQuantity > 0)) this.fail(null, "Output quantity must be greater than zero.");
    const rawLines = Array.isArray(b.cost_lines) ? b.cost_lines : [];
    if (!rawLines.length) this.fail(null, "Add at least one production cost element.");
    if (rawLines.length > 100) this.fail(null, "A cost sheet cannot contain more than 100 elements.");
    const lines = rawLines.map((line: any, index: number) => {
      const basis = this.t(line.basis).toUpperCase(),
        name = this.t(line.name),
        category = this.t(line.category || "OTHER").toUpperCase(),
        rate = Number(line.rate),
        driverQuantity = Number(line.driver_quantity ?? 0),
        wastagePercent = Number(line.wastage_percent ?? 0);
      if (!name) this.fail(null, `Cost element ${index + 1} needs a name.`);
      if (!allowedBases.has(basis)) this.fail(null, `Cost element ${index + 1} has an invalid basis.`);
      if (!Number.isFinite(rate)) this.fail(null, `Cost element ${index + 1} needs a valid rate.`);
      if (!Number.isFinite(driverQuantity) || driverQuantity < 0) this.fail(null, `Cost element ${index + 1} has an invalid driver quantity.`);
      if (!Number.isFinite(wastagePercent) || wastagePercent < 0 || wastagePercent > 100) this.fail(null, `Cost element ${index + 1} has invalid wastage.`);
      return { id: this.t(line.id) || `line-${index + 1}`, name, category, basis, rate, driver_quantity: driverQuantity, wastage_percent: wastagePercent, enabled: line.enabled !== false, notes: this.t(line.notes) || null };
    });
    const directLines = lines.map((line: any) => {
      const multiplier = line.basis === "FIXED_RUN" ? 1 : ["PER_UNIT", "PACKING_UNIT"].includes(line.basis) ? outputQuantity : line.driver_quantity;
      return { ...line, calculated_amount: !line.enabled || line.basis === "PERCENT_MATERIAL" ? 0 : line.rate * multiplier * (1 + line.wastage_percent / 100) };
    });
    const materialBase = directLines.filter((line: any) => line.enabled && line.category === "MATERIAL").reduce((sum: number, line: any) => sum + line.calculated_amount, 0);
    const calculatedLines = directLines.map((line: any) => ({ ...line, calculated_amount: line.enabled && line.basis === "PERCENT_MATERIAL" ? materialBase * (line.rate / 100) : line.calculated_amount }));
    const total = calculatedLines.reduce((sum: number, line: any) => sum + Number(line.calculated_amount || 0), 0);
    if (!Number.isFinite(total) || total < 0) this.fail(null, "Calculated production cost cannot be negative.");
    const row = { tenant_id: tenantId, finished_item_id: finishedItemId, template_name: templateName, currency_code: currency, output_quantity: outputQuantity, cost_lines: calculatedLines, assumptions: b.assumptions && typeof b.assumptions === "object" ? b.assumptions : {}, calculated_total_cost: Number(total.toFixed(4)), calculated_unit_cost: Number((total / outputQuantity).toFixed(6)), is_active: b.is_active !== false, updated_by: userId, updated_at: new Date().toISOString() };
    const existing = b.id ? await this.db.from("production_cost_sheet_templates").select("id").eq("tenant_id", tenantId).eq("id", b.id).maybeSingle() : { data: null, error: null } as any;
    if (existing.error) this.fail(existing.error, "Unable to verify the cost sheet.");
    const result = existing.data
      ? await this.db.from("production_cost_sheet_templates").update(row).eq("tenant_id", tenantId).eq("id", b.id).select().single()
      : await this.db.from("production_cost_sheet_templates").insert({ ...row, created_by: userId }).select().single();
    if (result.error) this.fail(result.error, "Unable to save the production cost sheet.");
    return result.data;
  }
  async deleteCostSheetTemplate(tenantId: string, id: string) {
    const result = await this.db.from("production_cost_sheet_templates").update({ is_active: false, updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", id).select("id,is_active").single();
    if (result.error) this.fail(result.error, "Unable to deactivate the production cost sheet.");
    return result.data;
  }
  async saveItemPlanningPolicy(
    tenantId: string,
    userId: string,
    itemId: string,
    b: any,
  ) {
    const row = {
      tenant_id: tenantId,
      item_id: itemId,
      procurement_type: this.t(b.procurement_type || "AUTO").toUpperCase(),
      minimum_order_quantity: Math.max(0, this.n(b.minimum_order_quantity)),
      order_multiple: Math.max(0, this.n(b.order_multiple)),
      pack_size: Math.max(0, this.n(b.pack_size)),
      minimum_stock: Math.max(0, this.n(b.minimum_stock)),
      maximum_stock:
        b.maximum_stock == null || b.maximum_stock === ""
          ? null
          : Math.max(0, this.n(b.maximum_stock)),
      shelf_life_days: b.shelf_life_days
        ? Math.max(1, Math.round(this.n(b.shelf_life_days)))
        : null,
      minimum_remaining_shelf_life_days: Math.max(
        0,
        Math.round(this.n(b.minimum_remaining_shelf_life_days)),
      ),
      batch_constraint: this.t(b.batch_constraint || "NONE").toUpperCase(),
      alternate_item_ids: Array.isArray(b.alternate_item_ids)
        ? b.alternate_item_ids
        : [],
      substitution_approval_required:
        b.substitution_approval_required !== false,
      safety_stock_method: this.t(
        b.safety_stock_method || "PERCENT",
      ).toUpperCase(),
      safety_stock_value: Math.max(0, this.n(b.safety_stock_value)),
      updated_by: userId,
      updated_at: new Date().toISOString(),
    };
    const x = await this.db
      .from("production_item_planning_policies")
      .upsert(row, { onConflict: "tenant_id,item_id" })
      .select()
      .single();
    if (x.error) this.fail(x.error, "Unable to save item planning policy.");
    return x.data;
  }
  async saveRoutingConstraint(tenantId: string, routingId: string, b: any) {
    const row = {
      tenant_id: tenantId,
      routing_id: routingId,
      required_skill_codes: Array.isArray(b.required_skill_codes)
        ? b.required_skill_codes
            .map((x: any) => this.t(x).toUpperCase())
            .filter(Boolean)
        : [],
      required_tool_codes: Array.isArray(b.required_tool_codes)
        ? b.required_tool_codes
            .map((x: any) => this.t(x).toUpperCase())
            .filter(Boolean)
        : [],
      minimum_qualified_people: Math.max(
        0,
        Math.round(this.n(b.minimum_qualified_people)),
      ),
      campaign_code: this.t(b.campaign_code) || null,
      campaign_min_quantity: b.campaign_min_quantity
        ? this.n(b.campaign_min_quantity)
        : null,
      campaign_max_quantity: b.campaign_max_quantity
        ? this.n(b.campaign_max_quantity)
        : null,
      setup_family: this.t(b.setup_family) || null,
      preferred_resource_id: b.preferred_resource_id || null,
      updated_at: new Date().toISOString(),
    };
    const x = await this.db
      .from("production_routing_constraints")
      .upsert(row, { onConflict: "tenant_id,routing_id" })
      .select()
      .single();
    if (x.error) this.fail(x.error, "Unable to save routing constraint.");
    return x.data;
  }
  async saveResourceAlternative(tenantId: string, b: any) {
    if (!b.routing_id || !b.work_station_id)
      this.fail(null, "Routing and alternate work station are required.");
    const row = {
      tenant_id: tenantId,
      routing_id: b.routing_id,
      work_station_id: b.work_station_id,
      priority: Math.max(1, Math.round(this.n(b.priority || 100))),
      efficiency_percent: Math.max(1, this.n(b.efficiency_percent || 100)),
      additional_setup_minutes: Math.max(0, this.n(b.additional_setup_minutes)),
      cost_per_hour: Math.max(0, this.n(b.cost_per_hour)),
      is_active: b.is_active !== false,
    };
    const x = await this.db
      .from("production_resource_alternatives")
      .upsert(row, { onConflict: "tenant_id,routing_id,work_station_id" })
      .select()
      .single();
    if (x.error)
      this.fail(x.error, "Unable to save alternate production resource.");
    return x.data;
  }
  async saveChangeover(tenantId: string, b: any) {
    if (
      !b.work_station_id ||
      !this.t(b.from_setup_family) ||
      !this.t(b.to_setup_family)
    )
      this.fail(null, "Station, from-family and to-family are required.");
    const row = {
      tenant_id: tenantId,
      work_station_id: b.work_station_id,
      from_setup_family: this.t(b.from_setup_family),
      to_setup_family: this.t(b.to_setup_family),
      changeover_minutes: Math.max(0, this.n(b.changeover_minutes)),
      changeover_cost: Math.max(0, this.n(b.changeover_cost)),
    };
    const x = await this.db
      .from("production_changeover_matrix")
      .upsert(row, {
        onConflict:
          "tenant_id,work_station_id,from_setup_family,to_setup_family",
      })
      .select()
      .single();
    if (x.error) this.fail(x.error, "Unable to save changeover matrix entry.");
    return x.data;
  }
  async saveToolResource(tenantId: string, userId: string, b: any) {
    const code = this.t(b.tool_code).toUpperCase(),
      name = this.t(b.tool_name);
    if (!code || !name) this.fail(null, "Tool code and name are required.");
    const resourceType = this.t(b.resource_type || "TOOL").toUpperCase();
    if (!["TOOL", "DIE", "JIG", "FIXTURE", "GAUGE"].includes(resourceType))
      this.fail(null, "Select a valid tool resource type.");
    const lifeLimit = b.life_limit_cycles ? this.n(b.life_limit_cycles) : null;
    if (lifeLimit != null && lifeLimit <= 0)
      this.fail(null, "Tool life limit must be greater than zero.");
    const calibrationRequired = Boolean(b.calibration_required);
    const nextDue = b.next_calibration_due || null;
    const today = new Date().toISOString().slice(0, 10);
    const calibrationStatus = calibrationRequired
      ? nextDue && nextDue >= today
        ? "VALID"
        : "DUE"
      : "NOT_REQUIRED";
    const status =
      calibrationStatus === "DUE"
        ? "BLOCKED"
        : this.t(b.status || "AVAILABLE").toUpperCase();
    const row = {
      tenant_id: tenantId,
      tool_code: code,
      tool_name: name,
      work_station_id: b.work_station_id || null,
      available_quantity: Math.max(
        0,
        Math.round(this.n(b.available_quantity || 1)),
      ),
      status,
      valid_until: b.valid_until || null,
      serial_number: this.t(b.serial_number) || null,
      resource_type: resourceType,
      life_limit_cycles: lifeLimit,
      cycles_used: Math.max(0, this.n(b.cycles_used)),
      calibration_required: calibrationRequired,
      last_calibration_date: b.last_calibration_date || null,
      next_calibration_due: nextDue,
      calibration_status: calibrationStatus,
      block_reason: calibrationStatus === "DUE" ? "Calibration is due" : null,
      created_by: userId,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    };
    const x = await this.db
      .from("production_tool_resources")
      .upsert(row, { onConflict: "tenant_id,tool_code,work_station_id" })
      .select()
      .single();
    if (x.error) this.fail(x.error, "Unable to save tool resource.");
    return x.data;
  }
  async recordToolUsage(tenantId: string, userId: string, id: string, b: any) {
    const { data, error } = await this.db.rpc("record_production_tool_usage", {
      p_tenant_id: tenantId,
      p_tool_resource_id: id,
      p_cycle_quantity: this.n(b.cycle_quantity),
      p_performed_by: userId,
      p_evidence_reference: this.t(b.evidence_reference),
    });
    if (error) this.fail(error, "Unable to record tool usage.");
    return data;
  }
  async recordToolCalibration(
    tenantId: string,
    userId: string,
    id: string,
    b: any,
  ) {
    const result = this.t(b.result).toUpperCase(),
      eventDate = this.t(b.event_date) || new Date().toISOString().slice(0, 10),
      nextDue = this.t(b.next_due_date) || null,
      evidence = this.t(b.evidence_reference);
    const tool = await this.db
      .from("production_tool_resources")
      .select("id,calibration_required")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    if (tool.error || !tool.data)
      this.fail(tool.error, "Tool resource not found.");
    if (
      !tool.data.calibration_required ||
      !["PASS", "FAIL"].includes(result) ||
      !evidence
    )
      this.fail(
        null,
        "A calibration-controlled tool, PASS/FAIL result and evidence are required.",
      );
    if (result === "PASS" && (!nextDue || nextDue <= eventDate))
      this.fail(null, "A passing calibration requires a future next-due date.");
    const { data, error } = await this.db
      .from("production_tool_events")
      .insert({
        tenant_id: tenantId,
        tool_resource_id: id,
        event_type: "CALIBRATION",
        event_date: eventDate,
        result,
        next_due_date: result === "PASS" ? nextDue : null,
        evidence_reference: evidence,
        performed_by: userId,
      })
      .select()
      .single();
    if (error) this.fail(error, "Unable to record calibration evidence.");
    return data;
  }
  async verifyToolCalibration(
    tenantId: string,
    userId: string,
    eventId: string,
    b: any,
  ) {
    const { data, error } = await this.db.rpc(
      "verify_production_tool_calibration",
      {
        p_tenant_id: tenantId,
        p_event_id: eventId,
        p_verified_by: userId,
        p_verification_note: this.t(b.verification_note),
      },
    );
    if (error) this.fail(error, "Unable to verify calibration.");
    return data;
  }
  async saveEmployeeSkill(tenantId: string, b: any) {
    const employee = this.t(b.employee_id),
      code = this.t(b.skill_code).toUpperCase();
    if (!employee || !code)
      this.fail(null, "Employee and skill code are required.");
    const row = {
      tenant_id: tenantId,
      employee_id: employee,
      skill_code: code,
      proficiency_level: Math.min(
        5,
        Math.max(1, Math.round(this.n(b.proficiency_level || 1))),
      ),
      valid_from: b.valid_from || null,
      valid_until: b.valid_until || null,
      active: b.active !== false,
    };
    const x = await this.db
      .from("production_employee_skills")
      .upsert(row, { onConflict: "tenant_id,employee_id,skill_code" })
      .select()
      .single();
    if (x.error) this.fail(x.error, "Unable to save employee skill.");
    return x.data;
  }

  private async explode(
    tenantId: string,
    finishedItemId: string,
    quantity: number,
    asOfDate: string,
  ) {
    const output: Explosion[] = [],
      seen = new Set<string>();
    const walk = async (
      itemId: string,
      parentItemId: string,
      qty: number,
      level: number,
    ) => {
      if (level > 20)
        this.fail(null, "BOM depth exceeds the planning safety limit.");
      const { data: bom, error } = await this.db
        .from("bom_headers")
        .select("id,item_id,version")
        .eq("tenant_id", tenantId)
        .eq("item_id", itemId)
        .eq("is_active", true)
        .eq("lifecycle_status", "APPROVED")
        .lte("effective_from", asOfDate)
        .or(`effective_to.is.null,effective_to.gte.${asOfDate}`)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) this.fail(error, "Unable to read BOM.");
      if (!bom) return;
      const key = String(bom.id);
      if (seen.has(key)) this.fail(null, "A circular BOM was detected.");
      seen.add(key);
      const { data: lines, error: le } = await this.db
        .from("bom_items")
        .select("item_id,child_bom_id,component_type,quantity,scrap_percentage")
        .eq("bom_id", bom.id);
      if (le) this.fail(le, "Unable to read BOM components.");
      for (const line of lines || []) {
        let childId = line.item_id,
          childBomId = line.child_bom_id;
        if (childBomId) {
          const h = await this.db
            .from("bom_headers")
            .select("id,item_id")
            .eq("tenant_id", tenantId)
            .eq("id", childBomId)
            .eq("is_active", true)
            .eq("lifecycle_status", "APPROVED")
            .lte("effective_from", asOfDate)
            .or(`effective_to.is.null,effective_to.gte.${asOfDate}`)
            .maybeSingle();
          if (h.error) this.fail(h.error, "Unable to read child BOM.");
          if (!h.data)
            this.fail(
              null,
              "A referenced child BOM is not approved and effective for the planning date.",
            );
          childId = h.data?.item_id || childId;
        }
        if (!childId) continue;
        const base = qty * this.n(line.quantity),
          scrap = this.n(line.scrap_percentage),
          required = base * (1 + scrap / 100),
          buildable =
            Boolean(childBomId) ||
            String(line.component_type).toUpperCase() === "BOM";
        if (buildable && !childBomId) {
          const child = await this.db
            .from("bom_headers")
            .select("id")
            .eq("tenant_id", tenantId)
            .eq("item_id", childId)
            .eq("is_active", true)
            .eq("lifecycle_status", "APPROVED")
            .lte("effective_from", asOfDate)
            .or(`effective_to.is.null,effective_to.gte.${asOfDate}`)
            .order("version", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (child.error)
            this.fail(child.error, "Unable to resolve subassembly BOM.");
          childBomId = child.data?.id || null;
        }
        output.push({
          itemId: String(childId),
          parentItemId: itemId,
          level,
          quantity: required,
          scrapPct: scrap,
          buildable,
          bomId: childBomId || undefined,
        });
        if (buildable) await walk(String(childId), itemId, required, level + 1);
      }
      seen.delete(key);
    };
    await walk(finishedItemId, finishedItemId, quantity, 1);
    return output;
  }

  async run(tenantId: string, userId: string, programId: string) {
    const { data: p, error } = await this.db
      .from("production_programs")
      .select("*,waves:production_build_waves(*)")
      .eq("tenant_id", tenantId)
      .eq("id", programId)
      .maybeSingle();
    if (error || !p)
      throw new NotFoundException("Production program not found.");
    if (p.frozen_at)
      this.fail(
        null,
        "This production plan is frozen. Use the governed unfreeze action before recalculating it.",
      );
    const { data: topBom, error: be } = await this.db
      .from("bom_headers")
      .select("id,item_id,version")
      .eq("tenant_id", tenantId)
      .eq("item_id", p.finished_item_id)
      .eq("is_active", true)
      .eq("lifecycle_status", "APPROVED")
      .lte("effective_from", p.start_date)
      .or(`effective_to.is.null,effective_to.gte.${p.start_date}`)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (be || !topBom)
      this.fail(be, "Active BOM is required for the finished item.");
    const waves = (p.waves || [])
        .filter((x: any) => x.status !== "CANCELLED")
        .sort((a: any, b: any) => a.wave_number - b.wave_number),
      explosions = new Map<string, Explosion[]>(),
      allItemIds = new Set<string>([String(p.finished_item_id)]),
      allBomIds = new Set<string>([String(topBom.id)]);
    for (const wave of waves) {
      const x = await this.explode(
        tenantId,
        p.finished_item_id,
        this.n(wave.quantity),
        p.start_date,
      );
      explosions.set(wave.id, x);
      x.forEach((n) => {
        allItemIds.add(n.itemId);
        if (n.bomId) allBomIds.add(String(n.bomId));
      });
    }
    const ids = [...allItemIds],
      bomIds = [...allBomIds];
    const [
      { data: items, error: ie },
      { data: entries },
      { data: stocks },
      { data: routing, error: re },
      { data: policies },
      { data: stations },
      { data: slots },
      { data: completions },
      { data: orders, error: oe },
      { data: receipts, error: ge },
      { data: holidays },
      { data: shifts },
      { data: downtimes },
      { data: vendors },
      { data: maintenanceAssets },
      { data: maintenanceOrders },
      { data: itemPolicies },
      { data: routingConstraints },
      { data: resourceAlternatives },
      { data: changeovers },
      { data: employeeSkills },
      { data: toolResources },
      { data: qualityHistory },
    ] = await Promise.all([
      ids.length
        ? this.db
            .from("items")
            .select("id,code,name,uom,lead_time_days,standard_cost,category")
            .eq("tenant_id", tenantId)
            .in("id", ids)
        : Promise.resolve({ data: [], error: null } as any),
      ids.length
        ? this.db
            .from("stock_entries")
            .select("item_id,available_quantity")
            .eq("tenant_id", tenantId)
            .in("item_id", ids)
            .gt("available_quantity", 0)
        : Promise.resolve({ data: [] } as any),
      ids.length
        ? this.db
            .from("inventory_stock")
            .select("item_id,available_quantity,allocated_quantity")
            .eq("tenant_id", tenantId)
            .in("item_id", ids)
        : Promise.resolve({ data: [] } as any),
      this.db
        .from("production_routing")
        .select("*")
        .eq("tenant_id", tenantId)
        .in("bom_id", bomIds)
        .order("sequence_no"),
      this.db
        .from("production_stage_policies")
        .select("*")
        .eq("tenant_id", tenantId),
      this.db.from("work_stations").select("*").eq("tenant_id", tenantId),
      this.db
        .from("production_capacity_slots")
        .select("*")
        .eq("tenant_id", tenantId)
        .gte("work_date", p.start_date)
        .lte("work_date", p.due_date),
      this.db
        .from("station_completions")
        .select("routing_id,quantity_completed,start_time,end_time")
        .eq("tenant_id", tenantId)
        .not("end_time", "is", null)
        .limit(3000),
      this.db
        .from("purchase_orders")
        .select(
          "id,po_number,vendor_id,po_date,delivery_date,status,purchase_order_items(id,item_id,item_code,ordered_qty,received_qty,delivery_date)",
        )
        .eq("tenant_id", tenantId),
      this.db
        .from("grns")
        .select(
          "id,po_id,receipt_date,status,grn_items(item_id,po_item_id,accepted_qty)",
        )
        .eq("tenant_id", tenantId)
        .order("receipt_date", { ascending: false })
        .limit(2000),
      this.db
        .from("hr_holidays")
        .select("start_date,end_date")
        .eq("tenant_id", tenantId)
        .lte("start_date", p.due_date)
        .or(`end_date.is.null,end_date.gte.${p.start_date}`),
      this.db
        .from("manufacturing_shift_plans")
        .select("id,work_station_id,work_date,planned_production_minutes")
        .eq("tenant_id", tenantId)
        .gte("work_date", p.start_date)
        .lte("work_date", p.due_date),
      this.db
        .from("manufacturing_downtime_events")
        .select("shift_id,downtime_minutes")
        .eq("tenant_id", tenantId),
      this.db
        .from("vendors")
        .select("id,code,name,is_active,is_verified,approval_status")
        .eq("tenant_id", tenantId),
      this.db
        .from("plant_assets")
        .select("id,work_station_id")
        .eq("tenant_id", tenantId)
        .not("work_station_id", "is", null),
      this.db
        .from("plant_maintenance_work_orders")
        .select(
          "id,asset_id,status,planned_date,planned_start,planned_end,downtime_minutes",
        )
        .eq("tenant_id", tenantId)
        .in("status", ["OPEN", "IN_PROGRESS"])
        .gte("planned_date", p.start_date)
        .lte("planned_date", p.due_date),
      this.db
        .from("production_item_planning_policies")
        .select("*")
        .eq("tenant_id", tenantId)
        .in("item_id", ids),
      this.db
        .from("production_routing_constraints")
        .select("*")
        .eq("tenant_id", tenantId),
      this.db
        .from("production_resource_alternatives")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("is_active", true),
      this.db
        .from("production_changeover_matrix")
        .select("*")
        .eq("tenant_id", tenantId),
      this.db
        .from("production_employee_skills")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("active", true),
      this.db
        .from("production_tool_resources")
        .select("*")
        .eq("tenant_id", tenantId),
      this.db
        .from("quality_inspections")
        .select("*")
        .eq("tenant_id", tenantId)
        .limit(5000),
    ]);
    if (ie) this.fail(ie, "Unable to read item planning data.");
    if (re) this.fail(re, "Unable to read production routing.");
    if (oe) this.fail(oe, "Unable to read inbound purchase supply.");
    if (ge) this.fail(ge, "Unable to read supplier receipt history.");
    const itemMap = new Map((items || []).map((x: any) => [String(x.id), x])),
      policyMap = new Map(
        (policies || []).map((x: any) => [String(x.routing_id), x]),
      ),
      stationMap = new Map((stations || []).map((x: any) => [String(x.id), x])),
      itemPolicyMap = new Map(
        (itemPolicies || []).map((x: any) => [String(x.item_id), x]),
      ),
      constraintMap = new Map(
        (routingConstraints || []).map((x: any) => [String(x.routing_id), x]),
      );
    const entryAvail = new Map<string, number>(),
      stockAvail = new Map<string, number>(),
      reserved = new Map<string, number>();
    for (const x of entries || [])
      entryAvail.set(
        String(x.item_id),
        (entryAvail.get(String(x.item_id)) || 0) + this.n(x.available_quantity),
      );
    for (const x of stocks || []) {
      stockAvail.set(
        String(x.item_id),
        (stockAvail.get(String(x.item_id)) || 0) + this.n(x.available_quantity),
      );
      reserved.set(
        String(x.item_id),
        (reserved.get(String(x.item_id)) || 0) + this.n(x.allocated_quantity),
      );
    }
    const available = new Map(
      ids.map((id) => [
        id,
        Math.max(entryAvail.get(id) || 0, stockAvail.get(id) || 0),
      ]),
    );
    const vendorMap = new Map(
      (vendors || []).map((x: any) => [String(x.id), x]),
    );
    const codeToId = new Map(
        (items || []).map((x: any) => [
          this.t(x.code).toUpperCase(),
          String(x.id),
        ]),
      ),
      incoming = new Map<
        string,
        Array<{ date: string; quantity: number; poNumber?: string }>
      >(),
      poDate = new Map<string, string>(),
      poDue = new Map<string, string>(),
      poVendor = new Map<string, string>(),
      poItemToItem = new Map<string, string>();
    for (const po of orders || []) {
      poDate.set(String(po.id), String(po.po_date || ""));
      poDue.set(String(po.id), String(po.delivery_date || ""));
      poVendor.set(String(po.id), String(po.vendor_id || ""));
      if (
        ["DRAFT", "REJECTED", "CANCELLED", "CLOSED"].includes(
          this.t(po.status).toUpperCase(),
        )
      )
        continue;
      for (const line of po.purchase_order_items || []) {
        const itemId = String(
          line.item_id ||
            codeToId.get(this.t(line.item_code).toUpperCase()) ||
            "",
        );
        if (!itemId) continue;
        poItemToItem.set(String(line.id), itemId);
        const open = Math.max(
            0,
            this.n(line.ordered_qty) - this.n(line.received_qty),
          ),
          date = String(
            line.delivery_date || po.delivery_date || p.due_date,
          ).slice(0, 10);
        if (open > 0) {
          const list = incoming.get(itemId) || [];
          list.push({ date, quantity: open, poNumber: po.po_number });
          incoming.set(itemId, list);
        }
      }
    }
    for (const list of incoming.values())
      list.sort((a, b) => a.date.localeCompare(b.date));
    const historicalLeadSamples = new Map<string, number[]>(),
      vendorSamples = new Map<
        string,
        Array<{ lead: number; onTime: boolean }>
      >();
    for (const grn of receipts || []) {
      if (
        ["DRAFT", "REJECTED", "CANCELLED"].includes(
          this.t(grn.status).toUpperCase(),
        )
      )
        continue;
      const poId = String(grn.po_id || ""),
        orderedOn = poDate.get(poId);
      if (!orderedOn || !grn.receipt_date) continue;
      const elapsed = Math.max(
          0,
          Math.ceil(
            (this.date(grn.receipt_date).getTime() -
              this.date(orderedOn).getTime()) /
              86400000,
          ),
        ),
        due = poDue.get(poId),
        vendorId = poVendor.get(poId) || "";
      for (const line of grn.grn_items || []) {
        if (this.n(line.accepted_qty) <= 0) continue;
        const itemId = String(
          line.item_id || poItemToItem.get(String(line.po_item_id || "")) || "",
        );
        if (!itemId) continue;
        const samples = historicalLeadSamples.get(itemId) || [];
        samples.push(elapsed);
        historicalLeadSamples.set(itemId, samples);
        if (vendorId) {
          const key = `${itemId}|${vendorId}`,
            v = vendorSamples.get(key) || [];
          v.push({
            lead: elapsed,
            onTime:
              !due ||
              String(grn.receipt_date).slice(0, 10) <= String(due).slice(0, 10),
          });
          vendorSamples.set(key, v);
        }
      }
    }
    const historicalLead = new Map<string, number>();
    for (const [itemId, samples] of historicalLeadSamples) {
      const recent = samples.slice(0, 20).sort((a, b) => a - b),
        middle = Math.floor(recent.length / 2),
        median =
          recent.length % 2
            ? recent[middle]
            : (recent[middle - 1] + recent[middle]) / 2;
      historicalLead.set(itemId, median);
    }
    const vendorRecommendation = new Map<string, any>();
    for (const [key, samples] of vendorSamples) {
      const [itemId, vendorId] = key.split("|"),
        recent = samples.slice(0, 20),
        leads = recent.map((x) => x.lead).sort((a, b) => a - b),
        middle = Math.floor(leads.length / 2),
        median =
          leads.length % 2
            ? leads[middle]
            : (leads[middle - 1] + leads[middle]) / 2,
        onTime = (recent.filter((x) => x.onTime).length / recent.length) * 100,
        vendor = vendorMap.get(vendorId);
      if (
        !vendor ||
        vendor.is_active === false ||
        vendor.is_verified !== true ||
        this.t(vendor.approval_status).toUpperCase() !== "APPROVED"
      )
        continue;
      const candidate = {
          vendor_id: vendorId,
          vendor_code: vendor.code,
          vendor_name: vendor.name,
          sample_count: recent.length,
          median_lead_days: Number(median.toFixed(2)),
          on_time_pct: Number(onTime.toFixed(2)),
          score: Number((onTime - Math.min(60, median)).toFixed(2)),
        },
        current = vendorRecommendation.get(itemId);
      if (
        !current ||
        candidate.score > current.score ||
        (candidate.score === current.score &&
          candidate.sample_count > current.sample_count)
      )
        vendorRecommendation.set(itemId, candidate);
    }
    const hist = new Map<string, number[]>();
    for (const x of completions || []) {
      const q = this.n(x.quantity_completed),
        m =
          (new Date(x.end_time).getTime() - new Date(x.start_time).getTime()) /
          60000;
      if (q > 0 && m > 0 && m < 525600) {
        const a = hist.get(String(x.routing_id)) || [];
        a.push(m / q);
        hist.set(String(x.routing_id), a);
      }
    }
    const holidayDates = new Set<string>();
    for (const h of holidays || []) {
      let d = this.date(h.start_date),
        end = this.date(h.end_date || h.start_date);
      while (d <= end) {
        holidayDates.add(d.toISOString().slice(0, 10));
        d.setUTCDate(d.getUTCDate() + 1);
      }
    }
    const assetStation = new Map(
        (maintenanceAssets || []).map((x: any) => [
          String(x.id),
          String(x.work_station_id || ""),
        ]),
      ),
      maintenanceByStation = new Map<
        string,
        Array<{ date: string; minutes: number }>
      >();
    for (const x of maintenanceOrders || []) {
      const stationId = assetStation.get(String(x.asset_id || ""));
      if (!stationId) continue;
      let minutes = this.n(x.downtime_minutes);
      if (!minutes && x.planned_start && x.planned_end)
        minutes = Math.max(
          0,
          (new Date(x.planned_end).getTime() -
            new Date(x.planned_start).getTime()) /
            60000,
        );
      if (!minutes)
        minutes = this.n(p.assumptions?.default_daily_minutes || 480);
      const list = maintenanceByStation.get(stationId) || [];
      list.push({
        date: String(x.planned_date || x.planned_start || "").slice(0, 10),
        minutes,
      });
      maintenanceByStation.set(stationId, list);
    }
    const capacityCalendarByStation = new Map<string, DailyCapacity[]>();
    const calendarFor = (stationId: string) => {
      if (!capacityCalendarByStation.has(stationId)) {
        capacityCalendarByStation.set(
          stationId,
          buildDailyCapacityCalendar({
            stationId,
            startDate: p.start_date,
            endDate: p.due_date,
            defaultDailyMinutes: this.n(
              p.assumptions?.default_daily_minutes || 480,
            ),
            slots: slots || [],
            shifts: shifts || [],
            downtimes: downtimes || [],
            maintenance: maintenanceByStation.get(stationId) || [],
            holidays: holidayDates,
          }),
        );
      }
      return capacityCalendarByStation.get(stationId)!;
    };
    const capacityFor = (stationId: string, due: string) =>
      calendarFor(stationId)
        .filter((day) => day.work_date <= due)
        .reduce((sum, day) => sum + day.available_minutes, 0);
    const skillsByCode = new Map<string, number>();
    for (const x of employeeSkills || []) {
      if (
        x.valid_until &&
        String(x.valid_until) < new Date().toISOString().slice(0, 10)
      )
        continue;
      const code = this.t(x.skill_code).toUpperCase();
      skillsByCode.set(code, (skillsByCode.get(code) || 0) + 1);
    }
    const usableToolQuantity = (
      codeValue: any,
      stationId: string,
      date: string,
    ) =>
      (toolResources || [])
        .filter(
          (tool: any) =>
            this.t(tool.tool_code).toUpperCase() ===
              this.t(codeValue).toUpperCase() &&
            (!tool.work_station_id ||
              String(tool.work_station_id) === stationId) &&
            toolResourceUsable(tool, date),
        )
        .reduce(
          (sum: number, tool: any) =>
            sum + Math.max(0, this.n(tool.available_quantity)),
          0,
        );
    const qualityByItem = new Map<
      string,
      { accepted: number; rejected: number }
    >();
    for (const x of qualityHistory || []) {
      const itemId = String(x.item_id || x.product_item_id || "");
      if (!itemId) continue;
      const accepted = this.n(
          x.accepted_quantity || x.approved_quantity || x.passed_quantity,
        ),
        rejected = this.n(
          x.rejected_quantity || x.failed_quantity || x.scrap_quantity,
        ),
        old = qualityByItem.get(itemId) || { accepted: 0, rejected: 0 };
      old.accepted += accepted;
      old.rejected += rejected;
      qualityByItem.set(itemId, old);
    }
    const altByRouting = new Map<string, any[]>();
    for (const x of resourceAlternatives || []) {
      const key = String(x.routing_id),
        list = altByRouting.get(key) || [];
      list.push(x);
      altByRouting.set(key, list);
    }
    for (const list of altByRouting.values())
      list.sort((a, b) => this.n(a.priority) - this.n(b.priority));
    const changeoverMap = new Map(
      (changeovers || []).map((x: any) => [
        `${x.work_station_id}|${this.t(x.from_setup_family)}|${this.t(x.to_setup_family)}`,
        x,
      ]),
    );
    const stageRows: any[] = [],
      stationLoad = new Map<string, number>(),
      stationReservations = new Map<string, Map<string, number>>(),
      lastSetupFamily = new Map<string, string>();
    const selectResource = (r: any, due: string, requiredGuess: number) => {
      const candidates = [
        {
          work_station_id: r.work_station_id,
          priority: 0,
          efficiency_percent: 100,
          additional_setup_minutes: 0,
          cost_per_hour: 0,
        },
        ...(altByRouting.get(String(r.id)) || []),
      ].filter((x) => x.work_station_id);
      return candidates
        .map((x) => {
          const stationId = String(x.work_station_id),
            cap = capacityFor(stationId, due),
            load = stationLoad.get(stationId) || 0,
            finishRisk = Math.max(0, load + requiredGuess - cap),
            score =
              finishRisk * 1000 +
              this.n(x.priority) * 10 +
              this.n(x.cost_per_hour);
          return { x, score, cap, load };
        })
        .sort((a, b) => a.score - b.score)[0];
    };
    const scheduleStage = (wave: any, node: any, r: any, endCursor: Date) => {
      const due = endCursor.toISOString().slice(0, 10),
        policy = policyMap.get(String(r.id)) || {},
        constraint = constraintMap.get(String(r.id)) || {},
        history = hist.get(String(r.id)) || [],
        historical = history.length
          ? history.reduce((a, b) => a + b, 0) / history.length
          : null,
        cycle = historical || this.n(r.cycle_time_minutes),
        eff =
          this.n(
            policy.efficiency_percent ||
              p.assumptions?.default_efficiency_pct ||
              85,
          ) / 100,
        runMinutes = (cycle * this.n(node.quantity)) / Math.max(0.01, eff),
        other =
          this.n(policy.queue_minutes) +
          this.n(policy.move_minutes) +
          this.n(policy.wait_minutes),
        resource = selectResource(
          r,
          due,
          this.n(r.setup_time_minutes) + runMinutes + other,
        ),
        stationId = String(
          resource?.x?.work_station_id || r.work_station_id || "",
        ),
        setupFamily = this.t(constraint.setup_family),
        previousFamily = lastSetupFamily.get(stationId) || "",
        matrix = changeoverMap.get(
          `${stationId}|${previousFamily}|${setupFamily}`,
        ),
        changeover =
          this.n(matrix?.changeover_minutes) +
          this.n(resource?.x?.additional_setup_minutes),
        requiredSkills = Array.isArray(constraint.required_skill_codes)
          ? constraint.required_skill_codes
          : [],
        requiredTools = Array.isArray(constraint.required_tool_codes)
          ? constraint.required_tool_codes
          : [],
        qualified = requiredSkills.length
          ? Math.min(
              ...requiredSkills.map(
                (x: any) => skillsByCode.get(this.t(x).toUpperCase()) || 0,
              ),
            )
          : this.n(constraint.minimum_qualified_people || 0),
        needed = this.n(constraint.minimum_qualified_people || 0),
        skillCoverage = needed
          ? Math.min(100, (qualified / needed) * 100)
          : 100,
        missingTools = requiredTools.filter(
          (x: any) => usableToolQuantity(x, stationId, due) < 1,
        ),
        campaignMin = this.n(constraint.campaign_min_quantity),
        campaignMax = this.n(constraint.campaign_max_quantity),
        campaignRisk =
          (campaignMin > 0 && this.n(node.quantity) < campaignMin) ||
          (campaignMax > 0 && this.n(node.quantity) > campaignMax),
        required =
          this.n(r.setup_time_minutes) + changeover + runMinutes + other,
        reservationLedger =
          stationReservations.get(stationId) || new Map<string, number>(),
        allocation = allocateCapacityBackward(
          required,
          due,
          calendarFor(stationId),
          reservationLedger,
        ),
        end = this.date(allocation.planned_end || due).toISOString(),
        start = this.date(
          allocation.planned_start || p.start_date,
        ).toISOString(),
        availableCapacity = resource?.cap ?? capacityFor(stationId, due),
        loadBefore = stationLoad.get(stationId) || 0,
        totalLoad = loadBefore + required;
      stationReservations.set(stationId, reservationLedger);
      stationLoad.set(stationId, totalLoad);
      if (setupFamily) lastSetupFamily.set(stationId, setupFamily);
      const loadPct = availableCapacity
          ? (totalLoad / availableCapacity) * 100
          : 999,
        overtime = Math.max(
          allocation.unallocated_minutes,
          totalLoad - availableCapacity,
          0,
        ),
        quality = qualityByItem.get(String(node.itemId)),
        yieldPct =
          quality && quality.accepted + quality.rejected > 0
            ? (quality.accepted / (quality.accepted + quality.rejected)) * 100
            : 100,
        yieldRisk = yieldPct < 95,
        skillRisk = skillCoverage < 100,
        toolRisk = missingTools.length > 0,
        isBottleneck =
          Boolean(policy.is_bottleneck) ||
          loadPct >= 85 ||
          skillRisk ||
          toolRisk,
        mode = policy.execution_mode || "SEQUENTIAL",
        item = itemMap.get(String(node.itemId)) || {};
      stageRows.push({
        tenant_id: tenantId,
        wave_id: wave.id,
        routing_id: r.id,
        bom_id: node.bomId,
        sequence_no: r.sequence_no,
        stage_name: r.operation_name,
        stage_group_code: policy.stage_group_code || null,
        execution_mode: mode,
        work_station_id: stationId,
        item_id: node.itemId,
        parent_item_id: node.parentItemId || null,
        bom_level: node.level,
        item_code: item.code || null,
        item_name: item.name || null,
        quantity: node.quantity,
        setup_minutes: this.n(r.setup_time_minutes) + changeover,
        run_minutes: Number(runMinutes.toFixed(2)),
        queue_move_wait_minutes: other,
        required_capacity_minutes: Number(required.toFixed(2)),
        available_capacity_minutes: Number(availableCapacity.toFixed(2)),
        planned_start: start,
        planned_end: end,
        is_bottleneck: isBottleneck,
        load_percent: Number(loadPct.toFixed(2)),
        overtime_minutes: Number(overtime.toFixed(2)),
        historical_cycle_minutes: historical
          ? Number(historical.toFixed(4))
          : null,
        confidence_pct:
          history.length >= 20 ? 90 : history.length >= 5 ? 70 : 45,
        yield_pct: Number(yieldPct.toFixed(2)),
        skill_coverage_pct: Number(skillCoverage.toFixed(2)),
        selected_resource_reason: resource?.x?.priority
          ? `Alternate resource selected to reduce capacity/cost risk (priority ${resource.x.priority}). ${allocation.allocated_minutes.toFixed(0)} minutes placed on ${allocation.allocations.length} open calendar date(s).`
          : `Primary routing resource selected. ${allocation.allocated_minutes.toFixed(0)} minutes placed on ${allocation.allocations.length} open calendar date(s).`,
        recommendation: toolRisk
          ? `Required tooling unavailable: ${missingTools.join(", ")}. Reserve/repair tooling or move to an approved alternative.`
          : campaignRisk
            ? `Wave quantity is outside the approved campaign range ${campaignMin || 0}-${campaignMax || "∞"}; regroup waves or approve an exception.`
            : skillRisk
              ? "Qualified skill coverage is below requirement; assign certified labour or reschedule."
              : yieldRisk
                ? `Historical yield is ${yieldPct.toFixed(1)}%; protect the wave with an approved yield allowance and quality gate.`
                : overtime > 0
                  ? `Add ${Math.ceil(overtime / 60)} capacity hours, use an alternate resource, subcontract or revise the wave date.`
                  : isBottleneck
                    ? "Protect this stage with a controlled input buffer; throttle upstream release to this capacity."
                    : mode === "SEQUENTIAL"
                      ? "Release only against the downstream buffer."
                      : `Run the ${policy.stage_group_code || "grouped"} stages ${mode.toLowerCase()} and synchronize their output to the consuming stage.`,
      });
      return this.date(start);
    };
    for (const wave of waves) {
      const nodes = [
          {
            itemId: String(p.finished_item_id),
            parentItemId: null,
            level: 0,
            quantity: this.n(wave.quantity),
            bomId: String(topBom.id),
          },
          ...(explosions.get(wave.id) || []).filter(
            (x) => x.buildable && x.bomId,
          ),
        ].sort((a: any, b: any) => a.level - b.level),
        startByItem = new Map<string, Date>();
      for (const node of nodes) {
        let cursor =
          node.level === 0
            ? this.date(wave.required_by)
            : startByItem.get(String(node.parentItemId)) ||
              this.date(wave.required_by);
        const nodeRouting = (routing || [])
          .filter((x: any) => String(x.bom_id) === String(node.bomId))
          .sort((a: any, b: any) => b.sequence_no - a.sequence_no);
        for (let i = 0; i < nodeRouting.length; ) {
          const first = nodeRouting[i],
            policy = policyMap.get(String(first.id)) || {},
            group = this.t(policy.stage_group_code),
            mode = policy.execution_mode || "SEQUENTIAL";
          if (group && mode !== "SEQUENTIAL") {
            const members: any[] = [];
            while (i < nodeRouting.length) {
              const candidate = nodeRouting[i],
                candidatePolicy = policyMap.get(String(candidate.id)) || {};
              if (
                this.t(candidatePolicy.stage_group_code) !== group ||
                (candidatePolicy.execution_mode || "SEQUENTIAL") !== mode
              )
                break;
              members.push(candidate);
              i++;
            }
            const starts = members.map((member) =>
              scheduleStage(wave, node, member, cursor),
            );
            cursor = new Date(Math.min(...starts.map((x) => x.getTime())));
          } else {
            cursor = scheduleStage(wave, node, first, cursor);
            i++;
          }
        }
        startByItem.set(String(node.itemId), cursor);
      }
    }
    const earliestStage = stageRows.length
        ? Math.min(...stageRows.map((x) => new Date(x.planned_start).getTime()))
        : this.date(p.start_date).getTime(),
      programStart = this.date(p.start_date).getTime(),
      scheduleShiftDays =
        earliestStage < programStart
          ? Math.ceil((programStart - earliestStage) / 86400000)
          : 0;
    if (scheduleShiftDays > 0)
      for (const stage of stageRows) {
        stage.planned_start =
          this.addDays(stage.planned_start, scheduleShiftDays) +
          "T00:00:00.000Z";
        stage.planned_end =
          this.addDays(stage.planned_end, scheduleShiftDays) + "T00:00:00.000Z";
        stage.recommendation = `Earliest executable start was protected at ${p.start_date}. ${stage.recommendation}`;
      }
    const consumeIncoming = (
      itemId: string,
      requiredBy: string,
      need: number,
    ) => {
      let remaining = Math.max(0, need),
        used = 0;
      for (const delivery of incoming.get(itemId) || []) {
        if (
          delivery.date > requiredBy ||
          delivery.quantity <= 0 ||
          remaining <= 0
        )
          continue;
        const take = Math.min(delivery.quantity, remaining);
        delivery.quantity -= take;
        remaining -= take;
        used += take;
      }
      return used;
    };
    const materialRows: any[] = [];
    let cash = 0,
      excessRisk = 0;
    for (const wave of waves) {
      const byItem = new Map<string, Explosion>();
      for (const x of explosions.get(wave.id) || []) {
        const old = byItem.get(x.itemId);
        if (old) {
          old.quantity += x.quantity;
          old.level = Math.min(old.level, x.level);
        } else byItem.set(x.itemId, { ...x });
      }
      const waveStages = stageRows.filter((x) => x.wave_id === wave.id),
        requiredBy = (
          waveStages.sort((a, b) => a.sequence_no - b.sequence_no)[0]
            ?.planned_start || `${wave.required_by}T00:00:00.000Z`
        ).slice(0, 10);
      for (const x of byItem.values()) {
        const item = itemMap.get(x.itemId) || {},
          planning = itemPolicyMap.get(x.itemId) || {},
          gross = this.n(x.quantity),
          safetyMethod = this.t(planning.safety_stock_method || "PERCENT"),
          safety =
            safetyMethod === "FIXED"
              ? this.n(planning.safety_stock_value)
              : (gross *
                  this.n(
                    planning.safety_stock_value ||
                      p.assumptions?.safety_pct ||
                      0,
                  )) /
                100,
          totalNeed = gross + safety + this.n(planning.minimum_stock),
          stock = Math.max(0, available.get(x.itemId) || 0),
          use = Math.min(stock, totalNeed);
        available.set(x.itemId, stock - use);
        const incomingUse = consumeIncoming(
            x.itemId,
            requiredBy,
            totalNeed - use,
          ),
          rawNet = Math.max(0, totalNeed - use - incomingUse),
          multiple = Math.max(
            this.n(planning.order_multiple),
            this.n(planning.pack_size),
          ),
          moq = this.n(planning.minimum_order_quantity),
          net =
            rawNet <= 0
              ? 0
              : multiple > 0
                ? Math.max(moq, Math.ceil(rawNet / multiple) * multiple)
                : Math.max(moq, rawNet),
          historical = this.n(historicalLead.get(x.itemId)),
          masterLead = Math.max(0, Math.round(this.n(item.lead_time_days))),
          lead = Math.max(0, Math.round(historical || masterLead)),
          release = this.addDays(requiredBy, -lead),
          today = new Date().toISOString().slice(0, 10),
          unit = this.n(item.standard_cost),
          amount = net * unit,
          procurementType = this.t(
            planning.procurement_type || "AUTO",
          ).toUpperCase(),
          make =
            (x.buildable && procurementType !== "BUY") ||
            procurementType === "MAKE";
        let action = "MONITOR";
        if (net <= 0) action = use > 0 ? "RESERVE" : "DO_NOT_BUY";
        else if (make) action = release <= today ? "BUILD_NOW" : "BUILD_LATER";
        else
          action =
            release < today
              ? "EXPEDITE"
              : release <= this.addDays(today, 7)
                ? "BUY_NOW"
                : "BUY_LATER";
        const excess = Math.max(0, net - rawNet),
          shelfRisk =
            this.n(planning.shelf_life_days) > 0 &&
            lead >
              this.n(planning.shelf_life_days) -
                this.n(planning.minimum_remaining_shelf_life_days),
          risk =
            net <= 0
              ? "LOW"
              : release < today || shelfRisk
                ? "CRITICAL"
                : release <= this.addDays(today, 7)
                  ? "HIGH"
                  : lead > 30 || excess > gross * 0.25
                    ? "MEDIUM"
                    : "LOW";
        cash += make ? 0 : amount;
        excessRisk += excess * unit;
        const supplier = vendorRecommendation.get(x.itemId) || null;
        materialRows.push({
          tenant_id: tenantId,
          wave_id: wave.id,
          item_id: x.itemId,
          parent_item_id: x.parentItemId,
          bom_level: x.level,
          item_code: item.code || null,
          item_name: item.name || null,
          uom: item.uom || null,
          required_by: requiredBy,
          recommended_release_date: release,
          gross_requirement: Number(gross.toFixed(4)),
          scrap_quantity: Number(
            ((gross * x.scrapPct) / Math.max(100 + x.scrapPct, 100)).toFixed(4),
          ),
          safety_quantity: Number(safety.toFixed(4)),
          available_quantity: stock,
          reserved_quantity: reserved.get(x.itemId) || 0,
          incoming_quantity: Number(incomingUse.toFixed(4)),
          net_requirement: Number(rawNet.toFixed(4)),
          suggested_quantity: Number(net.toFixed(4)),
          lead_time_days: lead,
          historical_lead_time_days: historical || null,
          unit_cost: unit,
          cash_required: Number((make ? 0 : amount).toFixed(2)),
          supply_action: action,
          shortage_risk: risk,
          pegging: {
            program_code: p.program_code,
            wave_number: wave.wave_number,
            wave_name: wave.wave_name,
            parent_item_id: x.parentItemId,
            finished_item_id: p.finished_item_id,
            supplier_recommendation: supplier,
            planning_policy: {
              procurement_type: procurementType,
              minimum_order_quantity: moq,
              order_multiple: this.n(planning.order_multiple),
              pack_size: this.n(planning.pack_size),
              batch_constraint: planning.batch_constraint || "NONE",
              shelf_life_days: planning.shelf_life_days || null,
              alternate_item_ids: planning.alternate_item_ids || [],
              substitution_approval_required:
                planning.substitution_approval_required !== false,
            },
            rounding_excess: Number(excess.toFixed(4)),
          },
          recommendation: shelfRisk
            ? "Shelf-life coverage is unsafe for the replenishment lead time; buyer must approve a shorter lead source or substitution."
            : incomingUse > 0 && net <= 0
              ? "Approved inbound supply covers this dated requirement; monitor receipt instead of buying again."
              : action === "EXPEDITE"
                ? "Requirement date is inside the replenishment lead time; expedite, substitute, transfer or reschedule."
                : action === "BUY_LATER"
                  ? "Do not buy yet; release on the recommended date to protect cash."
                  : action.startsWith("BUILD")
                    ? "Create the sub-assembly only for this build wave and synchronize it to the consuming stage."
                    : action === "RESERVE"
                      ? "Reserve existing usable stock for this wave."
                      : "No supply action required.",
        });
      }
    }
    const bottleneck = [...stageRows].sort(
        (a, b) => b.load_percent - a.load_percent,
      )[0],
      calendarEvidenceDays = [...capacityCalendarByStation.values()].flat(),
      openCalendarDays = calendarEvidenceDays.filter(
        (day) => day.available_minutes > 0,
      ),
      configuredCalendarDays = openCalendarDays.filter((day) =>
        ["CAPACITY_SLOT", "SHIFT_PLAN"].includes(day.source),
      ).length,
      calendarCoveragePct = openCalendarDays.length
        ? (configuredCalendarDays / openCalendarDays.length) * 100
        : 0,
      calendarConfidencePenalty = openCalendarDays.length
        ? Math.round(
            (openCalendarDays.filter((day) => day.source === "DEFAULT_WEEKDAY")
              .length /
              openCalendarDays.length) *
              10,
          )
        : 15,
      maxOvertime = Math.max(
        0,
        ...stageRows.map((x) => this.n(x.overtime_minutes)),
      ),
      scheduledCompletion = stageRows.length
        ? stageRows
            .map((x) => String(x.planned_end).slice(0, 10))
            .sort()
            .at(-1)!
        : p.due_date,
      feasible =
        scheduledCompletion <= p.due_date &&
        !stageRows.some((x) => x.overtime_minutes > 0) &&
        !materialRows.some((x) => x.shortage_risk === "CRITICAL"),
      projected =
        maxOvertime > 0
          ? projectCapacityRecoveryDate(
              p.due_date,
              maxOvertime,
              this.n(p.assumptions?.default_daily_minutes || 480),
              holidayDates,
            )
          : scheduledCompletion,
      confidence = Math.max(
        5,
        Math.min(
          98,
          (feasible ? 90 : 60) -
            materialRows.filter((x) => x.shortage_risk === "CRITICAL").length *
              5 -
            stageRows.filter((x) => x.overtime_minutes > 0).length * 4 -
            calendarConfidencePenalty,
        ),
      );
    const overtimeHours = Math.ceil(maxOvertime / 60),
      lateDays = Math.max(
        0,
        Math.ceil(
          (this.date(projected).getTime() - this.date(p.due_date).getTime()) /
            86400000,
        ),
      );
    const alternatives = (
      maxOvertime > 0
        ? [
            {
              code: "APPROVE_OVERTIME",
              label: "Controlled overtime",
              impact: `Approve ${overtimeHours} bottleneck hours to protect the committed date.`,
              approval_required: true,
              estimated_cost:
                overtimeHours *
                this.n(p.assumptions?.overtime_cost_per_hour || 45),
              risk_score: 20,
              projected_completion_date: p.due_date,
              projected_confidence_pct: Math.min(95, confidence + 25),
              capacity_recovered_minutes: maxOvertime,
            },
            {
              code: "ADD_SHIFT",
              label: "Temporary second shift",
              impact: `Add approximately ${Math.ceil(maxOvertime / Math.max(60, this.n(p.assumptions?.default_daily_minutes || 480)))} shift-days at the constraint.`,
              approval_required: true,
              estimated_cost:
                overtimeHours *
                this.n(p.assumptions?.second_shift_cost_per_hour || 60),
              risk_score: 30,
              projected_completion_date: p.due_date,
              projected_confidence_pct: Math.min(92, confidence + 20),
              capacity_recovered_minutes: maxOvertime,
            },
            {
              code: "SUBCONTRACT_CONSTRAINT",
              label: "Subcontract bottleneck load",
              impact: `Route up to ${overtimeHours} hours through an approved alternate supplier.`,
              approval_required: true,
              estimated_cost:
                overtimeHours *
                this.n(p.assumptions?.subcontract_cost_per_hour || 90),
              risk_score: 45,
              projected_completion_date: p.due_date,
              projected_confidence_pct: Math.min(88, confidence + 15),
              capacity_recovered_minutes: maxOvertime,
            },
            {
              code: "PARTIAL_DELIVERY",
              label: "Protect priority waves",
              impact:
                "Hold lower-priority waves and protect the earliest customer commitment.",
              approval_required: true,
              estimated_cost:
                lateDays *
                this.n(p.assumptions?.late_delivery_cost_per_day || 500) *
                0.5,
              risk_score: 40,
              projected_completion_date: p.due_date,
              projected_confidence_pct: Math.min(90, confidence + 18),
              capacity_recovered_minutes: maxOvertime * 0.6,
            },
            {
              code: "RESCHEDULE",
              label: "Reschedule commitment",
              impact: `Current capacity supports completion around ${projected}.`,
              approval_required: true,
              estimated_cost:
                lateDays *
                this.n(p.assumptions?.late_delivery_cost_per_day || 500),
              risk_score: 70,
              projected_completion_date: projected,
              projected_confidence_pct: Math.min(90, confidence + 10),
              capacity_recovered_minutes: 0,
            },
          ]
        : [
            {
              code: "KEEP_PLAN",
              label: "Keep staged plan",
              impact:
                "Current capacity and material timing support the committed date.",
              approval_required: false,
              estimated_cost: 0,
              risk_score: 5,
              projected_completion_date: p.due_date,
              projected_confidence_pct: confidence,
              capacity_recovered_minutes: 0,
            },
          ]
    )
      .sort(
        (a, b) =>
          a.estimated_cost +
          a.risk_score * 10 -
          (b.estimated_cost + b.risk_score * 10),
      )
      .map((x, i) => ({ ...x, rank: i + 1, recommended: i === 0 }));
    const evidence = {
        program_id: p.id,
        waves: waves.map((x: any) => ({
          id: x.id,
          quantity: x.quantity,
          required_by: x.required_by,
        })),
        stage_count: stageRows.length,
        material_count: materialRows.length,
        feasible,
        projected_completion_date: projected,
        schedule_shift_days: scheduleShiftDays,
        bottleneck_station_id: bottleneck?.work_station_id || null,
        material_cash_required: Number(cash.toFixed(2)),
        capacity_calendar: {
          coverage_pct: Number(calendarCoveragePct.toFixed(2)),
          open_dates: openCalendarDays.length,
          configured_dates: configuredCalendarDays,
          closed_dates: calendarEvidenceDays.filter(
            (day) => day.available_minutes <= 0,
          ).length,
          allocated_dates: Array.from(stationReservations.values()).reduce(
            (sum, ledger) => sum + ledger.size,
            0,
          ),
        },
      },
      hash = createHash("sha256")
        .update(JSON.stringify(evidence))
        .digest("hex"),
      runNo = `APS-${p.program_code}-${Date.now()}`;
    const source = await this.sourceState(tenantId, p);
    const maintenanceMinutes = [...maintenanceByStation.values()]
      .flat()
      .reduce((s, x) => s + x.minutes, 0);
    const cycleSamples = [...hist.values()].reduce((s, x) => s + x.length, 0),
      leadSamples = [...historicalLeadSamples.values()].reduce(
        (s, x) => s + x.length,
        0,
      ),
      qualitySamples = [...qualityByItem.values()].reduce(
        (s, x) => s + x.accepted + x.rejected,
        0,
      ),
      predictiveCalibration = {
        cycle_time: {
          samples: cycleSamples,
          status:
            cycleSamples >= 20
              ? "CALIBRATED"
              : cycleSamples >= 5
                ? "LEARNING"
                : "MASTER_DATA_FALLBACK",
        },
        supplier_lead_time: {
          samples: leadSamples,
          status:
            leadSamples >= 20
              ? "CALIBRATED"
              : leadSamples >= 5
                ? "LEARNING"
                : "MASTER_DATA_FALLBACK",
        },
        yield: {
          samples: qualitySamples,
          status:
            qualitySamples >= 100
              ? "CALIBRATED"
              : qualitySamples > 0
                ? "LEARNING"
                : "DEFAULT_YIELD",
        },
        guardrail:
          "Historical evidence changes recommendations only; approvals and transactional execution remain governed.",
      };
    const { data: run, error: runError } = await this.db
      .from("production_planning_runs")
      .insert({
        tenant_id: tenantId,
        program_id: p.id,
        run_number: runNo,
        feasible,
        delivery_confidence_pct: Number(confidence.toFixed(2)),
        projected_completion_date: projected,
        bottleneck_station_id: bottleneck?.work_station_id || null,
        required_overtime_minutes: Math.ceil(maxOvertime),
        material_cash_required: Number(cash.toFixed(2)),
        excess_wip_cash_risk: Number(excessRisk.toFixed(2)),
        explanation: {
          planning_policy: p.planning_policy,
          method:
            "Finite-capacity backward scheduling of every nested BOM routing with dated supply, yield, workforce, tooling/changeover, maintenance and bottleneck-pull release",
          bottleneck_stage: bottleneck?.stage_name || null,
          bottleneck_station:
            stationMap.get(String(bottleneck?.work_station_id || ""))
              ?.station_name || null,
          critical_materials: materialRows.filter(
            (x) => x.shortage_risk === "CRITICAL",
          ).length,
          nested_subassembly_stage_count: stageRows.filter(
            (x) => x.bom_level > 0,
          ).length,
          schedule_shift_days: scheduleShiftDays,
          predictive_calibration: predictiveCalibration,
          calendar: {
            holiday_days_excluded: holidayDates.size,
            explicit_capacity_slots: (slots || []).length,
            shift_plans: (shifts || []).length,
            downtime_events: (downtimes || []).length,
            planned_maintenance_orders: (maintenanceOrders || []).length,
            planned_maintenance_minutes: maintenanceMinutes,
            open_calendar_dates: openCalendarDays.length,
            configured_calendar_dates: configuredCalendarDays,
            configured_calendar_coverage_pct: Number(
              calendarCoveragePct.toFixed(2),
            ),
            default_weekday_dates: openCalendarDays.filter(
              (day) => day.source === "DEFAULT_WEEKDAY",
            ).length,
            closed_calendar_dates: calendarEvidenceDays.filter(
              (day) => day.available_minutes <= 0,
            ).length,
            allocated_station_dates: Array.from(
              stationReservations.values(),
            ).reduce((sum, ledger) => sum + ledger.size, 0),
            confidence_penalty: calendarConfidencePenalty,
            control:
              "Every stage is allocated only to dated available capacity after shift downtime, holidays and approved maintenance are deducted.",
          },
          alternatives,
          cash_budget: p.cash_budget,
          cash_budget_variance:
            p.cash_budget == null
              ? null
              : Number((cash - this.n(p.cash_budget)).toFixed(2)),
          source_state: source.state,
          source_state_hash: source.hash,
        },
        evidence_hash: hash,
        created_by: userId,
      })
      .select()
      .single();
    if (runError || !run)
      this.fail(runError, "Unable to save production plan.");
    if (stageRows.length) {
      const x = await this.db
        .from("production_stage_plan_lines")
        .insert(stageRows.map((v) => ({ ...v, run_id: run.id })));
      if (x.error) this.fail(x.error, "Unable to save stage plan.");
    }
    if (materialRows.length) {
      const x = await this.db
        .from("production_material_plan_lines")
        .insert(materialRows.map((v) => ({ ...v, run_id: run.id })));
      if (x.error) this.fail(x.error, "Unable to save material plan.");
    }
    await this.db
      .from("production_programs")
      .update({
        status: "PLANNED",
        submitted_by: null,
        submitted_at: null,
        approved_by: null,
        approved_at: null,
        frozen_by: null,
        frozen_at: null,
        freeze_horizon_date: null,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", p.id);
    return this.detail(tenantId, p.id, run.id);
  }

  async procurementProposal(tenantId: string, programId: string) {
    const detail = await this.detail(tenantId, programId),
      groups = new Map<string, any>();
    if (!detail.run)
      this.fail(
        null,
        "Run the production plan before preparing a procurement proposal.",
      );
    for (const line of detail.materials || []) {
      if (
        !["BUY_NOW", "BUY_LATER", "EXPEDITE"].includes(
          String(line.supply_action),
        ) ||
        this.n(line.net_requirement) <= 0
      )
        continue;
      const key = String(line.item_id),
        current = groups.get(key) || {
          item_id: line.item_id,
          item_code: line.item_code,
          item_name: line.item_name,
          uom: line.uom,
          quantity: 0,
          earliest_required_by: line.required_by,
          recommended_release_date: line.recommended_release_date,
          estimated_value: 0,
          waves: [],
          risk: "LOW",
          supplier_recommendation:
            line.pegging?.supplier_recommendation || null,
        };
      current.quantity += this.n(line.suggested_quantity);
      current.estimated_value += this.n(line.cash_required);
      if (String(line.required_by) < String(current.earliest_required_by))
        current.earliest_required_by = line.required_by;
      if (
        String(line.recommended_release_date) <
        String(current.recommended_release_date)
      )
        current.recommended_release_date = line.recommended_release_date;
      current.waves.push(line.pegging?.wave_number);
      if (
        line.shortage_risk === "CRITICAL" ||
        (line.shortage_risk === "HIGH" && current.risk !== "CRITICAL")
      )
        current.risk = line.shortage_risk;
      groups.set(key, current);
    }
    const lines = [...groups.values()]
      .map((x) => ({
        ...x,
        quantity: Number(x.quantity.toFixed(4)),
        estimated_value: Number(x.estimated_value.toFixed(2)),
        waves: [...new Set(x.waves)].sort(),
      }))
      .sort((a, b) =>
        String(a.recommended_release_date).localeCompare(
          String(b.recommended_release_date),
        ),
      );
    return {
      program_id: programId,
      program_code: detail.program.program_code,
      run_id: detail.run.id,
      status: "REVIEW_REQUIRED",
      posting_control:
        "No purchase requisition or purchase order has been created. A permitted buyer must review and create the draft PR through the normal maker-checker flow.",
      currency_code: detail.program.currency_code,
      estimated_value: Number(
        lines.reduce((s, x) => s + x.estimated_value, 0).toFixed(2),
      ),
      lines,
    };
  }

  async staleness(tenantId: string, programId: string) {
    const detail = await this.detail(tenantId, programId);
    if (!detail.run) return { stale: true, reason: "NOT_PLANNED" };
    const current = await this.sourceState(tenantId, detail.program),
      planned = detail.run.explanation?.source_state_hash || null;
    return {
      stale: !planned || planned !== current.hash,
      reason: !planned
        ? "LEGACY_RUN"
        : planned !== current.hash
          ? "SOURCE_DATA_CHANGED"
          : "CURRENT",
      planned_hash: planned,
      current_hash: current.hash,
      checked_at: new Date().toISOString(),
    };
  }

  async createDraftPurchaseRequisition(
    tenantId: string,
    userId: string,
    programId: string,
    b: any,
  ) {
    if (b?.confirm !== true)
      this.fail(
        null,
        "Explicit confirmation is required to create a draft purchase requisition.",
      );
    const key = this.t(b?.idempotency_key);
    if (key.length < 12 || key.length > 120)
      this.fail(null, "A 12-120 character idempotency key is required.");
    const proposal = await this.procurementProposal(tenantId, programId);
    if (!proposal.lines.length)
      this.fail(null, "The current plan has no external purchase requirement.");
    const existing = await this.db
      .from("production_procurement_conversions")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("run_id", proposal.run_id)
      .maybeSingle();
    if (existing.error)
      this.fail(
        existing.error,
        "Unable to verify prior procurement conversion.",
      );
    if (existing.data?.status === "CREATED")
      return {
        status: "ALREADY_CREATED",
        purchase_requisition_id: existing.data.purchase_requisition_id,
        purchase_requisition_number: existing.data.purchase_requisition_number,
        conversion_id: existing.data.id,
      };
    const proposalHash = createHash("sha256")
      .update(JSON.stringify(proposal.lines))
      .digest("hex");
    let conversion = existing.data;
    if (conversion) {
      const updated = await this.db
        .from("production_procurement_conversions")
        .update({
          status: "CREATING",
          idempotency_key: key,
          proposal_hash: proposalHash,
          created_by: userId,
        })
        .eq("tenant_id", tenantId)
        .eq("id", conversion.id)
        .select()
        .single();
      if (updated.error)
        this.fail(updated.error, "Unable to retry draft PR conversion.");
      conversion = updated.data;
    } else {
      const inserted = await this.db
        .from("production_procurement_conversions")
        .insert({
          tenant_id: tenantId,
          program_id: programId,
          run_id: proposal.run_id,
          idempotency_key: key,
          status: "CREATING",
          proposal_hash: proposalHash,
          created_by: userId,
        })
        .select()
        .single();
      if (inserted.error)
        this.fail(inserted.error, "Unable to reserve draft PR conversion.");
      conversion = inserted.data;
    }
    const today = new Date().toISOString().slice(0, 10),
      requiredDate = proposal.lines.reduce(
        (d: any, x: any) =>
          !d || String(x.earliest_required_by) < d
            ? String(x.earliest_required_by)
            : d,
        null,
      );
    try {
      const pr: any = await this.purchaseRequisitions.create(tenantId, userId, {
        status: "DRAFT",
        department: "PRODUCTION",
        requestDate: today,
        requiredDate:
          requiredDate && requiredDate >= today ? requiredDate : today,
        priority: proposal.lines.some((x: any) => x.risk === "CRITICAL")
          ? "URGENT"
          : "HIGH",
        purpose: `Controlled material proposal for ${proposal.program_code}`,
        remarks: `Generated from smart production plan ${proposal.program_code}, run ${proposal.run_id}. Draft only; normal maker-checker approval is mandatory.`,
        items: proposal.lines.map((x: any) => ({
          itemId: x.item_id,
          itemCode: x.item_code,
          itemName: x.item_name,
          description: `Build waves ${x.waves.join(", ")}`,
          uom: x.uom,
          requestedQty: x.quantity,
          estimatedRate: x.quantity
            ? Number((x.estimated_value / x.quantity).toFixed(4))
            : 0,
          requiredDate:
            x.earliest_required_by >= today ? x.earliest_required_by : today,
          vendorId: x.supplier_recommendation?.vendor_id || null,
        })),
      });
      await this.db
        .from("production_procurement_conversions")
        .update({
          status: "CREATED",
          purchase_requisition_id: pr.id,
          purchase_requisition_number: pr.pr_number,
        })
        .eq("tenant_id", tenantId)
        .eq("id", conversion.id);
      return {
        status: "DRAFT_CREATED",
        conversion_id: conversion.id,
        purchase_requisition_id: pr.id,
        purchase_requisition_number: pr.pr_number,
        workflow_control:
          "Draft only. A different authorized user must submit/approve through the normal purchase workflow.",
      };
    } catch (e: any) {
      await this.db
        .from("production_procurement_conversions")
        .update({ status: "FAILED" })
        .eq("tenant_id", tenantId)
        .eq("id", conversion.id);
      throw e;
    }
  }

  async actOnProgram(
    tenantId: string,
    userId: string,
    programId: string,
    b: any,
  ) {
    const action = this.t(b?.action).toUpperCase(),
      reason = this.t(b?.reason);
    if (!["SUBMIT", "APPROVE", "REJECT", "FREEZE", "UNFREEZE"].includes(action))
      this.fail(null, "Unsupported production-plan action.");
    const detail = await this.detail(tenantId, programId),
      p = detail.program,
      now = new Date().toISOString();
    if (!detail.run && action !== "REJECT")
      this.fail(null, "Run the plan before submitting or approving it.");
    if (action === "SUBMIT") {
      if (String(p.created_by) === String(userId) && p.submitted_at)
        this.fail(null, "This plan is already submitted.");
      await this.db
        .from("production_programs")
        .update({
          submitted_by: userId,
          submitted_at: now,
          rejection_reason: null,
          updated_at: now,
        })
        .eq("tenant_id", tenantId)
        .eq("id", programId);
    }
    if (action === "APPROVE") {
      if (!p.submitted_at) this.fail(null, "Submit the plan before approval.");
      if (
        [p.created_by, p.submitted_by]
          .filter(Boolean)
          .map(String)
          .includes(String(userId))
      )
        this.fail(
          null,
          "Maker-checker control: the creator/submitter cannot approve this plan.",
        );
      const stale = await this.staleness(tenantId, programId);
      if (stale.stale)
        this.fail(null, "Source data changed. Replan before approval.");
      await this.db
        .from("production_programs")
        .update({
          status: "APPROVED",
          approved_by: userId,
          approved_at: now,
          rejected_by: null,
          rejected_at: null,
          rejection_reason: null,
          updated_at: now,
        })
        .eq("tenant_id", tenantId)
        .eq("id", programId);
    }
    if (action === "REJECT") {
      if (!reason) this.fail(null, "A rejection reason is required.");
      await this.db
        .from("production_programs")
        .update({
          status: "DRAFT",
          rejected_by: userId,
          rejected_at: now,
          rejection_reason: reason,
          approved_by: null,
          approved_at: null,
          frozen_by: null,
          frozen_at: null,
          updated_at: now,
        })
        .eq("tenant_id", tenantId)
        .eq("id", programId);
    }
    if (action === "FREEZE") {
      if (!p.approved_at)
        this.fail(null, "Approve the plan before freezing it.");
      const horizon = this.t(b?.freeze_horizon_date).slice(0, 10);
      if (!horizon || horizon < p.start_date || horizon > p.due_date)
        this.fail(
          null,
          "Freeze horizon must be inside the program date range.",
        );
      await this.db
        .from("production_programs")
        .update({
          frozen_by: userId,
          frozen_at: now,
          freeze_horizon_date: horizon,
          updated_at: now,
        })
        .eq("tenant_id", tenantId)
        .eq("id", programId);
      await this.db
        .from("production_build_waves")
        .update({ status: "FROZEN" })
        .eq("tenant_id", tenantId)
        .eq("program_id", programId)
        .lte("required_by", horizon)
        .eq("status", "PLANNED");
    }
    if (action === "UNFREEZE") {
      if (!p.frozen_at) this.fail(null, "The plan is not frozen.");
      if (String(p.frozen_by) === String(userId))
        this.fail(
          null,
          "Maker-checker control: the user who froze the plan cannot unfreeze it.",
        );
      await this.db
        .from("production_programs")
        .update({
          frozen_by: null,
          frozen_at: null,
          freeze_horizon_date: null,
          updated_at: now,
        })
        .eq("tenant_id", tenantId)
        .eq("id", programId);
      await this.db
        .from("production_build_waves")
        .update({ status: "PLANNED" })
        .eq("tenant_id", tenantId)
        .eq("program_id", programId)
        .eq("status", "FROZEN");
    }
    const mapped: any = {
        SUBMIT: "SUBMITTED",
        APPROVE: "APPROVED",
        REJECT: "REJECTED",
        FREEZE: "FROZEN",
        UNFREEZE: "UNFROZEN",
      },
      logged = await this.db.from("production_plan_actions").insert({
        tenant_id: tenantId,
        program_id: programId,
        run_id: detail.run?.id || null,
        action: mapped[action],
        action_by: userId,
        reason: reason || null,
        evidence_hash: detail.run?.evidence_hash || null,
      });
    if (logged.error)
      this.fail(logged.error, "Unable to record the production-plan action.");
    return this.detail(tenantId, programId);
  }

  async setAutoReplan(tenantId: string, programId: string, b: any) {
    const enabled = Boolean(b?.enabled),
      minutes = Math.min(
        10080,
        Math.max(15, Math.round(this.n(b?.interval_minutes || 60))),
      ),
      updated = await this.db
        .from("production_programs")
        .update({
          auto_replan_enabled: enabled,
          replan_interval_minutes: minutes,
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", tenantId)
        .eq("id", programId)
        .select()
        .single();
    if (updated.error)
      this.fail(updated.error, "Unable to update automatic replanning.");
    return updated.data;
  }

  async simulateScenario(tenantId: string, programId: string, b: any) {
    const detail = await this.detail(tenantId, programId);
    if (!detail.run)
      this.fail(null, "Run the production plan before testing a scenario.");
    const bounded = (value: any, maximum: number, label: string) => {
      const parsed = this.n(value);
      if (parsed < 0 || parsed > maximum)
        this.fail(null, `${label} must be between 0 and ${maximum}.`);
      return parsed;
    };
    const criticalMaterials = (detail.materials || []).filter(
      (line: any) =>
        ["HIGH", "CRITICAL"].includes(String(line.shortage_risk)) &&
        this.n(line.net_requirement) > 0,
    ).length;
    const changes = {
      overtimeMinutes: bounded(b?.overtime_minutes, 10080, "Overtime minutes"),
      alternateCapacityMinutes: bounded(
        b?.alternate_capacity_minutes,
        10080,
        "Alternate capacity minutes",
      ),
      supplierAccelerationDays: bounded(
        b?.supplier_acceleration_days,
        60,
        "Supplier acceleration days",
      ),
      additionalBudget: bounded(
        b?.additional_budget,
        1000000000000,
        "Additional budget",
      ),
      dueDateExtensionDays: bounded(
        b?.due_date_extension_days,
        365,
        "Due-date extension days",
      ),
    };
    const result = simulatePlanningScenario(
      {
        dueDate: String(detail.program.due_date).slice(0, 10),
        projectedCompletionDate: String(
          detail.run.projected_completion_date || detail.program.due_date,
        ).slice(0, 10),
        requiredOvertimeMinutes: this.n(detail.run.required_overtime_minutes),
        deliveryConfidencePct: this.n(detail.run.delivery_confidence_pct),
        materialCashRequired: this.n(detail.run.material_cash_required),
        cashBudget: detail.program.cash_budget,
        criticalMaterialCount: criticalMaterials,
        defaultDailyMinutes: this.n(
          detail.program.assumptions?.default_daily_minutes || 480,
        ),
      },
      changes,
    );
    return {
      ...result,
      base: {
        due_date: detail.program.due_date,
        projected_completion_date: detail.run.projected_completion_date,
        confidence_pct: detail.run.delivery_confidence_pct,
        capacity_shortage_minutes: detail.run.required_overtime_minutes,
        material_cash_required: detail.run.material_cash_required,
      },
      assumptions: {
        overtime_minutes: changes.overtimeMinutes,
        alternate_capacity_minutes: changes.alternateCapacityMinutes,
        supplier_acceleration_days: changes.supplierAccelerationDays,
        additional_budget: changes.additionalBudget,
        due_date_extension_days: changes.dueDateExtensionDays,
      },
      warnings: [
        "This is a read-only estimate based on the latest planning run; it does not reserve capacity, commit a supplier or change a customer promise.",
        criticalMaterials
          ? `${criticalMaterials} critical material line(s) remain subject to supplier confirmation.`
          : "No critical material shortage is present in the latest run.",
      ],
      control:
        "No plan, approval, purchase document, job order, shift, stock or accounting record was created or changed.",
    };
  }

  async executionVariance(tenantId: string, programId: string) {
    const detail = await this.detail(tenantId, programId);
    if (!detail.run)
      return {
        summary: {
          planned_job_orders: 0,
          linked_job_orders: 0,
          completed_job_orders: 0,
          jobs_at_risk: 0,
          planned_quantity: 0,
          completed_quantity: 0,
          rejected_quantity: 0,
          on_time_completion_pct: 0,
        },
        rows: [],
        generated_at: new Date().toISOString(),
        control:
          "Run and release a plan before execution variance is available.",
      };
    const conversions = (detail.execution_conversions || []).filter(
      (row: any) => String(row.run_id) === String(detail.run.id),
    );
    const jobIds = [
      ...new Set(
        conversions.map((row: any) => row.job_order_id).filter(Boolean),
      ),
    ];
    const [jobResult, materialResult] = await Promise.all([
      jobIds.length
        ? this.db
            .from("production_job_orders")
            .select(
              "id,job_order_number,item_id,item_code,item_name,quantity,completed_quantity,rejected_quantity,status,start_date,end_date,actual_start_date,actual_end_date,updated_at",
            )
            .eq("tenant_id", tenantId)
            .in("id", jobIds)
        : Promise.resolve({ data: [], error: null } as any),
      jobIds.length
        ? this.db
            .from("job_order_materials")
            .select(
              "id,job_order_id,item_id,item_code,item_name,required_quantity,issued_quantity,returned_quantity,status,updated_at",
            )
            .in("job_order_id", jobIds)
        : Promise.resolve({ data: [], error: null } as any),
    ]);
    if (jobResult.error)
      this.fail(jobResult.error, "Unable to load linked job-order execution.");
    if (materialResult.error)
      this.fail(
        materialResult.error,
        "Unable to load linked job-order material evidence.",
      );
    const snapshot = buildExecutionVarianceSnapshot({
      conversions,
      jobs: jobResult.data || [],
      materials: materialResult.data || [],
      stages: detail.stages || [],
      today: new Date().toISOString().slice(0, 10),
    });
    return {
      ...snapshot,
      run_id: detail.run.id,
      program_id: detail.program.id,
      generated_at: new Date().toISOString(),
      control:
        "Read-only plan-versus-actual evidence. Material figures are net issued quantities, not assumed consumption; no job, stock, QC or accounting record was changed.",
    };
  }

  async createDraftJobOrders(
    tenantId: string,
    userId: string,
    programId: string,
    b: any,
  ) {
    if (b?.confirm !== true)
      this.fail(
        null,
        "Explicit confirmation is required to create draft job orders.",
      );
    const detail = await this.detail(tenantId, programId);
    if (!detail.program.approved_at || !detail.program.frozen_at)
      this.fail(
        null,
        "Approve and freeze the current plan before creating job orders.",
      );
    const stale = await this.staleness(tenantId, programId);
    if (stale.stale)
      this.fail(
        null,
        "Source data changed. Replan and reapprove before execution.",
      );
    const unique = new Map<string, any>();
    for (const stage of detail.stages || []) {
      if (!stage.bom_id || !stage.item_id) continue;
      const key = `${stage.wave_id}|${stage.bom_id}`,
        old = unique.get(key);
      if (!old || String(stage.planned_start) < String(old.planned_start))
        unique.set(key, stage);
    }
    const created: any[] = [];
    for (const stage of unique.values()) {
      const key = `${detail.run.id}:${stage.wave_id}:${stage.bom_id}`;
      let row = (
        await this.db
          .from("production_execution_conversions")
          .select("*")
          .eq("tenant_id", tenantId)
          .eq("run_id", detail.run.id)
          .eq("wave_id", stage.wave_id)
          .eq("bom_id", stage.bom_id)
          .maybeSingle()
      ).data;
      if (row?.status === "DRAFT_CREATED") {
        created.push(row);
        continue;
      }
      if (!row) {
        const x = await this.db
          .from("production_execution_conversions")
          .insert({
            tenant_id: tenantId,
            program_id: programId,
            run_id: detail.run.id,
            wave_id: stage.wave_id,
            item_id: stage.item_id,
            bom_id: stage.bom_id,
            bom_level: stage.bom_level,
            idempotency_key: key,
            status: "CREATING",
            created_by: userId,
          })
          .select()
          .single();
        if (x.error)
          this.fail(x.error, "Unable to reserve job-order conversion.");
        row = x.data;
      } else
        await this.db
          .from("production_execution_conversions")
          .update({ status: "CREATING", updated_at: new Date().toISOString() })
          .eq("tenant_id", tenantId)
          .eq("id", row.id);
      try {
        const jo: any = await this.jobOrders.createFromBOM(
          tenantId,
          userId,
          stage.item_id,
          stage.bom_id,
          this.n(stage.quantity),
          String(stage.planned_start).slice(0, 10),
          { autoIssueMaterials: false, autoRepair: false },
        );
        const updated = await this.db
          .from("production_execution_conversions")
          .update({
            status: "DRAFT_CREATED",
            job_order_id: jo.id,
            job_order_number: jo.job_order_number,
            updated_at: new Date().toISOString(),
          })
          .eq("tenant_id", tenantId)
          .eq("id", row.id)
          .select()
          .single();
        if (updated.error)
          this.fail(
            updated.error,
            "Draft job order was created but its planning link could not be saved.",
          );
        created.push(updated.data);
      } catch (e) {
        await this.db
          .from("production_execution_conversions")
          .update({ status: "FAILED", updated_at: new Date().toISOString() })
          .eq("tenant_id", tenantId)
          .eq("id", row.id);
        throw e;
      }
    }
    return {
      status: "DRAFTS_CREATED",
      count: created.length,
      job_orders: created,
      control:
        "Draft job orders only. Material issue, production completion and financial posting remain separate governed actions.",
    };
  }

  async createDraftShiftProposals(
    tenantId: string,
    userId: string,
    programId: string,
    b: any,
  ) {
    if (b?.confirm !== true)
      this.fail(
        null,
        "Explicit confirmation is required to create draft shift proposals.",
      );
    const detail = await this.detail(tenantId, programId);
    if (!detail.program.approved_at || !detail.program.frozen_at)
      this.fail(
        null,
        "Approve and freeze the current plan before creating shift proposals.",
      );
    const stale = await this.staleness(tenantId, programId);
    if (stale.stale)
      this.fail(
        null,
        "Source data changed. Replan and reapprove before shift release.",
      );
    const grouped = new Map<string, any>();
    for (const stage of detail.stages || []) {
      if (!stage.work_station_id) continue;
      const date = String(stage.planned_start).slice(0, 10);
      if (date > String(detail.program.freeze_horizon_date)) continue;
      const key = `${stage.work_station_id}|${date}`,
        old = grouped.get(key) || {
          tenant_id: tenantId,
          program_id: programId,
          run_id: detail.run.id,
          work_station_id: stage.work_station_id,
          work_date: date,
          shift_code: "APS-DRAFT",
          planned_production_minutes: 0,
          status: "DRAFT",
          created_by: userId,
        };
      old.planned_production_minutes += Math.max(
        1,
        Math.ceil(this.n(stage.required_capacity_minutes)),
      );
      grouped.set(key, old);
    }
    const rows = [...grouped.values()].map((x) => ({
      ...x,
      planned_production_minutes: Math.min(1440, x.planned_production_minutes),
      evidence_hash: createHash("sha256")
        .update(
          JSON.stringify({
            run_id: x.run_id,
            station: x.work_station_id,
            date: x.work_date,
            minutes: x.planned_production_minutes,
          }),
        )
        .digest("hex"),
      updated_at: new Date().toISOString(),
    }));
    if (!rows.length)
      return {
        status: "NO_FROZEN_STAGES",
        count: 0,
        shift_proposals: [],
        control:
          "No stage inside the freeze horizon required a shift proposal.",
      };
    const saved = await this.db
      .from("production_shift_proposals")
      .upsert(rows, {
        onConflict: "tenant_id,run_id,work_station_id,work_date",
      })
      .select();
    if (saved.error)
      this.fail(saved.error, "Unable to create draft shift proposals.");
    return {
      status: "DRAFTS_CREATED",
      count: (saved.data || []).length,
      shift_proposals: saved.data || [],
      control:
        "Draft shift proposals only. A supervisor must approve and publish the operating shift separately.",
    };
  }

  async publishShiftProposals(
    tenantId: string,
    userId: string,
    programId: string,
    b: any,
  ) {
    if (b?.confirm !== true)
      this.fail(
        null,
        "Explicit confirmation is required to publish shift proposals.",
      );
    const detail = await this.detail(tenantId, programId);
    if (!detail.program.approved_at || !detail.program.frozen_at)
      this.fail(null, "Approve and freeze the plan before publishing shifts.");
    const stale = await this.staleness(tenantId, programId);
    if (stale.stale)
      this.fail(
        null,
        "Source data changed. Replan and reapprove before shift publication.",
      );
    const proposals = (detail.shift_proposals || []).filter(
      (x: any) => x.status === "DRAFT",
    );
    if (!proposals.length)
      return { status: "NOTHING_TO_PUBLISH", count: 0, shifts: [] };
    if (proposals.some((x: any) => String(x.created_by) === String(userId)))
      this.fail(
        null,
        "Maker-checker control: the user who created a shift proposal cannot publish it.",
      );
    const published: any[] = [];
    for (const proposal of proposals) {
      const matching = (detail.stages || []).filter(
          (x: any) =>
            String(x.work_station_id) === String(proposal.work_station_id) &&
            String(x.planned_start).slice(0, 10) === String(proposal.work_date),
        ),
        quantity = matching.reduce(
          (s: number, x: any) => s + this.n(x.quantity),
          0,
        ),
        run = matching.reduce(
          (s: number, x: any) => s + this.n(x.run_minutes),
          0,
        ),
        ideal = Math.max(0.0001, quantity > 0 ? run / quantity : 1),
        shift = await this.db
          .from("manufacturing_shift_plans")
          .upsert(
            {
              tenant_id: tenantId,
              work_station_id: proposal.work_station_id,
              work_date: proposal.work_date,
              shift_code: "APS-PUBLISHED",
              planned_production_minutes: proposal.planned_production_minutes,
              ideal_cycle_minutes: Number(ideal.toFixed(4)),
              operating_cost_per_hour: this.n(
                detail.program.assumptions?.overtime_cost_per_hour,
              ),
              scrap_unit_cost: 0,
              created_by: proposal.created_by,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "tenant_id,work_station_id,work_date" },
          )
          .select()
          .single();
      if (shift.error)
        this.fail(
          shift.error,
          "Unable to publish an approved production shift.",
        );
      const approved = await this.db
        .from("production_shift_proposals")
        .update({
          status: "APPROVED",
          approved_by: userId,
          approved_at: new Date().toISOString(),
          published_shift_id: shift.data.id,
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", tenantId)
        .eq("id", proposal.id)
        .eq("status", "DRAFT")
        .select()
        .single();
      if (approved.error)
        this.fail(
          approved.error,
          "Shift was published but its approval evidence could not be saved.",
        );
      published.push({ ...shift.data, proposal_id: proposal.id });
    }
    return {
      status: "PUBLISHED",
      count: published.length,
      shifts: published,
      control:
        "Published operating shifts remain editable only through the governed shift-performance workflow.",
    };
  }

  async controlTower(tenantId: string) {
    const dashboard = await this.dashboard(tenantId);
    const latestRunIds = dashboard.programs
      .map((program: any) => program.latest_run?.id)
      .filter(Boolean);
    const conversionResult = latestRunIds.length
      ? await this.db
          .from("production_execution_conversions")
          .select("*")
          .eq("tenant_id", tenantId)
          .in("run_id", latestRunIds)
          .limit(5000)
      : ({ data: [], error: null } as any);
    if (conversionResult.error)
      this.fail(
        conversionResult.error,
        "Unable to load production execution links.",
      );
    const conversions = conversionResult.data || [];
    const jobIds = [
      ...new Set(
        conversions.map((row: any) => row.job_order_id).filter(Boolean),
      ),
    ];
    const [stageResult, jobResult, materialResult] = await Promise.all([
      latestRunIds.length
        ? this.db
            .from("production_stage_plan_lines")
            .select(
              "id,run_id,wave_id,bom_id,quantity,required_capacity_minutes,planned_start,planned_end",
            )
            .eq("tenant_id", tenantId)
            .in("run_id", latestRunIds)
            .limit(10000)
        : Promise.resolve({ data: [], error: null } as any),
      jobIds.length
        ? this.db
            .from("production_job_orders")
            .select(
              "id,job_order_number,quantity,completed_quantity,rejected_quantity,status,actual_start_date,actual_end_date",
            )
            .eq("tenant_id", tenantId)
            .in("id", jobIds)
        : Promise.resolve({ data: [], error: null } as any),
      jobIds.length
        ? this.db
            .from("job_order_materials")
            .select(
              "job_order_id,required_quantity,issued_quantity,returned_quantity",
            )
            .in("job_order_id", jobIds)
            .limit(20000)
        : Promise.resolve({ data: [], error: null } as any),
    ]);
    const evidenceError =
      stageResult.error || jobResult.error || materialResult.error;
    if (evidenceError)
      this.fail(evidenceError, "Unable to build execution variance evidence.");
    const stagesByRun = new Map<string, any[]>();
    for (const stage of stageResult.data || []) {
      const id = String(stage.run_id);
      stagesByRun.set(id, [...(stagesByRun.get(id) || []), stage]);
    }
    const conversionsByRun = new Map<string, any[]>();
    for (const conversion of conversions) {
      const id = String(conversion.run_id);
      conversionsByRun.set(id, [
        ...(conversionsByRun.get(id) || []),
        conversion,
      ]);
    }
    const today = new Date().toISOString().slice(0, 10);
    const rows = dashboard.programs
      .filter((p: any) => !["CLOSED", "CANCELLED"].includes(String(p.status)))
      .map((p: any) => {
        const r = p.latest_run || {};
        const alternatives = r.explanation?.alternatives || [];
        const execution = r.id
          ? buildExecutionVarianceSnapshot({
              conversions: conversionsByRun.get(String(r.id)) || [],
              jobs: jobResult.data || [],
              materials: materialResult.data || [],
              stages: stagesByRun.get(String(r.id)) || [],
              today,
            }).summary
          : {
              planned_job_orders: 0,
              linked_job_orders: 0,
              completed_job_orders: 0,
              jobs_at_risk: 0,
              planned_quantity: 0,
              completed_quantity: 0,
              rejected_quantity: 0,
              on_time_completion_pct: 0,
            };
        return {
          program_id: p.id,
          program_code: p.program_code,
          program_name: p.program_name,
          status: p.status,
          target_quantity: p.target_quantity,
          due_date: p.due_date,
          latest_run_id: r.id || null,
          feasible: r.feasible ?? null,
          confidence_pct: r.delivery_confidence_pct ?? null,
          projected_completion_date: r.projected_completion_date || null,
          bottleneck: r.explanation?.bottleneck_stage || null,
          critical_materials: r.explanation?.critical_materials || 0,
          required_overtime_minutes: r.required_overtime_minutes || 0,
          material_cash_required: r.material_cash_required || 0,
          excess_wip_cash_risk: r.excess_wip_cash_risk || 0,
          recommended_recovery:
            alternatives.find((x: any) => x.recommended) || null,
          approved: !!p.approved_at,
          frozen: !!p.frozen_at,
          auto_replan_enabled: !!p.auto_replan_enabled,
          execution,
        };
      });
    const actionQueue = buildProductionTransformationQueue(rows);
    return {
      summary: {
        programs: rows.length,
        at_risk: rows.filter((x: any) => x.feasible === false).length,
        critical_materials: rows.reduce(
          (s: number, x: any) => s + this.n(x.critical_materials),
          0,
        ),
        cash_required: Number(
          rows
            .reduce(
              (s: number, x: any) => s + this.n(x.material_cash_required),
              0,
            )
            .toFixed(2),
        ),
        frozen: rows.filter((x: any) => x.frozen).length,
        execution_jobs_at_risk: rows.reduce(
          (sum: number, row: any) => sum + this.n(row.execution?.jobs_at_risk),
          0,
        ),
        completed_job_orders: rows.reduce(
          (sum: number, row: any) =>
            sum + this.n(row.execution?.completed_job_orders),
          0,
        ),
        rejected_quantity: Number(
          rows
            .reduce(
              (sum: number, row: any) =>
                sum + this.n(row.execution?.rejected_quantity),
              0,
            )
            .toFixed(4),
        ),
        action_count: actionQueue.length,
      },
      programs: rows,
      action_queue: actionQueue.slice(0, 100),
      generated_at: new Date().toISOString(),
      control:
        "Deterministic, read-only management evidence. Actions open governed source workflows; this cockpit does not create, approve, post or modify operational records.",
    };
  }

  async processAutomaticReplans() {
    const programs = await this.db
      .from("production_programs")
      .select("*")
      .eq("auto_replan_enabled", true)
      .in("status", ["PLANNED", "APPROVED"]);
    if (programs.error)
      return { evaluated: 0, replanned: 0, error: programs.error.message };
    let replanned = 0;
    for (const p of programs.data || []) {
      if (p.frozen_at) continue;
      try {
        const stale = await this.staleness(String(p.tenant_id), String(p.id));
        if (!stale.stale) continue;
        const pending = await this.db
          .from("production_replan_queue")
          .select("id")
          .eq("tenant_id", p.tenant_id)
          .eq("program_id", p.id)
          .in("status", ["PENDING", "RUNNING"])
          .maybeSingle();
        if (pending.data) continue;
        const q = await this.db
          .from("production_replan_queue")
          .insert({
            tenant_id: p.tenant_id,
            program_id: p.id,
            source_run_id: null,
            reason: stale.reason,
            source_state_hash: stale.current_hash,
            status: "RUNNING",
            requested_by: p.created_by,
          })
          .select()
          .single();
        if (q.error) continue;
        const result: any = await this.run(
          String(p.tenant_id),
          String(p.created_by),
          String(p.id),
        );
        await this.db
          .from("production_replan_queue")
          .update({
            status: "COMPLETED",
            completed_at: new Date().toISOString(),
            resulting_run_id: result.run?.id,
          })
          .eq("id", q.data.id);
        await this.db.from("production_plan_actions").insert({
          tenant_id: p.tenant_id,
          program_id: p.id,
          run_id: result.run?.id,
          action: "REPLAN_COMPLETED",
          action_by: p.created_by,
          evidence_hash: result.run?.evidence_hash,
        });
        replanned++;
      } catch {
        continue;
      }
    }
    return { evaluated: (programs.data || []).length, replanned };
  }

  async detail(tenantId: string, programId: string, runId?: string) {
    const { data: program, error } = await this.db
      .from("production_programs")
      .select("*,waves:production_build_waves(*)")
      .eq("tenant_id", tenantId)
      .eq("id", programId)
      .maybeSingle();
    if (error || !program)
      throw new NotFoundException("Production program not found.");
    const itemResult = await this.db
      .from("items")
      .select("id,code,name,uom")
      .eq("tenant_id", tenantId)
      .eq("id", program.finished_item_id)
      .maybeSingle();
    if (itemResult.error)
      this.fail(itemResult.error, "Unable to load finished item.");
    program.finished_item = itemResult.data || null;
    let q = this.db
      .from("production_planning_runs")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("program_id", programId);
    q = runId
      ? q.eq("id", runId)
      : q.order("created_at", { ascending: false }).limit(1);
    const { data: runs, error: re } = await q;
    if (re) this.fail(re, "Unable to load production plan.");
    const run = Array.isArray(runs) ? runs[0] : runs;
    if (!run)
      return {
        program,
        run: null,
        stages: [],
        materials: [],
        actions: [],
        execution_conversions: [],
        shift_proposals: [],
      };
    const [
      { data: stages, error: se },
      { data: materials, error: me },
      { data: actions },
      { data: conversions },
      { data: shiftProposals },
    ] = await Promise.all([
      this.db
        .from("production_stage_plan_lines")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("run_id", run.id)
        .order("planned_start"),
      this.db
        .from("production_material_plan_lines")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("run_id", run.id)
        .order("required_by"),
      this.db
        .from("production_plan_actions")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("program_id", programId)
        .order("created_at", { ascending: false }),
      this.db
        .from("production_execution_conversions")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("program_id", programId)
        .order("created_at", { ascending: false }),
      this.db
        .from("production_shift_proposals")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("program_id", programId)
        .order("work_date"),
    ]);
    if (se) this.fail(se, "Unable to load stage plan.");
    if (me) this.fail(me, "Unable to load material plan.");
    const stationIds = [
      ...new Set(
        (stages || []).map((x: any) => x.work_station_id).filter(Boolean),
      ),
    ];
    const stationResult = stationIds.length
      ? await this.db
          .from("work_stations")
          .select("id,station_code,station_name")
          .eq("tenant_id", tenantId)
          .in("id", stationIds)
      : ({ data: [], error: null } as any);
    if (stationResult.error)
      this.fail(stationResult.error, "Unable to load work stations.");
    const stationMap = new Map(
      (stationResult.data || []).map((x: any) => [String(x.id), x]),
    );
    return {
      program,
      run,
      stages: (stages || []).map((x: any) => ({
        ...x,
        station: stationMap.get(String(x.work_station_id)) || null,
      })),
      materials: materials || [],
      actions: actions || [],
      execution_conversions: conversions || [],
      shift_proposals: shiftProposals || [],
    };
  }
}
