import { BadRequestException, Injectable } from "@nestjs/common";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { MrpExceptionService } from "./mrp-exception.service";
import { evaluateProductionFormula, roundProductionFormula } from "../production/services/production-formula-engine";
import { scaleBomLineQuantity } from "../production/services/bom-quantity-basis";

type MrpSupplySource = "OPEN_PO" | "OPEN_BUILD" | "OPEN_PR" | "DRAFT_PO";
type MrpSupplyReceipt = {
  quantity: number;
  date: string | null;
  source?: MrpSupplySource;
  document_type:
    | "PURCHASE_ORDER"
    | "PURCHASE_REQUISITION"
    | "PRODUCTION_JOB_ORDER";
  document_id: string;
  document_number: string;
  document_line_id: string | null;
  status: string;
};

@Injectable()
export class MrpService {
  private readonly supabase: SupabaseClient = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!,
  );

  constructor(private readonly exceptions: MrpExceptionService) {}

  private salesOrderUncoveredQuantity(
    line: any,
    jobOrders: any[],
    programs: any[],
  ) {
    const open = Math.max(
      0,
      Number(line?.quantity || 0) - Number(line?.dispatched_quantity || 0),
    );
    const linkedJobQuantity = (jobOrders || [])
      .filter(
        (order) =>
          String(order.sales_order_item_id || "") === String(line?.id || ""),
      )
      .reduce((sum, order) => sum + Number(order.quantity || 0), 0);
    const linkedProgramQuantity = (programs || [])
      .filter(
        (program) =>
          String(program.sales_order_item_id || "") === String(line?.id || ""),
      )
      .reduce((sum, program) => sum + Number(program.target_quantity || 0), 0);

    // Programs can create the linked job orders, so these are alternative forms
    // of coverage. Adding both would hide genuinely uncovered customer demand.
    const covered = Math.max(linkedJobQuantity, linkedProgramQuantity);
    return Number(Math.max(0, open - covered).toFixed(4));
  }

  private monthEnd(month: any) {
    const text = String(month || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(text)) return null;
    const [year, monthNumber] = text.split("-").map(Number);
    const date = new Date(Date.UTC(year, monthNumber, 0));
    return Number.isFinite(date.getTime())
      ? date.toISOString().slice(0, 10)
      : null;
  }

  private consumeApprovedForecast(
    forecastLines: any[],
    salesDemands: any[],
    cycle: any,
    asOfDate = new Date().toISOString().slice(0, 10),
  ) {
    const datedSales = new Map<string, number>();
    const undatedSales = new Map<string, number>();
    for (const demand of salesDemands || []) {
      const itemId = String(demand?.line?.item_id || "");
      const quantity = Math.max(0, Number(demand?.open_quantity || 0));
      if (!itemId || quantity <= 0) continue;
      const month = String(demand?.due_date || "").slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(month)) {
        const key = `${itemId}|${month}`;
        datedSales.set(key, (datedSales.get(key) || 0) + quantity);
      } else {
        undatedSales.set(itemId, (undatedSales.get(itemId) || 0) + quantity);
      }
    }

    const residuals: any[] = [];
    for (const line of forecastLines || []) {
      const itemId = String(line.item_id || "");
      if (!itemId) continue;
      let undatedRemaining = undatedSales.get(itemId) || 0;
      const buckets = Array.isArray(line.consensus_forecast)
        ? [...line.consensus_forecast].sort((a: any, b: any) =>
            String(a?.month || "").localeCompare(String(b?.month || "")),
          )
        : [];
      for (const bucket of buckets) {
        const month = String(bucket?.month || "").slice(0, 7);
        const dueDate = this.monthEnd(month);
        const forecastQuantity = Math.max(0, Number(bucket?.quantity || 0));
        if (!dueDate || dueDate < asOfDate || forecastQuantity <= 0) continue;
        const datedQuantity = Math.max(
          0,
          Number(datedSales.get(`${itemId}|${month}`) || 0),
        );
        const datedConsumed = Math.min(forecastQuantity, datedQuantity);
        const afterDated = forecastQuantity - datedConsumed;
        const undatedConsumed = Math.min(afterDated, undatedRemaining);
        undatedRemaining = Number(
          Math.max(0, undatedRemaining - undatedConsumed).toFixed(4),
        );
        const consumed = Number((datedConsumed + undatedConsumed).toFixed(4));
        const residual = Number(
          Math.max(0, forecastQuantity - consumed).toFixed(4),
        );
        residuals.push({
          item_id: itemId,
          required_quantity: residual,
          due_date: dueDate,
          demand_plan_cycle_id: cycle?.id || line.cycle_id || null,
          demand_plan_cycle_name: cycle?.cycle_name || null,
          demand_plan_line_id: line.id || null,
          forecast_month: month,
          forecast_quantity: Number(forecastQuantity.toFixed(4)),
          sales_consumed_quantity: consumed,
          residual_forecast_quantity: residual,
          forecast_accuracy_pct:
            line.forecast_accuracy_pct == null
              ? null
              : Number(line.forecast_accuracy_pct),
        });
      }
    }
    return residuals;
  }

  private reservationPosition(
    itemId: string,
    inventoryRows: any[],
    entryAvailableQuantity: number,
    reservations: any[],
    inScopeReferenceIds: Set<string>,
    asOfDate = new Date().toISOString(),
  ) {
    const itemInventory = (inventoryRows || []).filter(
      (row: any) => String(row.item_id || "") === itemId,
    );
    const activeReservations = (reservations || []).filter((row: any) => {
      if (String(row.item_id || "") !== itemId || row.released === true)
        return false;
      const expiresAt = String(row.expires_at || "");
      return !expiresAt || expiresAt > asOfDate;
    });
    const physicalQuantity = itemInventory.length
      ? itemInventory.reduce(
          (sum: number, row: any) => sum + Number(row.quantity || 0),
          0,
        )
      : Math.max(0, Number(entryAvailableQuantity || 0));
    const ledgerReservedQuantity = itemInventory.reduce(
      (sum: number, row: any) => sum + Number(row.reserved_quantity || 0),
      0,
    );
    const unreservedQuantity = itemInventory.length
      ? itemInventory.reduce(
          (sum: number, row: any) =>
            sum +
            Number(
              row.available_quantity ??
                Math.max(
                  0,
                  Number(row.quantity || 0) -
                    Number(row.reserved_quantity || 0),
                ),
            ),
          0,
        )
      : Math.max(
          0,
          physicalQuantity -
            activeReservations.reduce(
              (sum: number, row: any) =>
                sum + Number(row.reserved_quantity || 0),
              0,
            ),
        );
    const reservedForPlan = activeReservations
      .filter((row: any) =>
        inScopeReferenceIds.has(String(row.reference_id || "")),
      )
      .reduce(
        (sum: number, row: any) => sum + Number(row.reserved_quantity || 0),
        0,
      );
    const activeReservedQuantity = activeReservations.reduce(
      (sum: number, row: any) => sum + Number(row.reserved_quantity || 0),
      0,
    );
    const reservedElsewhere = Math.max(
      0,
      activeReservedQuantity - reservedForPlan,
    );
    const usableQuantity = itemInventory.length
      ? unreservedQuantity + reservedForPlan
      : Math.max(0, physicalQuantity - reservedElsewhere);
    const mismatchQuantity = itemInventory.length
      ? Math.abs(ledgerReservedQuantity - activeReservedQuantity)
      : 0;
    return {
      physical_quantity: Number(physicalQuantity.toFixed(4)),
      unreserved_quantity: Number(unreservedQuantity.toFixed(4)),
      usable_quantity: Number(usableQuantity.toFixed(4)),
      ledger_reserved_quantity: Number(ledgerReservedQuantity.toFixed(4)),
      active_reserved_quantity: Number(activeReservedQuantity.toFixed(4)),
      reserved_for_plan_quantity: Number(reservedForPlan.toFixed(4)),
      reserved_elsewhere_quantity: Number(reservedElsewhere.toFixed(4)),
      reservation_mismatch_quantity: Number(mismatchQuantity.toFixed(4)),
      reservation_evidence: activeReservations.map((row: any) => ({
        reservation_id: row.id,
        warehouse_id: row.warehouse_id,
        reference_type: row.reference_type,
        reference_id: row.reference_id,
        reference_number: row.reference_number,
        reserved_quantity: Number(row.reserved_quantity || 0),
        expires_at: row.expires_at || null,
        allocation: inScopeReferenceIds.has(String(row.reference_id || ""))
          ? "CURRENT_PLAN"
          : "OTHER_DEMAND",
      })),
    };
  }

  private safetyStockPosition(
    policy: any,
    grossRequirement: number,
    leadTimeDays: number,
    forecastAccuracyValues: number[],
  ) {
    const method = String(
      policy?.safety_stock_method || "PERCENT",
    ).toUpperCase();
    const value = Math.max(0, Number(policy?.safety_stock_value || 0));
    const minimumStock = Math.max(0, Number(policy?.minimum_stock || 0));
    const validAccuracy = (forecastAccuracyValues || []).filter(
      (accuracy) =>
        Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= 100,
    );
    const forecastAccuracy = validAccuracy.length
      ? validAccuracy.reduce((sum, accuracy) => sum + accuracy, 0) /
        validAccuracy.length
      : null;
    let calculated = 0;
    let explanation = "No safety-stock allowance configured.";
    if (method === "FIXED") {
      calculated = value;
      explanation = `Fixed safety stock of ${value}.`;
    } else if (method === "SERVICE_LEVEL") {
      const target = value > 0 ? Math.min(99.9, Math.max(50, value)) : 95;
      const z =
        target >= 99
          ? 2.33
          : target >= 98
            ? 2.05
            : target >= 95
              ? 1.65
              : target >= 90
                ? 1.28
                : 0.84;
      const errorRate =
        forecastAccuracy == null
          ? 0.2
          : Math.max(0.05, (100 - forecastAccuracy) / 100);
      const leadFactor = Math.sqrt(Math.max(1, leadTimeDays) / 30);
      calculated = grossRequirement * errorRate * z * leadFactor;
      explanation = `${target}% service-level buffer using ${forecastAccuracy == null ? "20% default forecast error" : `${forecastAccuracy.toFixed(1)}% forecast accuracy`} and ${leadTimeDays}-day lead time.`;
    } else {
      calculated = (grossRequirement * value) / 100;
      explanation = `${value}% of gross requirement.`;
    }
    const protectedQuantity = Math.max(calculated, minimumStock);
    return {
      method,
      configured_value: value,
      minimum_stock_quantity: Number(minimumStock.toFixed(4)),
      calculated_quantity: Number(calculated.toFixed(4)),
      protected_quantity: Number(protectedQuantity.toFixed(4)),
      forecast_accuracy_pct:
        forecastAccuracy == null ? null : Number(forecastAccuracy.toFixed(2)),
      explanation,
    };
  }

  private substitutionCandidates(
    policy: any,
    shortageQuantity: number,
    alternateItems: Map<string, any>,
    alternateAvailability: Map<string, number>,
  ) {
    const alternateIds = Array.isArray(policy?.alternate_item_ids)
      ? policy.alternate_item_ids.map(String)
      : [];
    return alternateIds
      .map((itemId: string) => {
        const item = alternateItems.get(itemId);
        const available = Math.max(
          0,
          Number(alternateAvailability.get(itemId) || 0),
        );
        if (!item || available <= 0) return null;
        return {
          item_id: itemId,
          item_code: item.code || null,
          item_name: item.name || null,
          available_quantity: Number(available.toFixed(4)),
          coverage_quantity: Number(
            Math.min(available, Math.max(0, shortageQuantity)).toFixed(4),
          ),
          coverage_status: available >= shortageQuantity ? "FULL" : "PARTIAL",
          lead_time_days: Math.max(0, Number(item.lead_time_days || 0)),
          approval_required: policy?.substitution_approval_required !== false,
        };
      })
      .filter(Boolean)
      .sort(
        (a: any, b: any) =>
          b.coverage_quantity - a.coverage_quantity ||
          a.lead_time_days - b.lead_time_days,
      );
  }

  private effectiveBomRevisions(rows: any[], asOfDate: string) {
    const eligible = (rows || []).filter((row: any) => {
      const effectiveFrom = String(row.effective_from || "").slice(0, 10);
      const effectiveTo = String(row.effective_to || "").slice(0, 10);
      return (
        row.is_active === true &&
        String(row.lifecycle_status || "").toUpperCase() === "APPROVED" &&
        (!effectiveFrom || effectiveFrom <= asOfDate) &&
        (!effectiveTo || effectiveTo >= asOfDate)
      );
    });
    eligible.sort((a: any, b: any) => {
      const versionDifference = Number(b.version || 0) - Number(a.version || 0);
      if (versionDifference) return versionDifference;
      return String(b.effective_from || "").localeCompare(
        String(a.effective_from || ""),
      );
    });
    const selectedByItem = new Map<string, any>();
    for (const row of eligible) {
      const itemId = String(row.item_id || "");
      if (itemId && !selectedByItem.has(itemId)) {
        selectedByItem.set(itemId, row);
      }
    }
    return { eligible, selectedByItem };
  }

  private assertAcyclicBomGraph(graph: Map<string, any[]>) {
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const walk = (itemId: string, path: string[]) => {
      if (visiting.has(itemId)) {
        const cycle = [...path, itemId].join(" -> ");
        throw new BadRequestException(
          `MRP cannot explode a circular BOM dependency: ${cycle}.`,
        );
      }
      if (visited.has(itemId)) return;
      visiting.add(itemId);
      for (const component of graph.get(itemId) || [])
        if (graph.has(String(component.item_id)))
          walk(String(component.item_id), [...path, itemId]);
      visiting.delete(itemId);
      visited.add(itemId);
    };
    for (const itemId of graph.keys()) walk(itemId, []);
  }

  private subtractCalendarDays(value: any, days: number) {
    const dateText = String(value || "").slice(0, 10);
    if (!dateText) return null;
    const date = new Date(`${dateText}T00:00:00Z`);
    if (!Number.isFinite(date.getTime())) return null;
    date.setUTCDate(date.getUTCDate() - Math.max(0, Number(days || 0)));
    return date.toISOString().slice(0, 10);
  }

  private addCalendarDays(value: any, days: number) {
    const dateText = String(value || "").slice(0, 10);
    if (!dateText) return null;
    const date = new Date(`${dateText}T00:00:00Z`);
    if (!Number.isFinite(date.getTime())) return null;
    date.setUTCDate(date.getUTCDate() + Math.max(0, Number(days || 0)));
    return date.toISOString().slice(0, 10);
  }

  private comparePlanningLine(current: any, previous: any, today: string) {
    const policy = current.planning_policy || {};
    const previousPolicy = previous?.planning_policy || {};
    const currentQuantity = Number(current.recommended_quantity || 0);
    const previousQuantity = Number(previous?.recommended_quantity || 0);
    const currentIntervention = String(
      policy.recommended_intervention || "MONITOR",
    );
    const previousIntervention = String(
      previousPolicy.recommended_intervention || "MONITOR",
    );
    const currentActionable =
      currentQuantity > 0 ||
      Number(policy.reschedule_quantity || 0) > 0 ||
      Number(policy.confirm_date_quantity || 0) > 0 ||
      Number(policy.unpegged_supply_quantity || 0) > 0;
    const previousActionable =
      previousQuantity > 0 ||
      Number(previousPolicy.reschedule_quantity || 0) > 0 ||
      Number(previousPolicy.confirm_date_quantity || 0) > 0 ||
      Number(previousPolicy.unpegged_supply_quantity || 0) > 0;
    const changeCodes: string[] = [];
    if (!previous) {
      changeCodes.push(
        currentActionable ? "NEW_RECOMMENDATION" : "BASELINE_RECOMMENDATION",
      );
    } else {
      const delta = Number((currentQuantity - previousQuantity).toFixed(4));
      if (previousActionable && !currentActionable)
        changeCodes.push("RECOMMENDATION_RESOLVED");
      else if (delta > 0.0001) changeCodes.push("QUANTITY_INCREASED");
      else if (delta < -0.0001) changeCodes.push("QUANTITY_DECREASED");
      const currentDate = String(current.required_by_date || "");
      const previousDate = String(previous.required_by_date || "");
      if (currentDate && previousDate && currentDate !== previousDate)
        changeCodes.push(
          currentDate < previousDate
            ? "REQUIRED_DATE_ADVANCED"
            : "REQUIRED_DATE_DEFERRED",
        );
      if (
        String(current.supply_action || "MONITOR") !==
        String(previous.supply_action || "MONITOR")
      )
        changeCodes.push("SUPPLY_ACTION_CHANGED");
      if (currentIntervention !== previousIntervention)
        changeCodes.push("INTERVENTION_CHANGED");
      if (!changeCodes.length) changeCodes.push("UNCHANGED");
    }
    const timeFenceDays = Math.max(
      7,
      Number(policy.planning_time_fence_days || current.lead_time_days || 0),
    );
    const timeFenceDate = this.addCalendarDays(today, timeFenceDays);
    const actionDate = String(
      current.release_by_date || current.required_by_date || "",
    ).slice(0, 10);
    const insideTimeFence = Boolean(
      actionDate && timeFenceDate && actionDate <= timeFenceDate,
    );
    const meaningfulChange = changeCodes.some(
      (code) => !["UNCHANGED", "BASELINE_RECOMMENDATION"].includes(code),
    );
    return {
      previous_run_id: previous?.run_id || null,
      previous_line_id: previous?.id || null,
      previous_recommended_quantity: previousQuantity,
      quantity_delta: Number((currentQuantity - previousQuantity).toFixed(4)),
      previous_required_by_date: previous?.required_by_date || null,
      previous_release_by_date: previous?.release_by_date || null,
      previous_supply_action: previous?.supply_action || null,
      previous_intervention: previous ? previousIntervention : null,
      change_codes: changeCodes,
      classification: changeCodes[0],
      planning_time_fence_days: timeFenceDays,
      planning_time_fence_date: timeFenceDate,
      action_date: actionDate || null,
      inside_time_fence: insideTimeFence,
      requires_planner_reapproval: meaningfulChange && insideTimeFence,
    };
  }

  private explodeMultiLevelDemand(
    aggregate: Map<string, any>,
    graph: Map<string, any[]>,
    calculate: (line: any) => {
      action: string;
      recommended: number;
      requiredBy?: string | null;
      releaseBy?: string | null;
      leadDays?: number;
    },
  ) {
    const explodedBuildQuantity = new Map<string, number>();
    const maxExplosionPasses = Math.max(1, aggregate.size + graph.size + 1);
    let explosionChanged = false;
    for (let pass = 0; pass < maxExplosionPasses; pass++) {
      explosionChanged = false;
      for (const [parentItemId, parentLine] of aggregate) {
        const components = graph.get(parentItemId) || [];
        if (!components.length) continue;
        const planned = calculate(parentLine);
        if (planned.action !== "BUILD" || planned.recommended <= 0) continue;
        const alreadyExploded = explodedBuildQuantity.get(parentItemId) || 0;
        const incrementalBuild = Number(
          Math.max(0, planned.recommended - alreadyExploded).toFixed(4),
        );
        if (incrementalBuild <= 0) continue;
        explodedBuildQuantity.set(parentItemId, planned.recommended);
        explosionChanged = true;

        for (const component of components) {
          const componentItemId = String(component.item_id || "");
          if (!componentItemId) continue;
          const childGross = Number(
            (
              scaleBomLineQuantity(
                component,
                incrementalBuild,
                Number(component.bom_output_quantity || 1),
              ) *
              (1 + Number(component.scrap_percentage || 0) / 100)
            ).toFixed(4),
          );
          if (childGross <= 0) continue;
          const childLine = aggregate.get(componentItemId) || {
            item_id: componentItemId,
            gross_requirement: 0,
            issued_quantity: 0,
            demand_references: [],
          };
          childLine.gross_requirement += childGross;
          const parentReferences = parentLine.demand_references || [];
          const totalReferenceQuantity = parentReferences.reduce(
            (sum: number, reference: any) =>
              sum + Math.max(0, Number(reference.required_quantity || 0)),
            0,
          );
          let allocatedChildGross = 0;
          for (let index = 0; index < parentReferences.length; index++) {
            const reference = parentReferences[index];
            const weight =
              totalReferenceQuantity > 0
                ? Math.max(0, Number(reference.required_quantity || 0)) /
                  totalReferenceQuantity
                : 1 / Math.max(1, parentReferences.length);
            const referenceQuantity =
              index === parentReferences.length - 1
                ? Number((childGross - allocatedChildGross).toFixed(4))
                : Number((childGross * weight).toFixed(4));
            allocatedChildGross += referenceQuantity;
            const referenceRequiredBy =
              reference.due_date || planned.requiredBy;
            const referenceReleaseBy =
              planned.leadDays == null
                ? planned.releaseBy || referenceRequiredBy || null
                : this.subtractCalendarDays(
                    referenceRequiredBy,
                    planned.leadDays,
                  );
            const childReference = {
              ...reference,
              required_quantity: referenceQuantity,
              parent_item_id: parentItemId,
              bom_level: Number(reference.bom_level || 0) + 1,
              bom_id: component.selected_bom_id || reference.bom_id || null,
              bom_version:
                component.selected_bom_version ?? reference.bom_version ?? null,
              bom_approved_at:
                component.selected_bom_approved_at ||
                reference.bom_approved_at ||
                null,
              parent_required_by_date: referenceRequiredBy || null,
              parent_release_by_date:
                referenceReleaseBy || referenceRequiredBy || null,
              due_date: referenceReleaseBy || referenceRequiredBy || null,
            };
            const referenceKey = [
              childReference.source_type,
              childReference.job_order_id || childReference.sales_order_item_id,
              childReference.parent_item_id,
              childReference.bom_level,
            ].join(":");
            const existingReference = childLine.demand_references.find(
              (existing: any) =>
                [
                  existing.source_type,
                  existing.job_order_id || existing.sales_order_item_id,
                  existing.parent_item_id,
                  existing.bom_level,
                ].join(":") === referenceKey,
            );
            if (existingReference)
              existingReference.required_quantity = Number(
                (
                  Number(existingReference.required_quantity || 0) +
                  referenceQuantity
                ).toFixed(4),
              );
            else childLine.demand_references.push(childReference);
          }
          aggregate.set(componentItemId, childLine);
        }
      }
      if (!explosionChanged) return explodedBuildQuantity;
    }
    throw new BadRequestException(
      "MRP multi-level BOM explosion did not converge. Review the active BOM hierarchy.",
    );
  }

  private productionSupply(jobOrders: any[], demandedItemIds: string[]) {
    const quantities = new Map<string, number>();
    const dates = new Map<string, string[]>();
    const receipts = new Map<string, MrpSupplyReceipt[]>();
    const demanded = new Set(demandedItemIds);
    for (const order of jobOrders || []) {
      const itemId = String(order.item_id || "");
      if (!itemId || !demanded.has(itemId)) continue;
      const open = Math.max(
        0,
        Number(order.quantity || 0) - Number(order.completed_quantity || 0),
      );
      if (open <= 0) continue;
      quantities.set(itemId, (quantities.get(itemId) || 0) + open);
      const dueDate = order.end_date || order.due_date || order.start_date;
      receipts.set(itemId, [
        ...(receipts.get(itemId) || []),
        {
          quantity: open,
          date: dueDate ? String(dueDate).slice(0, 10) : null,
          document_type: "PRODUCTION_JOB_ORDER",
          document_id: String(order.id),
          document_number: String(order.job_order_number || order.id),
          document_line_id: null,
          status: String(order.status || ""),
        },
      ]);
      if (dueDate)
        dates.set(itemId, [
          ...(dates.get(itemId) || []),
          String(dueDate).slice(0, 10),
        ]);
    }
    return { quantities, dates, receipts };
  }

  private timePhaseSupply(
    receipts: Array<{ quantity: number; date?: string | null }>,
    requiredBy?: string | null,
  ) {
    const result = { onTime: 0, late: 0, undated: 0 };
    for (const receipt of receipts || []) {
      const quantity = Math.max(0, Number(receipt.quantity || 0));
      if (quantity <= 0) continue;
      const date = String(receipt.date || "").slice(0, 10);
      if (!requiredBy) result.onTime += quantity;
      else if (!date) result.undated += quantity;
      else if (date <= requiredBy) result.onTime += quantity;
      else result.late += quantity;
    }
    return {
      onTime: Number(result.onTime.toFixed(4)),
      late: Number(result.late.toFixed(4)),
      undated: Number(result.undated.toFixed(4)),
    };
  }

  private existingSupplyIntervention(
    timingGap: number,
    lateSupply: number,
    undatedSupply: number,
  ) {
    const gap = Math.max(0, Number(timingGap || 0));
    const rescheduleQuantity = Number(
      Math.min(gap, Math.max(0, Number(lateSupply || 0))).toFixed(4),
    );
    const confirmDateQuantity = Number(
      Math.min(
        Math.max(0, gap - rescheduleQuantity),
        Math.max(0, Number(undatedSupply || 0)),
      ).toFixed(4),
    );
    const newSupplyRequirement = Number(
      Math.max(0, gap - rescheduleQuantity - confirmDateQuantity).toFixed(4),
    );
    return { rescheduleQuantity, confirmDateQuantity, newSupplyRequirement };
  }

  private projectTimeBuckets(
    demandEvents: Array<{
      quantity: number;
      dueDate?: string | null;
      reference?: any;
    }>,
    receipts: Array<{
      quantity: number;
      date?: string | null;
      source: MrpSupplySource;
      document_type: MrpSupplyReceipt["document_type"];
      document_id: string;
      document_number: string;
      document_line_id: string | null;
      status: string;
    }>,
    input: {
      initialSupply: number;
      safetyStock: number;
      minimumOrderQuantity: number;
      orderMultiple: number;
    },
  ) {
    const demandByDate = new Map<
      string,
      { quantity: number; references: any[] }
    >();
    for (const event of demandEvents || []) {
      const quantity = Math.max(0, Number(event.quantity || 0));
      if (quantity <= 0) continue;
      const date = String(event.dueDate || "").slice(0, 10) || "UNSCHEDULED";
      const bucket = demandByDate.get(date) || { quantity: 0, references: [] };
      bucket.quantity += quantity;
      if (event.reference) bucket.references.push(event.reference);
      demandByDate.set(date, bucket);
    }
    const datedReceipts = (receipts || [])
      .filter((receipt) => receipt.date)
      .map((receipt) => ({
        ...receipt,
        quantity: Math.max(0, Number(receipt.quantity || 0)),
        date: String(receipt.date).slice(0, 10),
      }))
      .filter((receipt) => receipt.quantity > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
    const undatedReceipts = (receipts || [])
      .filter((receipt) => !receipt.date)
      .map((receipt) => ({
        ...receipt,
        quantity: Math.max(0, Number(receipt.quantity || 0)),
      }))
      .filter((receipt) => receipt.quantity > 0);
    const dates = Array.from(demandByDate.keys()).sort((a, b) =>
      a === "UNSCHEDULED" ? 1 : b === "UNSCHEDULED" ? -1 : a.localeCompare(b),
    );
    const onTimeBySource: Record<string, number> = {};
    const rescheduleBySource: Record<string, number> = {};
    const availableLots: any[] = [];
    const initialSupply = Math.max(0, Number(input.initialSupply || 0));
    if (initialSupply > 0)
      availableLots.push({
        quantity: initialSupply,
        coverage_type: "INITIAL_SUPPLY",
        source: "ON_HAND_AND_ISSUED",
        available_date: null,
        document_type: null,
        document_id: null,
        document_number: null,
        document_line_id: null,
      });
    const availableBalance = () =>
      availableLots.reduce(
        (sum, lot) => sum + Math.max(0, Number(lot.quantity || 0)),
        0,
      );
    const useForDemand = (quantity: number, lot: any, demandPegging: any[]) => {
      const allocated = Math.min(
        Math.max(0, Number(quantity || 0)),
        Math.max(0, Number(lot.quantity || 0)),
      );
      if (allocated <= 0) return 0;
      lot.quantity -= allocated;
      demandPegging.push({
        coverage_type: lot.coverage_type,
        source: lot.source,
        document_type: lot.document_type,
        document_id: lot.document_id,
        document_number: lot.document_number,
        document_line_id: lot.document_line_id,
        supply_date: lot.available_date,
        quantity: Number(allocated.toFixed(4)),
      });
      return allocated;
    };
    let balance = initialSupply;
    let receiptIndex = 0;
    let totalTimingGap = 0;
    let totalReschedule = 0;
    let totalConfirmDate = 0;
    let totalRawNewSupply = 0;
    let totalRecommended = 0;
    const buckets: any[] = [];
    const supplyInterventions: any[] = [];
    const demandSupplyPegging: any[] = [];

    for (const date of dates) {
      let onTimeSupply = 0;
      while (
        receiptIndex < datedReceipts.length &&
        (date === "UNSCHEDULED" || datedReceipts[receiptIndex].date <= date)
      ) {
        const receipt = datedReceipts[receiptIndex++];
        onTimeSupply += receipt.quantity;
        onTimeBySource[receipt.source] =
          (onTimeBySource[receipt.source] || 0) + receipt.quantity;
        availableLots.push({
          ...receipt,
          coverage_type: "ON_TIME_RECEIPT",
          available_date: receipt.date,
        });
      }
      const demand = demandByDate.get(date)!;
      const demandPegging: any[] = [];
      let remainingDemand = demand.quantity;
      for (const lot of availableLots) {
        if (remainingDemand <= 0) break;
        remainingDemand -= useForDemand(remainingDemand, lot, demandPegging);
      }
      balance = availableBalance();
      const timingGap = Math.max(
        0,
        remainingDemand + Number(input.safetyStock || 0) - balance,
      );
      totalTimingGap += timingGap;
      let remainingGap = timingGap;
      let rescheduleQuantity = 0;
      const bucketRescheduleBySource: Record<string, number> = {};
      const bucketInterventions: any[] = [];
      for (let index = receiptIndex; index < datedReceipts.length; index++) {
        if (remainingGap <= 0) break;
        const receipt = datedReceipts[index];
        const allocated = Math.min(remainingGap, receipt.quantity);
        if (allocated <= 0) continue;
        receipt.quantity -= allocated;
        remainingGap -= allocated;
        rescheduleQuantity += allocated;
        bucketRescheduleBySource[receipt.source] =
          (bucketRescheduleBySource[receipt.source] || 0) + allocated;
        rescheduleBySource[receipt.source] =
          (rescheduleBySource[receipt.source] || 0) + allocated;
        const intervention = {
          intervention_type: "RESCHEDULE_IN",
          source: receipt.source,
          document_type: receipt.document_type,
          document_id: receipt.document_id,
          document_number: receipt.document_number,
          document_line_id: receipt.document_line_id,
          status: receipt.status,
          current_date: receipt.date,
          required_date: date === "UNSCHEDULED" ? null : date,
          quantity: Number(allocated.toFixed(4)),
        };
        bucketInterventions.push(intervention);
        supplyInterventions.push(intervention);
        const immediateLot = {
          quantity: allocated,
          coverage_type: "RESCHEDULE_IN",
          source: receipt.source,
          available_date: date === "UNSCHEDULED" ? null : date,
          document_type: receipt.document_type,
          document_id: receipt.document_id,
          document_number: receipt.document_number,
          document_line_id: receipt.document_line_id,
          status: receipt.status,
        };
        remainingDemand -= useForDemand(
          remainingDemand,
          immediateLot,
          demandPegging,
        );
        if (immediateLot.quantity > 0) availableLots.push(immediateLot);
      }
      let confirmDateQuantity = 0;
      for (const receipt of undatedReceipts) {
        if (remainingGap <= 0) break;
        const allocated = Math.min(remainingGap, receipt.quantity);
        if (allocated <= 0) continue;
        receipt.quantity -= allocated;
        remainingGap -= allocated;
        confirmDateQuantity += allocated;
        const intervention = {
          intervention_type: "CONFIRM_DATE",
          source: receipt.source,
          document_type: receipt.document_type,
          document_id: receipt.document_id,
          document_number: receipt.document_number,
          document_line_id: receipt.document_line_id,
          status: receipt.status,
          current_date: null,
          required_date: date === "UNSCHEDULED" ? null : date,
          quantity: Number(allocated.toFixed(4)),
        };
        bucketInterventions.push(intervention);
        supplyInterventions.push(intervention);
        const immediateLot = {
          quantity: allocated,
          coverage_type: "CONFIRM_DATE",
          source: receipt.source,
          available_date: date === "UNSCHEDULED" ? null : date,
          document_type: receipt.document_type,
          document_id: receipt.document_id,
          document_number: receipt.document_number,
          document_line_id: receipt.document_line_id,
          status: receipt.status,
        };
        remainingDemand -= useForDemand(
          remainingDemand,
          immediateLot,
          demandPegging,
        );
        if (immediateLot.quantity > 0) availableLots.push(immediateLot);
      }
      const rawNewSupply = Math.max(0, remainingGap);
      let recommendedSupply = rawNewSupply;
      const minimum = Math.max(0, Number(input.minimumOrderQuantity || 0));
      const multiple = Math.max(0, Number(input.orderMultiple || 0));
      if (recommendedSupply > 0)
        recommendedSupply = Math.max(recommendedSupply, minimum);
      if (recommendedSupply > 0 && multiple > 0)
        recommendedSupply = Math.ceil(recommendedSupply / multiple) * multiple;
      recommendedSupply = Number(recommendedSupply.toFixed(4));
      if (recommendedSupply > 0) {
        const recommendedLot = {
          quantity: recommendedSupply,
          coverage_type: "NEW_SUPPLY_RECOMMENDATION",
          source: "PLANNED_SUPPLY",
          available_date: date === "UNSCHEDULED" ? null : date,
          document_type: null,
          document_id: null,
          document_number: null,
          document_line_id: null,
        };
        remainingDemand -= useForDemand(
          remainingDemand,
          recommendedLot,
          demandPegging,
        );
        if (recommendedLot.quantity > 0) availableLots.push(recommendedLot);
      }
      balance = availableBalance();
      demandSupplyPegging.push(
        ...demandPegging.map((pegging) => ({
          ...pegging,
          required_by_date: date === "UNSCHEDULED" ? null : date,
        })),
      );
      totalReschedule += rescheduleQuantity;
      totalConfirmDate += confirmDateQuantity;
      totalRawNewSupply += rawNewSupply;
      totalRecommended += recommendedSupply;
      buckets.push({
        required_by_date: date === "UNSCHEDULED" ? null : date,
        demand_quantity: Number(demand.quantity.toFixed(4)),
        on_time_supply_quantity: Number(onTimeSupply.toFixed(4)),
        timing_gap_quantity: Number(timingGap.toFixed(4)),
        reschedule_quantity: Number(rescheduleQuantity.toFixed(4)),
        reschedule_by_source: bucketRescheduleBySource,
        confirm_date_quantity: Number(confirmDateQuantity.toFixed(4)),
        raw_new_supply_requirement: Number(rawNewSupply.toFixed(4)),
        recommended_supply_quantity: recommendedSupply,
        projected_available_quantity: Number(balance.toFixed(4)),
        demand_references: demand.references,
        demand_supply_pegging: demandPegging,
        supply_interventions: bucketInterventions,
      });
    }
    const undatedSupply = (receipts || [])
      .filter((receipt) => !receipt.date)
      .reduce(
        (sum, receipt) => sum + Math.max(0, Number(receipt.quantity || 0)),
        0,
      );
    const horizonDate =
      [...dates].reverse().find((date) => date !== "UNSCHEDULED") || null;
    const unpeggedSupplyDocuments: any[] = [];
    const addUnpeggedSupply = (
      supply: any,
      quantity: number,
      reviewReason:
        | "EXCESS_AFTER_HORIZON"
        | "FUTURE_UNPEGGED_RECEIPT"
        | "UNDATED_UNPEGGED_RECEIPT",
      suggestedAction:
        | "RESCHEDULE_OUT_OR_REDUCE"
        | "REVIEW_FUTURE_SUPPLY"
        | "CONFIRM_OR_CANCEL",
    ) => {
      const openQuantity = Number(Math.max(0, quantity).toFixed(4));
      if (openQuantity <= 0 || !supply.document_id) return;
      unpeggedSupplyDocuments.push({
        intervention_type: "REVIEW_UNPEGGED_SUPPLY",
        source: supply.source,
        document_type: supply.document_type,
        document_id: supply.document_id,
        document_number: supply.document_number,
        document_line_id: supply.document_line_id,
        status: supply.status || null,
        current_date: supply.available_date || supply.date || null,
        required_date: horizonDate,
        quantity: openQuantity,
        review_reason: reviewReason,
        suggested_action: suggestedAction,
      });
    };
    let protectedSafetyStock = Math.max(0, Number(input.safetyStock || 0));
    for (const lot of availableLots) {
      const quantity = Math.max(0, Number(lot.quantity || 0));
      const protectedQuantity = Math.min(protectedSafetyStock, quantity);
      protectedSafetyStock -= protectedQuantity;
      addUnpeggedSupply(
        lot,
        quantity - protectedQuantity,
        "EXCESS_AFTER_HORIZON",
        "RESCHEDULE_OUT_OR_REDUCE",
      );
    }
    for (let index = receiptIndex; index < datedReceipts.length; index++)
      addUnpeggedSupply(
        datedReceipts[index],
        datedReceipts[index].quantity,
        "FUTURE_UNPEGGED_RECEIPT",
        "REVIEW_FUTURE_SUPPLY",
      );
    for (const receipt of undatedReceipts)
      addUnpeggedSupply(
        receipt,
        receipt.quantity,
        "UNDATED_UNPEGGED_RECEIPT",
        "CONFIRM_OR_CANCEL",
      );
    return {
      buckets,
      onTimeBySource,
      rescheduleBySource,
      timingGapQuantity: Number(totalTimingGap.toFixed(4)),
      rescheduleQuantity: Number(totalReschedule.toFixed(4)),
      confirmDateQuantity: Number(totalConfirmDate.toFixed(4)),
      rawNewSupplyRequirement: Number(totalRawNewSupply.toFixed(4)),
      recommendedSupplyQuantity: Number(totalRecommended.toFixed(4)),
      undatedSupplyQuantity: Number(undatedSupply.toFixed(4)),
      projectedAvailableQuantity: Number(balance.toFixed(4)),
      supplyInterventions,
      demandSupplyPegging,
      unpeggedSupplyDocuments,
      unpeggedSupplyQuantity: Number(
        unpeggedSupplyDocuments
          .reduce(
            (sum, intervention) => sum + Number(intervention.quantity || 0),
            0,
          )
          .toFixed(4),
      ),
    };
  }

  private purchasePipeline(
    requisitions: any[],
    purchaseOrders: any[],
    demandedItemIds: string[],
  ) {
    const demanded = new Set(demandedItemIds);
    const orderedByPrItem = new Map<string, number>();
    const requisitionQuantities = new Map<string, number>();
    const draftOrderQuantities = new Map<string, number>();
    const dates = new Map<string, string[]>();
    const requisitionReceipts = new Map<string, MrpSupplyReceipt[]>();
    const draftOrderReceipts = new Map<string, MrpSupplyReceipt[]>();
    for (const order of purchaseOrders || []) {
      const firm = ["APPROVED", "PARTIAL"].includes(
        String(order.status || "").toUpperCase(),
      );
      for (const item of order.purchase_order_items || []) {
        const prItemId = String(item.pr_item_id || "");
        if (prItemId)
          orderedByPrItem.set(
            prItemId,
            (orderedByPrItem.get(prItemId) || 0) +
              Number(item.ordered_qty || 0),
          );
        const itemId = String(item.item_id || "");
        if (firm || !itemId || !demanded.has(itemId)) continue;
        const open = Math.max(
          0,
          Number(item.ordered_qty || 0) - Number(item.received_qty || 0),
        );
        if (open <= 0) continue;
        draftOrderQuantities.set(
          itemId,
          (draftOrderQuantities.get(itemId) || 0) + open,
        );
        const dueDate = item.delivery_date || order.delivery_date;
        draftOrderReceipts.set(itemId, [
          ...(draftOrderReceipts.get(itemId) || []),
          {
            quantity: open,
            date: dueDate ? String(dueDate).slice(0, 10) : null,
            document_type: "PURCHASE_ORDER",
            document_id: String(order.id),
            document_number: String(order.po_number || order.id),
            document_line_id: item.id ? String(item.id) : null,
            status: String(order.status || ""),
          },
        ]);
        if (dueDate)
          dates.set(itemId, [
            ...(dates.get(itemId) || []),
            String(dueDate).slice(0, 10),
          ]);
      }
    }
    for (const requisition of requisitions || []) {
      const status = String(requisition.status || "").toUpperCase();
      const isMrpDraft =
        status === "DRAFT" &&
        String(requisition.purpose || "").startsWith("MRP release ");
      if (status === "DRAFT" && !isMrpDraft) continue;
      for (const item of requisition.purchase_requisition_items || []) {
        const itemId = String(item.item_id || "");
        if (!itemId || !demanded.has(itemId)) continue;
        const remaining = Math.max(
          0,
          Number(item.requested_qty || 0) -
            (orderedByPrItem.get(String(item.id)) || 0),
        );
        if (remaining <= 0) continue;
        requisitionQuantities.set(
          itemId,
          (requisitionQuantities.get(itemId) || 0) + remaining,
        );
        const dueDate = item.required_date || requisition.required_date;
        requisitionReceipts.set(itemId, [
          ...(requisitionReceipts.get(itemId) || []),
          {
            quantity: remaining,
            date: dueDate ? String(dueDate).slice(0, 10) : null,
            document_type: "PURCHASE_REQUISITION",
            document_id: String(requisition.id),
            document_number: String(requisition.pr_number || requisition.id),
            document_line_id: item.id ? String(item.id) : null,
            status: String(requisition.status || ""),
          },
        ]);
        if (dueDate)
          dates.set(itemId, [
            ...(dates.get(itemId) || []),
            String(dueDate).slice(0, 10),
          ]);
      }
    }
    return {
      requisitionQuantities,
      draftOrderQuantities,
      dates,
      requisitionReceipts,
      draftOrderReceipts,
    };
  }

  private async assertDecisionIsNotReleased(
    tenantId: string,
    runId: string,
    lineId: string,
  ) {
    const { data: releases, error: releaseError } = await this.supabase
      .from("mizantra_exception_register")
      .select("source_key")
      .eq("tenant_id", tenantId)
      .eq("source_type", "MRP_RELEASE")
      .contains("evidence", { run_id: runId, line_ids: [lineId] })
      .limit(50);
    if (releaseError) throw new BadRequestException(releaseError.message);
    const insightIds = (releases || [])
      .map((row: any) => String(row.source_key || ""))
      .filter(Boolean);
    if (!insightIds.length) return;
    const { data: active, error: actionError } = await this.supabase
      .from("mizantra_governed_action_requests")
      .select("id,status,native_result")
      .eq("tenant_id", tenantId)
      .in("insight_id", insightIds)
      .in("status", ["PENDING_APPROVAL", "APPROVED", "EXECUTING", "EXECUTED"])
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (actionError) throw new BadRequestException(actionError.message);
    if (!active) return;
    const document = active.native_result?.number
      ? ` Native document ${active.native_result.number} already exists.`
      : "";
    throw new BadRequestException(
      `This recommendation is locked by governed request ${String(active.id).slice(0, 8)} (${active.status}).${document}`,
    );
  }

  async latest(tenantId: string) {
    const { data: run, error } = await this.supabase
      .from("mrp_planning_runs")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("run_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!run) return { run: null, lines: [] };
    const { data: lines, error: lineError } = await this.supabase
      .from("mrp_planning_lines")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("run_id", run.id)
      .order("net_requirement", { ascending: false });
    if (lineError) throw new BadRequestException(lineError.message);
    const ids = (lines || []).map((line: any) => line.id);
    const { data: decisions } = ids.length
      ? await this.supabase
          .from("mrp_planner_decisions")
          .select("*")
          .eq("tenant_id", tenantId)
          .in("line_id", ids)
      : { data: [] as any[] };
    const decisionByLine = new Map(
      (decisions || []).map((row: any) => [String(row.line_id), row]),
    );
    const enrichedLines = (lines || []).map((line: any) => ({
      ...line,
      scheduled_purchase_quantity: Number(
        line.planning_policy?.scheduled_purchase_quantity || 0,
      ),
      scheduled_production_quantity: Number(
        line.planning_policy?.scheduled_production_quantity || 0,
      ),
      open_requisition_quantity: Number(
        line.planning_policy?.open_requisition_quantity || 0,
      ),
      open_draft_po_quantity: Number(
        line.planning_policy?.open_draft_po_quantity || 0,
      ),
      late_supply_quantity: Number(
        line.planning_policy?.late_supply_quantity || 0,
      ),
      undated_supply_quantity: Number(
        line.planning_policy?.undated_supply_quantity || 0,
      ),
      reschedule_quantity: Number(
        line.planning_policy?.reschedule_quantity || 0,
      ),
      confirm_date_quantity: Number(
        line.planning_policy?.confirm_date_quantity || 0,
      ),
      new_supply_requirement: Number(
        line.planning_policy?.new_supply_requirement || 0,
      ),
      recommended_intervention:
        line.planning_policy?.recommended_intervention || "MONITOR",
      projected_available_quantity: Number(
        line.planning_policy?.projected_available_quantity || 0,
      ),
      time_buckets: Array.isArray(line.planning_policy?.time_buckets)
        ? line.planning_policy.time_buckets
        : [],
      supply_interventions: Array.isArray(
        line.planning_policy?.supply_interventions,
      )
        ? line.planning_policy.supply_interventions
        : [],
      demand_supply_pegging: Array.isArray(
        line.planning_policy?.demand_supply_pegging,
      )
        ? line.planning_policy.demand_supply_pegging
        : [],
      demand_mix: line.planning_policy?.demand_mix || {},
      approved_forecast_quantity: Number(
        line.planning_policy?.approved_forecast_quantity || 0,
      ),
      physical_stock_quantity: Number(
        line.planning_policy?.physical_stock_quantity ??
          line.available_quantity ??
          0,
      ),
      unreserved_stock_quantity: Number(
        line.planning_policy?.unreserved_stock_quantity ??
          line.available_quantity ??
          0,
      ),
      active_reserved_quantity: Number(
        line.planning_policy?.active_reserved_quantity || 0,
      ),
      reserved_for_plan_quantity: Number(
        line.planning_policy?.reserved_for_plan_quantity || 0,
      ),
      reserved_elsewhere_quantity: Number(
        line.planning_policy?.reserved_elsewhere_quantity || 0,
      ),
      reservation_mismatch_quantity: Number(
        line.planning_policy?.reservation_mismatch_quantity || 0,
      ),
      reservation_evidence: Array.isArray(
        line.planning_policy?.reservation_evidence,
      )
        ? line.planning_policy.reservation_evidence
        : [],
      safety_stock_calculation:
        line.planning_policy?.safety_stock_calculation || null,
      lot_sizing_policy:
        line.planning_policy?.lot_sizing_policy || "LOT_FOR_LOT",
      rounding_excess_quantity: Number(
        line.planning_policy?.rounding_excess_quantity || 0,
      ),
      maximum_stock_quantity:
        line.planning_policy?.maximum_stock_quantity ?? null,
      maximum_stock_conflict: Boolean(
        line.planning_policy?.maximum_stock_conflict,
      ),
      shelf_life_policy_risk: Boolean(
        line.planning_policy?.shelf_life_policy_risk,
      ),
      batch_constraint: line.planning_policy?.batch_constraint || "NONE",
      substitution_candidates: Array.isArray(
        line.planning_policy?.substitution_candidates,
      )
        ? line.planning_policy.substitution_candidates
        : [],
      substitution_approval_required:
        line.planning_policy?.substitution_approval_required !== false,
      planning_horizon: line.planning_policy?.planning_horizon || null,
      unpegged_supply_quantity: Number(
        line.planning_policy?.unpegged_supply_quantity || 0,
      ),
      unpegged_supply_documents: Array.isArray(
        line.planning_policy?.unpegged_supply_documents,
      )
        ? line.planning_policy.unpegged_supply_documents
        : [],
      run_change: line.planning_policy?.run_change || null,
      planner_decision: decisionByLine.get(String(line.id)) || null,
    }));
    const changedLines = enrichedLines.filter(
      (line: any) =>
        line.run_change &&
        !["UNCHANGED", "BASELINE_RECOMMENDATION"].includes(
          line.run_change.classification,
        ),
    );
    const forecastReferences = new Map<string, any>();
    for (const line of enrichedLines) {
      for (const reference of line.demand_references || []) {
        if (reference.source_type !== "APPROVED_FORECAST") continue;
        const key = [
          reference.demand_plan_cycle_id,
          reference.demand_plan_line_id,
          reference.forecast_month,
        ].join(":");
        if (!forecastReferences.has(key))
          forecastReferences.set(key, reference);
      }
    }
    const forecastEvidence = Array.from(forecastReferences.values());
    const storedForecastConsumption = enrichedLines.find(
      (line: any) => line.planning_policy?.forecast_consumption,
    )?.planning_policy?.forecast_consumption;
    return {
      run,
      lines: enrichedLines,
      forecast_consumption: storedForecastConsumption || {
        active: forecastEvidence.length > 0,
        demand_plan_cycle_id: forecastEvidence[0]?.demand_plan_cycle_id || null,
        demand_plan_cycle_name:
          forecastEvidence[0]?.demand_plan_cycle_name || null,
        residual_buckets: forecastEvidence.length,
        forecast_buckets: forecastEvidence.length,
        original_forecast_quantity: Number(
          forecastEvidence
            .reduce(
              (sum: number, reference: any) =>
                sum + Number(reference.forecast_quantity || 0),
              0,
            )
            .toFixed(4),
        ),
        sales_consumed_quantity: Number(
          forecastEvidence
            .reduce(
              (sum: number, reference: any) =>
                sum + Number(reference.sales_consumed_quantity || 0),
              0,
            )
            .toFixed(4),
        ),
        residual_forecast_quantity: Number(
          forecastEvidence
            .reduce(
              (sum: number, reference: any) =>
                sum + Number(reference.residual_forecast_quantity || 0),
              0,
            )
            .toFixed(4),
        ),
      },
      reservation_summary: {
        reserved_for_plan_quantity: Number(
          enrichedLines
            .reduce(
              (sum: number, line: any) =>
                sum + Number(line.reserved_for_plan_quantity || 0),
              0,
            )
            .toFixed(4),
        ),
        reserved_elsewhere_quantity: Number(
          enrichedLines
            .reduce(
              (sum: number, line: any) =>
                sum + Number(line.reserved_elsewhere_quantity || 0),
              0,
            )
            .toFixed(4),
        ),
        mismatched_items: enrichedLines.filter(
          (line: any) => line.reservation_mismatch_quantity > 0.0001,
        ).length,
      },
      policy_summary: {
        substitution_opportunities: enrichedLines.filter(
          (line: any) => line.substitution_candidates.length > 0,
        ).length,
        shelf_life_risks: enrichedLines.filter(
          (line: any) => line.shelf_life_policy_risk,
        ).length,
        maximum_stock_conflicts: enrichedLines.filter(
          (line: any) => line.maximum_stock_conflict,
        ).length,
        single_batch_requirements: enrichedLines.filter(
          (line: any) => line.batch_constraint === "SINGLE_BATCH",
        ).length,
        service_level_items: enrichedLines.filter(
          (line: any) =>
            line.safety_stock_calculation?.method === "SERVICE_LEVEL",
        ).length,
      },
      comparison: {
        previous_run_id:
          enrichedLines.find((line: any) => line.run_change?.previous_run_id)
            ?.run_change?.previous_run_id || null,
        changed_lines: changedLines.length,
        inside_time_fence: changedLines.filter(
          (line: any) => line.run_change?.inside_time_fence,
        ).length,
        requires_planner_reapproval: changedLines.filter(
          (line: any) => line.run_change?.requires_planner_reapproval,
        ).length,
        by_classification: changedLines.reduce(
          (summary: Record<string, number>, line: any) => {
            const key = String(line.run_change.classification);
            summary[key] = (summary[key] || 0) + 1;
            return summary;
          },
          {},
        ),
      },
    };
  }

  async run(tenantId: string, userId?: string) {
    const { data: orders, error: orderError } = await this.supabase
      .from("production_job_orders")
      .select(
        "id,job_order_number,status,start_date,end_date,item_id,quantity,completed_quantity,sales_order_id,sales_order_item_id,work_package_line_id",
      )
      .eq("tenant_id", tenantId)
      .in("status", [
        "DRAFT",
        "SCHEDULED",
        "IN_PROGRESS",
        "STORE_ISSUED",
        "COMPLETED",
      ]);
    if (orderError) throw new BadRequestException(orderError.message);
    const coverageOrders = orders || [];
    const safeOrders = coverageOrders.filter(
      (order: any) => String(order.status).toUpperCase() !== "COMPLETED",
    );
    const ids = safeOrders.map((order: any) => String(order.id));
    const materialResult = ids.length
      ? await this.supabase
          .from("job_order_materials")
          .select(
            "job_order_id,item_id,selected_variant_id,item_code,item_name,required_quantity,issued_quantity",
          )
          .in("job_order_id", ids)
      : { data: [] as any[], error: null };
    if (materialResult.error)
      throw new BadRequestException(materialResult.error.message);
    const materials = materialResult.data || [];

    const [salesResult, programResult, projectDemandResult] = await Promise.all([
      this.supabase
        .from("sales_orders")
        .select(
          "id,so_number,status,release_status,credit_status,delivery_block,expected_delivery_date,sales_order_items(id,item_id,quantity,dispatched_quantity,promised_date)",
        )
        .eq("tenant_id", tenantId),
      this.supabase
        .from("production_programs")
        .select("id,sales_order_item_id,target_quantity,status")
        .eq("tenant_id", tenantId)
        .eq("demand_source", "SALES_ORDER")
        .not("status", "in", "(CANCELLED,CLOSED)"),
      this.supabase
        .from("project_work_package_lines")
        .select("id,project_id,work_package_id,line_number,item_id,item_code,item_name,quantity,uom,required_date,demand_status")
        .eq("tenant_id", tenantId)
        .in("demand_status", ["RELEASED", "PLANNED", "IN_PRODUCTION"]),
    ]);
    if (salesResult.error)
      throw new BadRequestException(salesResult.error.message);
    if (programResult.error)
      throw new BadRequestException(programResult.error.message);
    if (projectDemandResult.error)
      throw new BadRequestException(projectDemandResult.error.message);

    const activePrograms = programResult.data || [];
    const eligibleSalesDemands = (salesResult.data || []).flatMap(
      (order: any) => {
        const status = String(order.status || "").toUpperCase();
        const release = String(
          order.release_status || "RELEASED",
        ).toUpperCase();
        const credit = String(order.credit_status || "CLEAR").toUpperCase();
        if (
          ["CANCELLED", "CLOSED", "COMPLETED"].includes(status) ||
          release !== "RELEASED" ||
          credit === "BLOCKED" ||
          order.delivery_block
        )
          return [];
        return (order.sales_order_items || [])
          .map((line: any) => ({
            order,
            line,
            open_quantity: Number(
              Math.max(
                0,
                Number(line.quantity || 0) -
                  Number(line.dispatched_quantity || 0),
              ).toFixed(4),
            ),
            uncovered_quantity: this.salesOrderUncoveredQuantity(
              line,
              coverageOrders,
              activePrograms,
            ),
            due_date: String(
              line.promised_date || order.expected_delivery_date || "",
            ).slice(0, 10),
          }))
          .filter((demand: any) => demand.open_quantity > 0);
      },
    );
    const salesDemands = eligibleSalesDemands.filter(
      (demand: any) => demand.uncovered_quantity > 0,
    );
    const projectDemands = (projectDemandResult.data || []).map((line: any) => {
      const covered = coverageOrders
        .filter((order: any) => String(order.work_package_line_id || "") === String(line.id))
        .reduce((sum: number, order: any) => sum + Math.max(0, Number(order.quantity || 0) - Number(order.completed_quantity || 0)), 0);
      return { ...line, uncovered_quantity: Math.max(0, Number(line.quantity || 0) - covered), due_date: line.required_date || null };
    }).filter((line: any) => line.uncovered_quantity > 0);

    const { data: approvedDemandCycle, error: approvedCycleError } =
      await this.supabase
        .from("demand_plan_cycles")
        .select("id,cycle_name,status,approved_at")
        .eq("tenant_id", tenantId)
        .eq("status", "APPROVED")
        .order("approved_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (approvedCycleError)
      throw new BadRequestException(approvedCycleError.message);
    const approvedForecastLineResult = approvedDemandCycle
      ? await this.supabase
          .from("demand_plan_lines")
          .select(
            "id,cycle_id,item_id,item_code,item_name,consensus_forecast,forecast_accuracy_pct",
          )
          .eq("tenant_id", tenantId)
          .eq("cycle_id", approvedDemandCycle.id)
      : { data: [] as any[], error: null };
    if (approvedForecastLineResult.error)
      throw new BadRequestException(approvedForecastLineResult.error.message);
    const forecastDemands = this.consumeApprovedForecast(
      approvedForecastLineResult.data || [],
      eligibleSalesDemands,
      approvedDemandCycle,
    );
    const forecastConsumptionSummary = {
      active: Boolean(approvedDemandCycle),
      demand_plan_cycle_id: approvedDemandCycle?.id || null,
      demand_plan_cycle_name: approvedDemandCycle?.cycle_name || null,
      forecast_buckets: forecastDemands.length,
      residual_buckets: forecastDemands.filter(
        (demand: any) => demand.residual_forecast_quantity > 0,
      ).length,
      original_forecast_quantity: Number(
        forecastDemands
          .reduce(
            (sum: number, demand: any) =>
              sum + Number(demand.forecast_quantity || 0),
            0,
          )
          .toFixed(4),
      ),
      sales_consumed_quantity: Number(
        forecastDemands
          .reduce(
            (sum: number, demand: any) =>
              sum + Number(demand.sales_consumed_quantity || 0),
            0,
          )
          .toFixed(4),
      ),
      residual_forecast_quantity: Number(
        forecastDemands
          .reduce(
            (sum: number, demand: any) =>
              sum + Number(demand.residual_forecast_quantity || 0),
            0,
          )
          .toFixed(4),
      ),
    };

    const planningDate = new Date().toISOString().slice(0, 10);
    const salesBomResult = await this.supabase
      .from("bom_headers")
      .select(
        "id,item_id,version,is_active,lifecycle_status,effective_from,effective_to,approved_by,approved_at,output_quantity,output_uom",
      )
      .eq("tenant_id", tenantId)
      .order("version", { ascending: false });
    if (salesBomResult.error)
      throw new BadRequestException(salesBomResult.error.message);
    const effectiveBoms = this.effectiveBomRevisions(
      salesBomResult.data || [],
      planningDate,
    );
    const bomByFinishedItem = effectiveBoms.selectedByItem;
    const bomById = new Map<string, any>();
    for (const bom of effectiveBoms.eligible) {
      bomById.set(String(bom.id), bom);
    }
    const salesBomIds = Array.from(bomByFinishedItem.values()).map(
      (bom: any) => bom.id,
    );
    const salesBomLineResult = salesBomIds.length
      ? await this.supabase
          .from("bom_items")
          .select(
            "bom_id,item_id,child_bom_id,quantity,scrap_percentage,component_type,quantity_formula_id,quantity_basis,consumption_uom",
          )
          .in("bom_id", salesBomIds)
      : { data: [] as any[], error: null };
    if (salesBomLineResult.error)
      throw new BadRequestException(salesBomLineResult.error.message);
    const quantityFormulaIds = Array.from(new Set((salesBomLineResult.data || []).map((line: any) => line.quantity_formula_id).filter(Boolean)));
    const formulaResult = quantityFormulaIds.length
      ? await this.supabase.from("production_formula_definitions").select("id,expression,rounding_mode,decimal_places,lifecycle_status,effective_from,effective_to").eq("tenant_id", tenantId).in("id", quantityFormulaIds).eq("lifecycle_status", "APPROVED")
      : { data: [] as any[], error: null };
    if (formulaResult.error) throw new BadRequestException(formulaResult.error.message);
    const specificationResult = salesBomIds.length
      ? await this.supabase.from("production_item_specifications").select("item_id,specification_values").eq("tenant_id", tenantId).eq("lifecycle_status", "APPROVED")
      : { data: [] as any[], error: null };
    if (specificationResult.error) throw new BadRequestException(specificationResult.error.message);
    const formulaById = new Map((formulaResult.data || []).map((formula: any) => [String(formula.id), formula]));
    const specificationByItem = new Map((specificationResult.data || []).map((spec: any) => [String(spec.item_id), spec.specification_values || {}]));
    const calculatedRequirement = (component: any, finishedItemId: string, finishedQuantity: number) => {
      const formula: any = component.quantity_formula_id ? formulaById.get(String(component.quantity_formula_id)) : null;
      const base = formula
        ? roundProductionFormula(evaluateProductionFormula(formula.expression, {
            ...(specificationByItem.get(String(finishedItemId)) || {}),
            quantity: Number(finishedQuantity || 0), finished_quantity: Number(finishedQuantity || 0),
          }), formula.rounding_mode, formula.decimal_places)
        : scaleBomLineQuantity(
            component,
            Number(finishedQuantity || 0),
            Number(bomById.get(String(component.bom_id))?.output_quantity || 1),
          );
      return base * (1 + Number(component.scrap_percentage || 0) / 100);
    };
    const bomComponentsByItem = new Map<string, any[]>();
    for (const line of salesBomLineResult.data || []) {
      const parent = bomById.get(String(line.bom_id));
      if (!parent) continue;
      const childHeader = line.child_bom_id
        ? bomById.get(String(line.child_bom_id))
        : null;
      const componentItemId = String(
        line.item_id || childHeader?.item_id || "",
      );
      if (!componentItemId) continue;
      const parentItemId = String(parent.item_id);
      bomComponentsByItem.set(parentItemId, [
        ...(bomComponentsByItem.get(parentItemId) || []),
        {
          ...line,
          item_id: componentItemId,
          selected_bom_id: parent.id,
          selected_bom_version: parent.version,
          selected_bom_approved_at: parent.approved_at || null,
          bom_output_quantity: Number(parent.output_quantity || 1),
        },
      ]);
    }
    this.assertAcyclicBomGraph(bomComponentsByItem);
    const salesComponentDemands = salesDemands.flatMap((demand: any) => {
      const finishedItemId = String(demand.line.item_id);
      return (bomComponentsByItem.get(finishedItemId) || [])
        .map((component: any) => ({
          item_id: String(component.item_id),
          required_quantity: calculatedRequirement(component, finishedItemId, demand.uncovered_quantity),
          demand_reference: {
            source_type: "SALES_ORDER",
            sales_order_id: demand.order.id,
            sales_order_item_id: demand.line.id,
            sales_order_number: demand.order.so_number,
            finished_item_id: demand.line.item_id,
            finished_quantity: demand.uncovered_quantity,
            required_quantity: calculatedRequirement(component, finishedItemId, demand.uncovered_quantity),
            parent_item_id: finishedItemId,
            bom_level: 1,
            bom_id: component.selected_bom_id,
            bom_version: component.selected_bom_version,
            bom_approved_at: component.selected_bom_approved_at,
            due_date: demand.due_date || null,
          },
        }))
        .filter((component: any) => component.required_quantity > 0);
    });
    const forecastComponentDemands = forecastDemands.flatMap((demand: any) => {
      const finishedItemId = String(demand.item_id);
      return (bomComponentsByItem.get(finishedItemId) || [])
        .map((component: any) => ({
          item_id: String(component.item_id),
          required_quantity: calculatedRequirement(component, finishedItemId, demand.required_quantity),
          demand_reference: {
            source_type: "APPROVED_FORECAST",
            demand_plan_cycle_id: demand.demand_plan_cycle_id,
            demand_plan_cycle_name: demand.demand_plan_cycle_name,
            demand_plan_line_id: demand.demand_plan_line_id,
            forecast_month: demand.forecast_month,
            forecast_quantity: demand.forecast_quantity,
            sales_consumed_quantity: demand.sales_consumed_quantity,
            residual_forecast_quantity: demand.residual_forecast_quantity,
            forecast_accuracy_pct: demand.forecast_accuracy_pct,
            finished_item_id: demand.item_id,
            finished_quantity: demand.required_quantity,
            required_quantity: calculatedRequirement(component, finishedItemId, demand.required_quantity),
            parent_item_id: finishedItemId,
            bom_level: 1,
            bom_id: component.selected_bom_id,
            bom_version: component.selected_bom_version,
            bom_approved_at: component.selected_bom_approved_at,
            customer_due_date: demand.due_date,
            due_date: demand.due_date,
          },
        }))
        .filter((component: any) => component.required_quantity > 0);
    });
    const projectComponentDemands = projectDemands.flatMap((demand: any) => {
      const finishedItemId = String(demand.item_id);
      return (bomComponentsByItem.get(finishedItemId) || []).map((component: any) => ({
        item_id: String(component.item_id),
        required_quantity: calculatedRequirement(component, finishedItemId, demand.uncovered_quantity),
        demand_reference: {
          source_type: "PROJECT_WORK_PACKAGE",
          project_id: demand.project_id,
          work_package_id: demand.work_package_id,
          work_package_line_id: demand.id,
          work_package_line_number: demand.line_number,
          finished_item_id: demand.item_id,
          finished_quantity: demand.uncovered_quantity,
          required_quantity: calculatedRequirement(component, finishedItemId, demand.uncovered_quantity),
          parent_item_id: finishedItemId,
          bom_level: 1,
          bom_id: component.selected_bom_id,
          bom_version: component.selected_bom_version,
          bom_approved_at: component.selected_bom_approved_at,
          due_date: demand.due_date,
        },
      })).filter((component: any) => component.required_quantity > 0);
    });
    const salesFinishedItemIds = salesDemands
      .map((demand: any) => String(demand.line.item_id || ""))
      .filter(Boolean);
    const initialItemIds = Array.from(
      new Set(
        [
          ...materials.map((material: any) =>
            String(material.selected_variant_id || material.item_id || ""),
          ),
          ...salesComponentDemands.map((component: any) =>
            String(component.item_id || ""),
          ),
          ...salesFinishedItemIds,
          ...forecastComponentDemands.map((component: any) =>
            String(component.item_id || ""),
          ),
          ...projectComponentDemands.map((component: any) => String(component.item_id || "")),
          ...projectDemands.map((demand: any) => String(demand.item_id || "")),
          ...forecastDemands.map((demand: any) => String(demand.item_id || "")),
        ].filter(Boolean),
      ),
    );
    const reachableItemIds = new Set(initialItemIds);
    const pendingItemIds = [...initialItemIds];
    while (pendingItemIds.length) {
      const parentItemId = pendingItemIds.shift()!;
      for (const component of bomComponentsByItem.get(parentItemId) || []) {
        const componentItemId = String(component.item_id || "");
        if (!componentItemId || reachableItemIds.has(componentItemId)) continue;
        reachableItemIds.add(componentItemId);
        pendingItemIds.push(componentItemId);
      }
    }
    const itemIds = Array.from(reachableItemIds);
    const [
      entriesResult,
      inventoryResult,
      itemResult,
      bomResult,
      policyResult,
      poResult,
      requisitionResult,
      purchasePipelineOrderResult,
      reservationResult,
    ] = await Promise.all([
      itemIds.length
        ? this.supabase
            .from("stock_entries")
            .select("item_id,available_quantity")
            .eq("tenant_id", tenantId)
            .in("item_id", itemIds)
            .gt("available_quantity", 0)
        : Promise.resolve({ data: [] as any[] }),
      itemIds.length
        ? this.supabase
            .from("inventory_stock")
            .select("item_id,quantity,reserved_quantity,available_quantity")
            .eq("tenant_id", tenantId)
            .in("item_id", itemIds)
        : Promise.resolve({ data: [] as any[] }),
      itemIds.length
        ? this.supabase
            .from("items")
            .select("id,code,name,lead_time_days")
            .eq("tenant_id", tenantId)
            .in("id", itemIds)
        : Promise.resolve({ data: [] as any[] }),
      itemIds.length
        ? this.supabase
            .from("bom_headers")
            .select(
              "id,item_id,version,is_active,lifecycle_status,effective_from,effective_to",
            )
            .eq("tenant_id", tenantId)
            .in("item_id", itemIds)
        : Promise.resolve({ data: [] as any[] }),
      itemIds.length
        ? this.supabase
            .from("production_item_planning_policies")
            .select("*")
            .eq("tenant_id", tenantId)
            .in("item_id", itemIds)
        : Promise.resolve({ data: [] as any[] }),
      this.supabase
        .from("purchase_orders")
        .select("id,po_number,status,delivery_date")
        .eq("tenant_id", tenantId)
        .in("status", ["APPROVED", "PARTIAL"]),
      this.supabase
        .from("purchase_requisitions")
        .select(
          "id,pr_number,status,purpose,required_date,purchase_requisition_items(id,item_id,requested_qty,required_date)",
        )
        .eq("tenant_id", tenantId)
        .in("status", ["DRAFT", "SUBMITTED", "APPROVED"]),
      this.supabase
        .from("purchase_orders")
        .select(
          "id,po_number,status,pr_id,delivery_date,purchase_order_items(id,pr_item_id,item_id,ordered_qty,received_qty,delivery_date)",
        )
        .eq("tenant_id", tenantId)
        .in("status", ["DRAFT", "PENDING", "APPROVED", "PARTIAL"]),
      itemIds.length
        ? this.supabase
            .from("stock_reservations")
            .select(
              "id,item_id,warehouse_id,reserved_quantity,reference_type,reference_id,reference_number,expires_at,released",
            )
            .eq("tenant_id", tenantId)
            .eq("released", false)
            .in("item_id", itemIds)
        : Promise.resolve({ data: [] as any[], error: null }),
    ]);
    for (const result of [
      entriesResult,
      inventoryResult,
      itemResult,
      bomResult,
      policyResult,
      poResult,
      requisitionResult,
      purchasePipelineOrderResult,
      reservationResult,
    ]) {
      if (result.error) throw new BadRequestException(result.error.message);
    }
    const quantityByItem = (rows: any[]) =>
      rows.reduce(
        (map, row) =>
          map.set(
            String(row.item_id),
            (map.get(String(row.item_id)) || 0) +
              Number(row.available_quantity || 0),
          ),
        new Map<string, number>(),
      );
    const entryQty = quantityByItem(entriesResult.data || []);
    const inScopeReferenceIds = new Set([
      ...safeOrders.map((order: any) => String(order.id)),
      ...safeOrders
        .flatMap((order: any) => [
          order.sales_order_id,
          order.sales_order_item_id,
        ])
        .filter(Boolean)
        .map(String),
      ...eligibleSalesDemands.map((demand: any) => String(demand.order.id)),
      ...eligibleSalesDemands.map((demand: any) => String(demand.line.id)),
      ...projectDemands.map((demand: any) => String(demand.id)),
      ...activePrograms.map((program: any) => String(program.id)),
    ]);
    const reservationByItem = new Map(
      itemIds.map((itemId) => [
        itemId,
        this.reservationPosition(
          itemId,
          inventoryResult.data || [],
          entryQty.get(itemId) || 0,
          reservationResult.data || [],
          inScopeReferenceIds,
        ),
      ]),
    );
    const itemById = new Map(
      (itemResult.data || []).map((item: any) => [String(item.id), item]),
    );
    for (const component of [
      ...salesComponentDemands,
      ...forecastComponentDemands,
      ...projectComponentDemands,
    ]) {
      const reference = component.demand_reference;
      const finishedItem: any = itemById.get(
        String(reference.finished_item_id || ""),
      );
      const customerDueDate = reference.due_date || null;
      const finishedLeadDays = Math.max(
        0,
        Number(finishedItem?.lead_time_days || 0),
      );
      const finishedReleaseDate = this.subtractCalendarDays(
        customerDueDate,
        finishedLeadDays,
      );
      reference.customer_due_date = customerDueDate;
      reference.parent_required_by_date = customerDueDate;
      reference.parent_release_by_date = finishedReleaseDate;
      reference.parent_lead_time_days = finishedLeadDays;
      reference.due_date = finishedReleaseDate || customerDueDate;
    }
    const policyByItem = new Map(
      (policyResult.data || []).map((row: any) => [String(row.item_id), row]),
    );
    const alternateItemIds = Array.from(
      new Set(
        (policyResult.data || [])
          .flatMap((policy: any) =>
            Array.isArray(policy.alternate_item_ids)
              ? policy.alternate_item_ids.map(String)
              : [],
          )
          .filter(Boolean),
      ),
    );
    const [
      alternateItemResult,
      alternateInventoryResult,
      alternateEntryResult,
      alternateReservationResult,
    ] = alternateItemIds.length
      ? await Promise.all([
          this.supabase
            .from("items")
            .select("id,code,name,lead_time_days")
            .eq("tenant_id", tenantId)
            .in("id", alternateItemIds),
          this.supabase
            .from("inventory_stock")
            .select("item_id,quantity,reserved_quantity,available_quantity")
            .eq("tenant_id", tenantId)
            .in("item_id", alternateItemIds),
          this.supabase
            .from("stock_entries")
            .select("item_id,available_quantity")
            .eq("tenant_id", tenantId)
            .in("item_id", alternateItemIds)
            .gt("available_quantity", 0),
          this.supabase
            .from("stock_reservations")
            .select(
              "id,item_id,warehouse_id,reserved_quantity,reference_type,reference_id,reference_number,expires_at,released",
            )
            .eq("tenant_id", tenantId)
            .eq("released", false)
            .in("item_id", alternateItemIds),
        ])
      : ([
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null },
        ] as any);
    for (const result of [
      alternateItemResult,
      alternateInventoryResult,
      alternateEntryResult,
      alternateReservationResult,
    ])
      if (result.error) throw new BadRequestException(result.error.message);
    const alternateItems = new Map<string, any>(
      (alternateItemResult.data || []).map((item: any) => [
        String(item.id),
        item,
      ]),
    );
    const alternateEntryQty = quantityByItem(alternateEntryResult.data || []);
    const alternateAvailability = new Map<string, number>(
      alternateItemIds.map((itemId) => [
        itemId,
        this.reservationPosition(
          itemId,
          alternateInventoryResult.data || [],
          alternateEntryQty.get(itemId) || 0,
          alternateReservationResult.data || [],
          new Set<string>(),
        ).usable_quantity,
      ]),
    );
    const buildable = new Set(
      Array.from(
        this.effectiveBomRevisions(
          bomResult.data || [],
          planningDate,
        ).selectedByItem.keys(),
      ),
    );
    const openPoIds = (poResult.data || []).map((po: any) => po.id);
    const poById = new Map(
      (poResult.data || []).map((po: any) => [String(po.id), po]),
    );
    const { data: poItems } = openPoIds.length
      ? await this.supabase
          .from("purchase_order_items")
          .select(
            "id,po_id,item_id,item_code,ordered_qty,received_qty,delivery_date",
          )
          .in("po_id", openPoIds)
      : { data: [] as any[] };
    const scheduledByItem = new Map<string, number>();
    const receiptDatesByItem = new Map<string, string[]>();
    const scheduledPurchaseReceipts = new Map<string, MrpSupplyReceipt[]>();
    for (const row of poItems || []) {
      const key = String(row.item_id || "");
      if (!key || !itemIds.includes(key)) continue;
      const open = Math.max(
        0,
        Number(row.ordered_qty || 0) - Number(row.received_qty || 0),
      );
      scheduledByItem.set(key, (scheduledByItem.get(key) || 0) + open);
      const receiptDate =
        row.delivery_date || poById.get(String(row.po_id))?.delivery_date;
      scheduledPurchaseReceipts.set(key, [
        ...(scheduledPurchaseReceipts.get(key) || []),
        {
          quantity: open,
          date: receiptDate ? String(receiptDate).slice(0, 10) : null,
          document_type: "PURCHASE_ORDER",
          document_id: String(row.po_id),
          document_number: String(
            poById.get(String(row.po_id))?.po_number || row.po_id,
          ),
          document_line_id: row.id ? String(row.id) : null,
          status: String(poById.get(String(row.po_id))?.status || ""),
        },
      ]);
      if (receiptDate)
        receiptDatesByItem.set(key, [
          ...(receiptDatesByItem.get(key) || []),
          String(receiptDate).slice(0, 10),
        ]);
    }
    const productionSupply = this.productionSupply(safeOrders, itemIds);
    const purchasePipeline = this.purchasePipeline(
      requisitionResult.data || [],
      purchasePipelineOrderResult.data || [],
      itemIds,
    );
    const orderById = new Map(
      safeOrders.map((order: any) => [String(order.id), order]),
    );
    const aggregate = new Map<string, any>();
    for (const material of materials as any[]) {
      const itemId = String(
        material.selected_variant_id || material.item_id || "",
      );
      if (!itemId) continue;
      const existing = aggregate.get(itemId) || {
        item_id: itemId,
        gross_requirement: 0,
        issued_quantity: 0,
        demand_references: [],
      };
      existing.gross_requirement += Number(material.required_quantity || 0);
      existing.issued_quantity += Number(material.issued_quantity || 0);
      const order = orderById.get(String(material.job_order_id));
      if (order)
        existing.demand_references.push({
          source_type: "JOB_ORDER",
          job_order_id: order.id,
          job_order_number: order.job_order_number,
          status: order.status,
          required_quantity: Number(material.required_quantity || 0),
          job_order_due_date: order.end_date || order.due_date || null,
          parent_required_by_date:
            order.start_date || order.end_date || order.due_date || null,
          due_date:
            order.start_date || order.end_date || order.due_date || null,
          bom_level: 1,
        });
      aggregate.set(itemId, existing);
    }
    for (const component of salesComponentDemands) {
      const existing = aggregate.get(component.item_id) || {
        item_id: component.item_id,
        gross_requirement: 0,
        issued_quantity: 0,
        demand_references: [],
      };
      existing.gross_requirement += Number(component.required_quantity || 0);
      existing.demand_references.push(component.demand_reference);
      aggregate.set(component.item_id, existing);
    }
    for (const component of forecastComponentDemands) {
      const existing = aggregate.get(component.item_id) || {
        item_id: component.item_id,
        gross_requirement: 0,
        issued_quantity: 0,
        demand_references: [],
      };
      existing.gross_requirement += Number(component.required_quantity || 0);
      existing.demand_references.push(component.demand_reference);
      aggregate.set(component.item_id, existing);
    }
    for (const component of projectComponentDemands) {
      const existing = aggregate.get(component.item_id) || { item_id: component.item_id, gross_requirement: 0, issued_quantity: 0, demand_references: [] };
      existing.gross_requirement += Number(component.required_quantity || 0);
      existing.demand_references.push(component.demand_reference);
      aggregate.set(component.item_id, existing);
    }
    const calculateLinePlan = (line: any) => {
      const reservationPosition: any = reservationByItem.get(line.item_id) || {
        physical_quantity: 0,
        unreserved_quantity: 0,
        usable_quantity: 0,
        ledger_reserved_quantity: 0,
        active_reserved_quantity: 0,
        reserved_for_plan_quantity: 0,
        reserved_elsewhere_quantity: 0,
        reservation_mismatch_quantity: 0,
        reservation_evidence: [],
      };
      const available = Number(reservationPosition.usable_quantity || 0);
      const gross = Number(line.gross_requirement.toFixed(4));
      const issued = Number(line.issued_quantity.toFixed(4));
      const item = itemById.get(line.item_id);
      const policy: any = policyByItem.get(line.item_id) || {};
      const requiredDates = line.demand_references
        .map((ref: any) => ref.due_date)
        .filter(Boolean)
        .sort();
      const demandRequiredBy = requiredDates[0] || null;
      const leadDays = Math.max(0, Number(item?.lead_time_days || 0));
      const forecastAccuracyValues = (line.demand_references || [])
        .map((reference: any) => Number(reference.forecast_accuracy_pct))
        .filter(Number.isFinite);
      const safetyPosition = this.safetyStockPosition(
        policy,
        gross,
        leadDays,
        forecastAccuracyValues,
      );
      const safety = safetyPosition.protected_quantity;
      const minimum = Number(policy.minimum_order_quantity || 0);
      const multiple = Number(policy.order_multiple || policy.pack_size || 0);
      const demandEvents = (line.demand_references || [])
        .map((reference: any) => ({
          quantity: Math.max(0, Number(reference.required_quantity || 0)),
          dueDate: reference.due_date || null,
          reference,
        }))
        .filter((event: any) => event.quantity > 0);
      const referencedDemand = demandEvents.reduce(
        (sum: number, event: any) => sum + event.quantity,
        0,
      );
      if (referencedDemand < gross)
        demandEvents.push({
          quantity: Number((gross - referencedDemand).toFixed(4)),
          dueDate: demandRequiredBy,
          reference: null,
        });
      const receipts = [
        ...(scheduledPurchaseReceipts.get(line.item_id) || []).map(
          (receipt) => ({ ...receipt, source: "OPEN_PO" as const }),
        ),
        ...(productionSupply.receipts.get(line.item_id) || []).map(
          (receipt) => ({ ...receipt, source: "OPEN_BUILD" as const }),
        ),
        ...(purchasePipeline.requisitionReceipts.get(line.item_id) || []).map(
          (receipt) => ({ ...receipt, source: "OPEN_PR" as const }),
        ),
        ...(purchasePipeline.draftOrderReceipts.get(line.item_id) || []).map(
          (receipt) => ({ ...receipt, source: "DRAFT_PO" as const }),
        ),
      ];
      const timePlan = this.projectTimeBuckets(demandEvents, receipts, {
        initialSupply: available + issued,
        safetyStock: safety,
        minimumOrderQuantity: minimum,
        orderMultiple: multiple,
      });
      const scheduledPurchase = Number(timePlan.onTimeBySource.OPEN_PO || 0);
      const scheduledProduction = Number(
        timePlan.onTimeBySource.OPEN_BUILD || 0,
      );
      const openRequisition = Number(timePlan.onTimeBySource.OPEN_PR || 0);
      const openDraftPo = Number(timePlan.onTimeBySource.DRAFT_PO || 0);
      const scheduled = Number(
        (scheduledPurchase + scheduledProduction).toFixed(4),
      );
      const rescheduleQuantity = timePlan.rescheduleQuantity;
      const confirmDateQuantity = timePlan.confirmDateQuantity;
      const newSupplyRequirement = timePlan.rawNewSupplyRequirement;
      const recommended = timePlan.recommendedSupplyQuantity;
      const net = timePlan.timingGapQuantity;
      const lateSupply = rescheduleQuantity;
      const undatedSupply = timePlan.undatedSupplyQuantity;
      const scheduledPurchasePhase = {
        late: Number(timePlan.rescheduleBySource.OPEN_PO || 0),
      };
      const scheduledProductionPhase = {
        late: Number(timePlan.rescheduleBySource.OPEN_BUILD || 0),
      };
      const requisitionPhase = {
        late: Number(timePlan.rescheduleBySource.OPEN_PR || 0),
      };
      const draftPoPhase = {
        late: Number(timePlan.rescheduleBySource.DRAFT_PO || 0),
      };
      const requiredBy =
        timePlan.buckets.find(
          (bucket: any) => bucket.recommended_supply_quantity > 0,
        )?.required_by_date || demandRequiredBy;
      const releaseBy = this.subtractCalendarDays(requiredBy, leadDays);
      const procurementType = String(
        policy.procurement_type || "AUTO",
      ).toUpperCase();
      const substitutionCandidates = this.substitutionCandidates(
        policy,
        newSupplyRequirement,
        alternateItems,
        alternateAvailability,
      );
      const maximumStock =
        policy.maximum_stock == null
          ? null
          : Math.max(0, Number(policy.maximum_stock));
      const roundingExcess = Math.max(
        0,
        Number((recommended - newSupplyRequirement).toFixed(4)),
      );
      const maximumStockConflict = Boolean(
        maximumStock != null &&
        Number(timePlan.projectedAvailableQuantity || 0) > maximumStock,
      );
      const lotSizingPolicy =
        maximumStock != null
          ? "MIN_MAX"
          : multiple > 0
            ? "ORDER_MULTIPLE"
            : minimum > 0
              ? "MINIMUM_LOT"
              : "LOT_FOR_LOT";
      const shelfLifeDays = Math.max(0, Number(policy.shelf_life_days || 0));
      const minimumRemainingShelfLifeDays = Math.max(
        0,
        Number(policy.minimum_remaining_shelf_life_days || 0),
      );
      const shelfLifeRisk = Boolean(
        newSupplyRequirement > 0 &&
        shelfLifeDays > 0 &&
        leadDays + minimumRemainingShelfLifeDays >= shelfLifeDays,
      );
      const action =
        newSupplyRequirement <= 0
          ? "MONITOR"
          : procurementType === "TRANSFER"
            ? "MONITOR"
            : procurementType === "BUY"
              ? "BUY"
              : procurementType === "MAKE"
                ? "BUILD"
                : buildable.has(line.item_id)
                  ? "BUILD"
                  : "BUY";
      const intervention =
        procurementType === "TRANSFER" && newSupplyRequirement > 0
          ? "TRANSFER_SOURCE_REQUIRED"
          : substitutionCandidates.length > 0 && newSupplyRequirement > 0
            ? "REVIEW_APPROVED_SUBSTITUTION"
            : rescheduleQuantity > 0 && newSupplyRequirement > 0
              ? "RESCHEDULE_AND_CREATE_SUPPLY"
              : rescheduleQuantity > 0
                ? "RESCHEDULE_EXISTING_SUPPLY"
                : confirmDateQuantity > 0 && newSupplyRequirement > 0
                  ? "CONFIRM_DATE_AND_CREATE_SUPPLY"
                  : confirmDateQuantity > 0
                    ? "CONFIRM_EXISTING_SUPPLY_DATE"
                    : newSupplyRequirement > 0
                      ? "CREATE_NEW_SUPPLY"
                      : "MONITOR";
      return {
        available,
        reservationPosition,
        gross,
        issued,
        item,
        policy,
        safetyPosition,
        substitutionCandidates,
        maximumStock,
        maximumStockConflict,
        roundingExcess,
        lotSizingPolicy,
        shelfLifeDays,
        minimumRemainingShelfLifeDays,
        shelfLifeRisk,
        scheduledPurchase,
        scheduledProduction,
        openRequisition,
        openDraftPo,
        scheduledPurchasePhase,
        scheduledProductionPhase,
        requisitionPhase,
        draftPoPhase,
        scheduled,
        lateSupply,
        undatedSupply,
        safety,
        net,
        rescheduleQuantity,
        confirmDateQuantity,
        newSupplyRequirement,
        recommended,
        requiredBy,
        releaseBy,
        leadDays,
        action,
        intervention,
        timePlan,
        demandRequiredBy,
      };
    };

    this.explodeMultiLevelDemand(
      aggregate,
      bomComponentsByItem,
      calculateLinePlan,
    );

    const lines = Array.from(aggregate.values()).map((line) => {
      const {
        available,
        reservationPosition,
        gross,
        issued,
        item,
        policy,
        safetyPosition,
        substitutionCandidates,
        maximumStock,
        maximumStockConflict,
        roundingExcess,
        lotSizingPolicy,
        shelfLifeDays,
        minimumRemainingShelfLifeDays,
        shelfLifeRisk,
        scheduledPurchase,
        scheduledProduction,
        openRequisition,
        openDraftPo,
        scheduledPurchasePhase,
        scheduledProductionPhase,
        requisitionPhase,
        draftPoPhase,
        scheduled,
        lateSupply,
        undatedSupply,
        safety,
        net,
        rescheduleQuantity,
        confirmDateQuantity,
        newSupplyRequirement,
        recommended,
        requiredBy,
        releaseBy,
        leadDays,
        action,
        intervention,
        timePlan,
        demandRequiredBy,
      } = calculateLinePlan(line);
      const exceptions = [] as string[];
      if (!requiredBy) exceptions.push("MISSING_REQUIREMENT_DATE");
      if (net > 0) exceptions.push("SUPPLY_TIMING_GAP");
      if (newSupplyRequirement > 0) exceptions.push("MATERIAL_SHORTAGE");
      if (rescheduleQuantity > 0) exceptions.push("RESCHEDULE_IN");
      if (confirmDateQuantity > 0) exceptions.push("CONFIRM_SUPPLY_DATE");
      if (releaseBy && releaseBy < new Date().toISOString().slice(0, 10))
        exceptions.push("RELEASE_OVERDUE");
      if (scheduledPurchasePhase.late > 0)
        exceptions.push("LATE_SCHEDULED_RECEIPT");
      if (scheduledProductionPhase.late > 0)
        exceptions.push("LATE_PRODUCTION_RECEIPT");
      if (requisitionPhase.late + draftPoPhase.late > 0)
        exceptions.push("LATE_PURCHASE_PIPELINE");
      if (undatedSupply > 0) exceptions.push("UNDATED_SUPPLY");
      if (timePlan.unpeggedSupplyQuantity > 0)
        exceptions.push("UNPEGGED_DOCUMENT_SUPPLY");
      if (
        reservationPosition.reserved_elsewhere_quantity > 0 &&
        newSupplyRequirement > 0
      )
        exceptions.push("STOCK_COMMITTED_ELSEWHERE");
      if (reservationPosition.reservation_mismatch_quantity > 0.0001)
        exceptions.push("RESERVATION_LEDGER_MISMATCH");
      if (substitutionCandidates.length > 0 && newSupplyRequirement > 0)
        exceptions.push("APPROVED_SUBSTITUTE_AVAILABLE");
      if (maximumStockConflict) exceptions.push("MAXIMUM_STOCK_CONFLICT");
      if (shelfLifeRisk) exceptions.push("SHELF_LIFE_POLICY_RISK");
      if (
        String(policy.batch_constraint || "NONE") === "SINGLE_BATCH" &&
        newSupplyRequirement > 0
      )
        exceptions.push("SINGLE_BATCH_SOURCE_REQUIRED");
      if (
        String(policy.procurement_type || "AUTO").toUpperCase() ===
          "TRANSFER" &&
        newSupplyRequirement > 0
      )
        exceptions.push("TRANSFER_SOURCE_REQUIRED");
      const demandMix = (line.demand_references || []).reduce(
        (mix: Record<string, number>, reference: any) => {
          const source = String(reference.source_type || "OTHER");
          mix[source] = Number(
            (
              (mix[source] || 0) +
              Math.max(0, Number(reference.required_quantity || 0))
            ).toFixed(4),
          );
          return mix;
        },
        {},
      );
      return {
        tenant_id: tenantId,
        item_id: line.item_id,
        item_code: item?.code || null,
        item_name: item?.name || null,
        gross_requirement: gross,
        issued_quantity: issued,
        available_quantity: Number(available.toFixed(4)),
        scheduled_receipt_quantity: scheduled,
        safety_stock_quantity: Number(safety.toFixed(4)),
        net_requirement: net,
        recommended_quantity: recommended,
        required_by_date: requiredBy,
        release_by_date: releaseBy,
        lead_time_days: leadDays,
        planning_policy: {
          ...policy,
          scheduled_purchase_quantity: scheduledPurchase,
          scheduled_production_quantity: scheduledProduction,
          open_requisition_quantity: openRequisition,
          open_draft_po_quantity: openDraftPo,
          late_supply_quantity: lateSupply,
          undated_supply_quantity: undatedSupply,
          reschedule_quantity: rescheduleQuantity,
          confirm_date_quantity: confirmDateQuantity,
          new_supply_requirement: newSupplyRequirement,
          recommended_intervention: intervention,
          projected_available_quantity: timePlan.projectedAvailableQuantity,
          earliest_demand_date: demandRequiredBy,
          time_buckets: timePlan.buckets,
          supply_interventions: timePlan.supplyInterventions,
          demand_supply_pegging: timePlan.demandSupplyPegging,
          demand_mix: demandMix,
          forecast_consumption: forecastConsumptionSummary,
          approved_forecast_quantity: Number(
            (demandMix.APPROVED_FORECAST || 0).toFixed(4),
          ),
          physical_stock_quantity: reservationPosition.physical_quantity,
          unreserved_stock_quantity: reservationPosition.unreserved_quantity,
          active_reserved_quantity:
            reservationPosition.active_reserved_quantity,
          ledger_reserved_quantity:
            reservationPosition.ledger_reserved_quantity,
          reserved_for_plan_quantity:
            reservationPosition.reserved_for_plan_quantity,
          reserved_elsewhere_quantity:
            reservationPosition.reserved_elsewhere_quantity,
          reservation_mismatch_quantity:
            reservationPosition.reservation_mismatch_quantity,
          reservation_evidence: reservationPosition.reservation_evidence,
          safety_stock_calculation: safetyPosition,
          lot_sizing_policy: lotSizingPolicy,
          rounding_excess_quantity: roundingExcess,
          maximum_stock_quantity: maximumStock,
          maximum_stock_conflict: maximumStockConflict,
          shelf_life_days: shelfLifeDays || null,
          minimum_remaining_shelf_life_days: minimumRemainingShelfLifeDays,
          shelf_life_policy_risk: shelfLifeRisk,
          batch_constraint: String(policy.batch_constraint || "NONE"),
          substitution_candidates: substitutionCandidates,
          substitution_approval_required:
            policy.substitution_approval_required !== false,
          planning_horizon: {
            start_date:
              timePlan.buckets[0]?.required_by_date || demandRequiredBy,
            end_date:
              timePlan.buckets[timePlan.buckets.length - 1]?.required_by_date ||
              demandRequiredBy,
            bucket_count: timePlan.buckets.length,
          },
          unpegged_supply_quantity: timePlan.unpeggedSupplyQuantity,
          unpegged_supply_documents: timePlan.unpeggedSupplyDocuments,
        },
        exception_codes: exceptions,
        supply_action: action,
        demand_references: line.demand_references,
      };
    });
    const { data: previousRun, error: previousRunError } = await this.supabase
      .from("mrp_planning_runs")
      .select("id,run_at")
      .eq("tenant_id", tenantId)
      .order("run_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (previousRunError)
      throw new BadRequestException(previousRunError.message);
    const previousLineResult = previousRun
      ? await this.supabase
          .from("mrp_planning_lines")
          .select("*")
          .eq("tenant_id", tenantId)
          .eq("run_id", previousRun.id)
      : { data: [] as any[], error: null };
    if (previousLineResult.error)
      throw new BadRequestException(previousLineResult.error.message);
    const previousByItem = new Map(
      (previousLineResult.data || []).map((line: any) => [
        String(line.item_id),
        line,
      ]),
    );
    const comparisonDate = new Date().toISOString().slice(0, 10);
    for (const line of lines) {
      const previous: any = previousByItem.get(String(line.item_id));
      const runChange = this.comparePlanningLine(
        line,
        previous,
        comparisonDate,
      );
      line.planning_policy = {
        ...line.planning_policy,
        run_change: runChange,
      };
      if (runChange.requires_planner_reapproval)
        line.exception_codes = Array.from(
          new Set([
            ...(line.exception_codes || []),
            "PLANNING_TIME_FENCE_CHANGE",
          ]),
        );
    }
    const { data: run, error: runError } = await this.supabase
      .from("mrp_planning_runs")
      .insert({
        tenant_id: tenantId,
        created_by: userId || null,
        demand_orders:
          safeOrders.length +
          salesDemands.length +
          forecastConsumptionSummary.residual_buckets +
          projectDemands.length,
        material_lines: lines.length,
        shortage_lines: lines.filter((line) => line.net_requirement > 0).length,
      })
      .select()
      .single();
    if (runError || !run)
      throw new BadRequestException(
        runError?.message || "Unable to save the MRP run.",
      );
    if (lines.length) {
      const { error: lineError } = await this.supabase
        .from("mrp_planning_lines")
        .insert(lines.map((line) => ({ ...line, run_id: run.id })));
      if (lineError) throw new BadRequestException(lineError.message);
    }
    const latest = await this.latest(tenantId);
    await this.exceptions.syncPlan(tenantId, latest);
    return latest;
  }

  async decide(tenantId: string, userId: string, lineId: string, input: any) {
    const decision = String(input?.decision || "").toUpperCase();
    if (!["APPROVED", "CHANGED", "DEFERRED", "REJECTED"].includes(decision))
      throw new BadRequestException("Select a valid planner decision.");
    const { data: line, error: lineError } = await this.supabase
      .from("mrp_planning_lines")
      .select("id,run_id,recommended_quantity,required_by_date,supply_action")
      .eq("tenant_id", tenantId)
      .eq("id", lineId)
      .maybeSingle();
    if (lineError) throw new BadRequestException(lineError.message);
    if (!line)
      throw new BadRequestException("MRP planning line was not found.");
    await this.assertDecisionIsNotReleased(
      tenantId,
      String(line.run_id),
      String(line.id),
    );
    const reason = String(input?.reason || "").trim();
    if (decision !== "APPROVED" && !reason)
      throw new BadRequestException(
        "Enter a reason for changing, deferring or rejecting the recommendation.",
      );
    const adjusted =
      input?.adjusted_quantity === "" || input?.adjusted_quantity == null
        ? null
        : Number(input.adjusted_quantity);
    if (adjusted != null && (!Number.isFinite(adjusted) || adjusted < 0))
      throw new BadRequestException(
        "Adjusted quantity must be zero or greater.",
      );
    const adjustedDate =
      String(input?.adjusted_required_by_date || "").trim() || null;
    if (adjustedDate && !/^\d{4}-\d{2}-\d{2}$/.test(adjustedDate))
      throw new BadRequestException(
        "Adjusted required date must use YYYY-MM-DD.",
      );
    if (adjustedDate && adjustedDate < new Date().toISOString().slice(0, 10))
      throw new BadRequestException(
        "Adjusted required date cannot be in the past.",
      );
    const supplierId =
      String(input?.preferred_supplier_id || "").trim() || null;
    const workCentreId =
      String(input?.preferred_work_centre_id || "").trim() || null;
    if (supplierId && line.supply_action !== "BUY")
      throw new BadRequestException(
        "A preferred supplier can only be selected for a BUY recommendation.",
      );
    if (workCentreId && line.supply_action !== "BUILD")
      throw new BadRequestException(
        "A preferred work centre can only be selected for a BUILD recommendation.",
      );
    if (supplierId) {
      const { data: supplier, error: supplierError } = await this.supabase
        .from("vendors")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("id", supplierId)
        .eq("is_active", true)
        .maybeSingle();
      if (supplierError) throw new BadRequestException(supplierError.message);
      if (!supplier)
        throw new BadRequestException(
          "Select an active supplier belonging to this tenant.",
        );
    }
    if (workCentreId) {
      const { data: workCentre, error: workCentreError } = await this.supabase
        .from("work_stations")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("id", workCentreId)
        .eq("is_active", true)
        .maybeSingle();
      if (workCentreError)
        throw new BadRequestException(workCentreError.message);
      if (!workCentre)
        throw new BadRequestException(
          "Select an active work centre belonging to this tenant.",
        );
    }
    if (
      decision === "CHANGED" &&
      adjusted == null &&
      !adjustedDate &&
      !supplierId &&
      !workCentreId
    )
      throw new BadRequestException(
        "Change quantity, required date, supplier or work centre before saving a changed recommendation.",
      );
    const keepsOverrides = ["APPROVED", "CHANGED"].includes(decision);
    const row = {
      tenant_id: tenantId,
      run_id: line.run_id,
      line_id: line.id,
      decision,
      adjusted_quantity: keepsOverrides ? adjusted : null,
      adjusted_required_by_date: keepsOverrides ? adjustedDate : null,
      preferred_supplier_id: keepsOverrides ? supplierId : null,
      preferred_work_centre_id: keepsOverrides ? workCentreId : null,
      reason: reason || null,
      decided_by: userId,
      decided_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const { error } = await this.supabase
      .from("mrp_planner_decisions")
      .upsert(row, { onConflict: "tenant_id,line_id" });
    if (error) throw new BadRequestException(error.message);
    const latest = await this.latest(tenantId);
    await this.exceptions.syncPlan(tenantId, latest);
    return latest;
  }
}
