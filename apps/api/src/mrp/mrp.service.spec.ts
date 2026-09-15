import { BadRequestException } from "@nestjs/common";
import { MrpService } from "./mrp.service";

describe("MrpService planner decisions", () => {
  let service: MrpService;
  const exceptions = { syncPlan: jest.fn() };

  const setLine = (line: Record<string, unknown>) => {
    const lineQuery: any = {
      eq: jest.fn(() => lineQuery),
      maybeSingle: jest.fn(async () => ({ data: line, error: null })),
    };
    const releaseQuery: any = {
      eq: jest.fn(() => releaseQuery),
      contains: jest.fn(() => releaseQuery),
      limit: jest.fn(async () => ({ data: [], error: null })),
    };
    (service as any).supabase = {
      from: jest.fn((table: string) => ({
        select: jest.fn(() =>
          table === "mrp_planning_lines" ? lineQuery : releaseQuery,
        ),
      })),
    };
  };

  beforeEach(() => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_KEY = "test-key";
    service = new MrpService(exceptions as any);
  });

  it("counts only unfinished open production as scheduled supply", () => {
    const supply = (service as any).productionSupply(
      [
        {
          item_id: "item-1",
          quantity: 100,
          completed_quantity: 25,
          due_date: "2026-09-10",
        },
        {
          item_id: "item-1",
          quantity: 20,
          completed_quantity: 20,
          due_date: "2026-09-08",
        },
        {
          item_id: "not-demanded",
          quantity: 500,
          completed_quantity: 0,
        },
      ],
      ["item-1"],
    );

    expect(supply.quantities.get("item-1")).toBe(75);
    expect(supply.quantities.has("not-demanded")).toBe(false);
    expect(supply.dates.get("item-1")).toEqual(["2026-09-10"]);
  });

  it("selects only the latest approved BOM revision effective on the planning date", () => {
    const result = (service as any).effectiveBomRevisions(
      [
        {
          id: "draft-v4",
          item_id: "finished-1",
          version: 4,
          lifecycle_status: "DRAFT",
          is_active: false,
          effective_from: "2026-08-01",
        },
        {
          id: "future-v3",
          item_id: "finished-1",
          version: 3,
          lifecycle_status: "APPROVED",
          is_active: true,
          effective_from: "2026-10-01",
        },
        {
          id: "current-v2",
          item_id: "finished-1",
          version: 2,
          lifecycle_status: "APPROVED",
          is_active: true,
          effective_from: "2026-08-01",
        },
        {
          id: "expired-v1",
          item_id: "finished-1",
          version: 1,
          lifecycle_status: "APPROVED",
          is_active: true,
          effective_from: "2026-01-01",
          effective_to: "2026-07-31",
        },
      ],
      "2026-08-30",
    );

    expect(result.eligible.map((row: any) => row.id)).toEqual(["current-v2"]);
    expect(result.selectedByItem.get("finished-1").id).toBe("current-v2");
  });

  it("nets only supply arriving on or before the material need date", () => {
    const phased = (service as any).timePhaseSupply(
      [
        { quantity: 20, date: "2026-09-09" },
        { quantity: 30, date: "2026-09-10" },
        { quantity: 40, date: "2026-09-11" },
        { quantity: 10, date: null },
      ],
      "2026-09-10",
    );

    expect(phased).toEqual({ onTime: 50, late: 40, undated: 10 });
  });

  it("uses late and undated supply as interventions before proposing duplicates", () => {
    expect((service as any).existingSupplyIntervention(100, 80, 30)).toEqual({
      rescheduleQuantity: 80,
      confirmDateQuantity: 20,
      newSupplyRequirement: 0,
    });
    expect((service as any).existingSupplyIntervention(100, 25, 15)).toEqual({
      rescheduleQuantity: 25,
      confirmDateQuantity: 15,
      newSupplyRequirement: 60,
    });
  });

  it("escalates a changed recommendation inside the policy-derived time fence", () => {
    const comparison = (service as any).comparePlanningLine(
      {
        recommended_quantity: 15,
        required_by_date: "2026-09-15",
        release_by_date: "2026-09-05",
        lead_time_days: 14,
        supply_action: "BUY",
        planning_policy: {
          recommended_intervention: "CREATE_NEW_SUPPLY",
        },
      },
      {
        id: "previous-line",
        run_id: "previous-run",
        recommended_quantity: 10,
        required_by_date: "2026-09-20",
        release_by_date: "2026-09-10",
        supply_action: "BUY",
        planning_policy: {
          recommended_intervention: "CREATE_NEW_SUPPLY",
        },
      },
      "2026-09-01",
    );

    expect(comparison).toMatchObject({
      previous_run_id: "previous-run",
      quantity_delta: 5,
      classification: "QUANTITY_INCREASED",
      planning_time_fence_days: 14,
      planning_time_fence_date: "2026-09-15",
      inside_time_fence: true,
      requires_planner_reapproval: true,
    });
    expect(comparison.change_codes).toEqual(
      expect.arrayContaining(["QUANTITY_INCREASED", "REQUIRED_DATE_ADVANCED"]),
    );
  });

  it("does not escalate an unchanged recommendation", () => {
    const line = {
      recommended_quantity: 10,
      required_by_date: "2026-10-20",
      release_by_date: "2026-10-10",
      lead_time_days: 7,
      supply_action: "BUY",
      planning_policy: {
        recommended_intervention: "CREATE_NEW_SUPPLY",
      },
    };
    const comparison = (service as any).comparePlanningLine(
      line,
      { ...line, id: "previous-line", run_id: "previous-run" },
      "2026-09-01",
    );

    expect(comparison.classification).toBe("UNCHANGED");
    expect(comparison.inside_time_fence).toBe(false);
    expect(comparison.requires_planner_reapproval).toBe(false);
  });

  it("identifies a recommendation resolved since the previous run", () => {
    const comparison = (service as any).comparePlanningLine(
      {
        recommended_quantity: 0,
        required_by_date: "2026-09-15",
        release_by_date: "2026-09-08",
        lead_time_days: 7,
        supply_action: "MONITOR",
        planning_policy: { recommended_intervention: "MONITOR" },
      },
      {
        id: "previous-line",
        run_id: "previous-run",
        recommended_quantity: 25,
        required_by_date: "2026-09-15",
        release_by_date: "2026-09-08",
        supply_action: "BUY",
        planning_policy: {
          recommended_intervention: "CREATE_NEW_SUPPLY",
        },
      },
      "2026-09-01",
    );

    expect(comparison.change_codes).toEqual(
      expect.arrayContaining([
        "RECOMMENDATION_RESOLVED",
        "SUPPLY_ACTION_CHANGED",
        "INTERVENTION_CHANGED",
      ]),
    );
    expect(comparison.requires_planner_reapproval).toBe(true);
  });

  it("uses each receipt once across chronological demand buckets", () => {
    const plan = (service as any).projectTimeBuckets(
      [
        { quantity: 80, dueDate: "2026-09-10" },
        { quantity: 30, dueDate: "2026-09-20" },
      ],
      [
        {
          quantity: 40,
          date: "2026-09-15",
          source: "OPEN_PO",
          document_type: "PURCHASE_ORDER",
          document_id: "po-1",
          document_number: "PO-2026-0001",
          document_line_id: "po-line-1",
          status: "APPROVED",
        },
      ],
      {
        initialSupply: 50,
        safetyStock: 0,
        minimumOrderQuantity: 0,
        orderMultiple: 0,
      },
    );

    expect(plan.rescheduleQuantity).toBe(30);
    expect(plan.rawNewSupplyRequirement).toBe(20);
    expect(plan.recommendedSupplyQuantity).toBe(20);
    expect(plan.supplyInterventions).toEqual([
      {
        intervention_type: "RESCHEDULE_IN",
        source: "OPEN_PO",
        document_type: "PURCHASE_ORDER",
        document_id: "po-1",
        document_number: "PO-2026-0001",
        document_line_id: "po-line-1",
        status: "APPROVED",
        current_date: "2026-09-15",
        required_date: "2026-09-10",
        quantity: 30,
      },
    ]);
    expect(plan.buckets[0].demand_supply_pegging).toEqual([
      expect.objectContaining({
        coverage_type: "INITIAL_SUPPLY",
        source: "ON_HAND_AND_ISSUED",
        quantity: 50,
      }),
      expect.objectContaining({
        coverage_type: "RESCHEDULE_IN",
        document_number: "PO-2026-0001",
        quantity: 30,
      }),
    ]);
    expect(plan.buckets[1].demand_supply_pegging).toEqual([
      expect.objectContaining({
        coverage_type: "ON_TIME_RECEIPT",
        document_number: "PO-2026-0001",
        quantity: 10,
      }),
      expect.objectContaining({
        coverage_type: "NEW_SUPPLY_RECOMMENDATION",
        source: "PLANNED_SUPPLY",
        quantity: 20,
      }),
    ]);
    expect(
      plan.demandSupplyPegging
        .filter((entry: any) => entry.document_number === "PO-2026-0001")
        .reduce((sum: number, entry: any) => sum + entry.quantity, 0),
    ).toBe(40);
    expect(plan.buckets).toEqual([
      expect.objectContaining({
        required_by_date: "2026-09-10",
        demand_quantity: 80,
        reschedule_quantity: 30,
        recommended_supply_quantity: 0,
        projected_available_quantity: 0,
      }),
      expect.objectContaining({
        required_by_date: "2026-09-20",
        demand_quantity: 30,
        on_time_supply_quantity: 10,
        recommended_supply_quantity: 20,
        projected_available_quantity: 0,
      }),
    ]);
  });

  it("pegs an undated supply confirmation to its exact requisition line", () => {
    const plan = (service as any).projectTimeBuckets(
      [{ quantity: 12, dueDate: "2026-09-10" }],
      [
        {
          quantity: 12,
          date: null,
          source: "OPEN_PR",
          document_type: "PURCHASE_REQUISITION",
          document_id: "pr-1",
          document_number: "PR-2026-0001",
          document_line_id: "pr-line-1",
          status: "APPROVED",
        },
      ],
      {
        initialSupply: 0,
        safetyStock: 0,
        minimumOrderQuantity: 0,
        orderMultiple: 0,
      },
    );

    expect(plan.confirmDateQuantity).toBe(12);
    expect(plan.supplyInterventions[0]).toMatchObject({
      intervention_type: "CONFIRM_DATE",
      document_number: "PR-2026-0001",
      document_line_id: "pr-line-1",
      required_date: "2026-09-10",
      quantity: 12,
    });
    expect(plan.demandSupplyPegging[0]).toMatchObject({
      coverage_type: "CONFIRM_DATE",
      document_number: "PR-2026-0001",
      required_by_date: "2026-09-10",
      quantity: 12,
    });
  });

  it("identifies document supply left after demand and safety stock coverage", () => {
    const plan = (service as any).projectTimeBuckets(
      [{ quantity: 10, dueDate: "2026-09-10" }],
      [
        {
          quantity: 40,
          date: "2026-09-10",
          source: "OPEN_PO",
          document_type: "PURCHASE_ORDER",
          document_id: "po-excess",
          document_number: "PO-2026-0099",
          document_line_id: "po-line-excess",
          status: "APPROVED",
        },
      ],
      {
        initialSupply: 0,
        safetyStock: 0,
        minimumOrderQuantity: 0,
        orderMultiple: 0,
      },
    );

    expect(plan.unpeggedSupplyQuantity).toBe(30);
    expect(plan.unpeggedSupplyDocuments).toEqual([
      expect.objectContaining({
        intervention_type: "REVIEW_UNPEGGED_SUPPLY",
        document_number: "PO-2026-0099",
        quantity: 30,
        review_reason: "EXCESS_AFTER_HORIZON",
        suggested_action: "RESCHEDULE_OUT_OR_REDUCE",
      }),
    ]);
  });

  it("does not classify the protected safety-stock balance as excess", () => {
    const plan = (service as any).projectTimeBuckets(
      [{ quantity: 10, dueDate: "2026-09-10" }],
      [
        {
          quantity: 40,
          date: "2026-09-10",
          source: "OPEN_PO",
          document_type: "PURCHASE_ORDER",
          document_id: "po-safety",
          document_number: "PO-2026-0100",
          document_line_id: "po-line-safety",
          status: "APPROVED",
        },
      ],
      {
        initialSupply: 0,
        safetyStock: 30,
        minimumOrderQuantity: 0,
        orderMultiple: 0,
      },
    );

    expect(plan.projectedAvailableQuantity).toBe(30);
    expect(plan.unpeggedSupplyQuantity).toBe(0);
    expect(plan.unpeggedSupplyDocuments).toEqual([]);
  });

  it("flags a future receipt that is not needed anywhere in the horizon", () => {
    const plan = (service as any).projectTimeBuckets(
      [{ quantity: 10, dueDate: "2026-09-10" }],
      [
        {
          quantity: 25,
          date: "2026-10-01",
          source: "OPEN_BUILD",
          document_type: "PRODUCTION_JOB_ORDER",
          document_id: "job-future",
          document_number: "JOB-2026-0042",
          document_line_id: null,
          status: "RELEASED",
        },
      ],
      {
        initialSupply: 10,
        safetyStock: 0,
        minimumOrderQuantity: 0,
        orderMultiple: 0,
      },
    );

    expect(plan.unpeggedSupplyDocuments[0]).toMatchObject({
      document_number: "JOB-2026-0042",
      quantity: 25,
      review_reason: "FUTURE_UNPEGGED_RECEIPT",
      suggested_action: "REVIEW_FUTURE_SUPPLY",
    });
  });

  it("carries MOQ excess into later demand buckets", () => {
    const plan = (service as any).projectTimeBuckets(
      [
        { quantity: 6, dueDate: "2026-09-10" },
        { quantity: 4, dueDate: "2026-09-20" },
      ],
      [],
      {
        initialSupply: 0,
        safetyStock: 0,
        minimumOrderQuantity: 10,
        orderMultiple: 0,
      },
    );

    expect(plan.recommendedSupplyQuantity).toBe(10);
    expect(plan.buckets[0].projected_available_quantity).toBe(4);
    expect(plan.buckets[1].recommended_supply_quantity).toBe(0);
    expect(plan.buckets[1].projected_available_quantity).toBe(0);
  });

  it("subtracts linked production coverage from open sales demand without double counting programs and job orders", () => {
    const uncovered = (service as any).salesOrderUncoveredQuantity(
      { id: "so-line-1", quantity: 100, dispatched_quantity: 10 },
      [{ sales_order_item_id: "so-line-1", quantity: 60 }],
      [{ sales_order_item_id: "so-line-1", target_quantity: 60 }],
    );

    expect(uncovered).toBe(30);
  });

  it("keeps only the uncovered balance when a sales order is partially planned", () => {
    const uncovered = (service as any).salesOrderUncoveredQuantity(
      { id: "so-line-1", quantity: 125, dispatched_quantity: 25 },
      [{ sales_order_item_id: "so-line-1", quantity: 40 }],
      [],
    );

    expect(uncovered).toBe(60);
  });

  it("consumes approved forecast with open sales orders in the same month", () => {
    const demands = (service as any).consumeApprovedForecast(
      [
        {
          id: "forecast-line-1",
          item_id: "finished-1",
          consensus_forecast: [{ month: "2026-09", quantity: 100 }],
          forecast_accuracy_pct: 82,
        },
      ],
      [
        {
          line: { item_id: "finished-1" },
          open_quantity: 60,
          due_date: "2026-09-15",
        },
      ],
      { id: "cycle-1", cycle_name: "S&OP 2026-08" },
    );

    expect(demands).toEqual([
      expect.objectContaining({
        demand_plan_cycle_id: "cycle-1",
        forecast_month: "2026-09",
        due_date: "2026-09-30",
        forecast_quantity: 100,
        sales_consumed_quantity: 60,
        residual_forecast_quantity: 40,
        required_quantity: 40,
      }),
    ]);
  });

  it("uses total open sales demand for forecast consumption even when production already covers it", () => {
    const demands = (service as any).consumeApprovedForecast(
      [
        {
          id: "forecast-line-1",
          item_id: "finished-1",
          consensus_forecast: [{ month: "2026-09", quantity: 100 }],
        },
      ],
      [
        {
          line: { item_id: "finished-1" },
          open_quantity: 100,
          uncovered_quantity: 0,
          due_date: "2026-09-20",
        },
      ],
      { id: "cycle-1" },
    );

    expect(demands[0]).toMatchObject({
      sales_consumed_quantity: 100,
      residual_forecast_quantity: 0,
      required_quantity: 0,
    });
  });

  it("consumes undated sales demand against the earliest forecast buckets once", () => {
    const demands = (service as any).consumeApprovedForecast(
      [
        {
          id: "forecast-line-1",
          item_id: "finished-1",
          consensus_forecast: [
            { month: "2026-10", quantity: 50 },
            { month: "2026-09", quantity: 50 },
          ],
        },
      ],
      [
        {
          line: { item_id: "finished-1" },
          open_quantity: 70,
          due_date: null,
        },
      ],
      { id: "cycle-1" },
    );

    expect(demands.map((demand: any) => demand.forecast_month)).toEqual([
      "2026-09",
      "2026-10",
    ]);
    expect(
      demands.map((demand: any) => demand.sales_consumed_quantity),
    ).toEqual([50, 20]);
    expect(demands.map((demand: any) => demand.required_quantity)).toEqual([
      0, 30,
    ]);
  });

  it("ignores forecast buckets that have expired before the MRP run", () => {
    const demands = (service as any).consumeApprovedForecast(
      [
        {
          id: "forecast-line-1",
          item_id: "finished-1",
          consensus_forecast: [
            { month: "2026-08", quantity: 50 },
            { month: "2026-09", quantity: 60 },
          ],
        },
      ],
      [],
      { id: "cycle-1" },
      "2026-09-01",
    );

    expect(demands).toHaveLength(1);
    expect(demands[0]).toMatchObject({
      forecast_month: "2026-09",
      required_quantity: 60,
    });
  });

  it("makes only reservations for the current plan usable", () => {
    const position = (service as any).reservationPosition(
      "item-1",
      [
        {
          item_id: "item-1",
          quantity: 100,
          reserved_quantity: 30,
          available_quantity: 70,
        },
      ],
      100,
      [
        {
          id: "reservation-current",
          item_id: "item-1",
          reserved_quantity: 10,
          reference_id: "job-current",
          reference_type: "PRODUCTION_ORDER",
          released: false,
        },
        {
          id: "reservation-other",
          item_id: "item-1",
          reserved_quantity: 20,
          reference_id: "job-other",
          reference_type: "PRODUCTION_ORDER",
          released: false,
        },
      ],
      new Set(["job-current"]),
      "2026-09-01T00:00:00.000Z",
    );

    expect(position).toMatchObject({
      physical_quantity: 100,
      unreserved_quantity: 70,
      usable_quantity: 80,
      active_reserved_quantity: 30,
      reserved_for_plan_quantity: 10,
      reserved_elsewhere_quantity: 20,
      reservation_mismatch_quantity: 0,
    });
    expect(position.reservation_evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ allocation: "CURRENT_PLAN" }),
        expect.objectContaining({ allocation: "OTHER_DEMAND" }),
      ]),
    );
  });

  it("deducts external reservations from stock-entry fallback without double counting current allocations", () => {
    const position = (service as any).reservationPosition(
      "item-1",
      [],
      100,
      [
        {
          item_id: "item-1",
          reserved_quantity: 10,
          reference_id: "sales-current",
        },
        {
          item_id: "item-1",
          reserved_quantity: 20,
          reference_id: "sales-other",
        },
      ],
      new Set(["sales-current"]),
      "2026-09-01T00:00:00.000Z",
    );

    expect(position.usable_quantity).toBe(80);
    expect(position.reserved_for_plan_quantity).toBe(10);
    expect(position.reserved_elsewhere_quantity).toBe(20);
  });

  it("ignores released and expired reservation records", () => {
    const position = (service as any).reservationPosition(
      "item-1",
      [],
      50,
      [
        {
          item_id: "item-1",
          reserved_quantity: 10,
          reference_id: "expired",
          expires_at: "2026-08-31T23:59:59.000Z",
        },
        {
          item_id: "item-1",
          reserved_quantity: 15,
          reference_id: "released",
          released: true,
        },
      ],
      new Set(),
      "2026-09-01T00:00:00.000Z",
    );

    expect(position.usable_quantity).toBe(50);
    expect(position.active_reserved_quantity).toBe(0);
    expect(position.reservation_evidence).toEqual([]);
  });

  it("calculates service-level safety stock from forecast accuracy and lead time", () => {
    const position = (service as any).safetyStockPosition(
      {
        safety_stock_method: "SERVICE_LEVEL",
        safety_stock_value: 95,
        minimum_stock: 100,
      },
      1000,
      30,
      [80],
    );

    expect(position).toMatchObject({
      method: "SERVICE_LEVEL",
      configured_value: 95,
      minimum_stock_quantity: 100,
      calculated_quantity: 330,
      protected_quantity: 330,
      forecast_accuracy_pct: 80,
    });
  });

  it("keeps minimum stock as the floor for fixed safety stock", () => {
    const position = (service as any).safetyStockPosition(
      {
        safety_stock_method: "FIXED",
        safety_stock_value: 10,
        minimum_stock: 25,
      },
      100,
      7,
      [],
    );

    expect(position.calculated_quantity).toBe(10);
    expect(position.protected_quantity).toBe(25);
  });

  it("ranks approved alternate materials by shortage coverage and lead time", () => {
    const candidates = (service as any).substitutionCandidates(
      {
        alternate_item_ids: ["alt-slow", "alt-fast", "alt-partial"],
        substitution_approval_required: true,
      },
      50,
      new Map([
        ["alt-slow", { code: "ALT-S", name: "Slow", lead_time_days: 10 }],
        ["alt-fast", { code: "ALT-F", name: "Fast", lead_time_days: 2 }],
        ["alt-partial", { code: "ALT-P", name: "Partial", lead_time_days: 1 }],
      ]),
      new Map([
        ["alt-slow", 50],
        ["alt-fast", 50],
        ["alt-partial", 20],
      ]),
    );

    expect(candidates.map((candidate: any) => candidate.item_id)).toEqual([
      "alt-fast",
      "alt-slow",
      "alt-partial",
    ]);
    expect(candidates[0]).toMatchObject({
      coverage_quantity: 50,
      coverage_status: "FULL",
      approval_required: true,
    });
    expect(candidates[2].coverage_status).toBe("PARTIAL");
  });

  it("nets each build level before creating lower-level component demand", () => {
    const aggregate = new Map<string, any>([
      [
        "assembly",
        {
          item_id: "assembly",
          gross_requirement: 10,
          issued_quantity: 0,
          demand_references: [
            {
              source_type: "SALES_ORDER",
              sales_order_item_id: "so-line-1",
              bom_level: 1,
            },
          ],
        },
      ],
    ]);
    const graph = new Map<string, any[]>([
      [
        "assembly",
        [{ item_id: "subassembly", quantity: 2, scrap_percentage: 0 }],
      ],
      ["subassembly", [{ item_id: "raw", quantity: 3, scrap_percentage: 0 }]],
    ]);
    const available = new Map([
      ["assembly", 4],
      ["subassembly", 2],
    ]);

    (service as any).explodeMultiLevelDemand(aggregate, graph, (line: any) => ({
      action: graph.has(line.item_id) ? "BUILD" : "BUY",
      recommended: Math.max(
        0,
        Number(line.gross_requirement || 0) -
          Number(available.get(line.item_id) || 0),
      ),
    }));

    expect(aggregate.get("subassembly").gross_requirement).toBe(12);
    expect(aggregate.get("raw").gross_requirement).toBe(30);
    expect(aggregate.get("raw").demand_references[0]).toMatchObject({
      sales_order_item_id: "so-line-1",
      parent_item_id: "subassembly",
      bom_level: 3,
    });
  });

  it("does not explode a build level already covered by stock or supply", () => {
    const aggregate = new Map<string, any>([
      [
        "assembly",
        {
          item_id: "assembly",
          gross_requirement: 10,
          issued_quantity: 0,
          demand_references: [],
        },
      ],
    ]);
    const graph = new Map<string, any[]>([
      ["assembly", [{ item_id: "raw", quantity: 5 }]],
    ]);

    (service as any).explodeMultiLevelDemand(aggregate, graph, () => ({
      action: "MONITOR",
      recommended: 0,
    }));

    expect(aggregate.has("raw")).toBe(false);
  });

  it("offsets every lower BOM level by its parent's lead time", () => {
    const aggregate = new Map<string, any>([
      [
        "assembly",
        {
          item_id: "assembly",
          gross_requirement: 1,
          issued_quantity: 0,
          demand_references: [
            {
              source_type: "SALES_ORDER",
              sales_order_item_id: "so-line-1",
              customer_due_date: "2026-09-30",
              due_date: "2026-09-30",
              bom_level: 1,
            },
          ],
        },
      ],
    ]);
    const graph = new Map<string, any[]>([
      ["assembly", [{ item_id: "subassembly", quantity: 1 }]],
      ["subassembly", [{ item_id: "raw", quantity: 1 }]],
    ]);
    const leadDays = new Map([
      ["assembly", 10],
      ["subassembly", 5],
    ]);

    (service as any).explodeMultiLevelDemand(aggregate, graph, (line: any) => {
      const requiredBy = line.demand_references
        .map((reference: any) => reference.due_date)
        .filter(Boolean)
        .sort()[0];
      return {
        action: graph.has(line.item_id) ? "BUILD" : "BUY",
        recommended: Number(line.gross_requirement || 0),
        requiredBy,
        releaseBy: (service as any).subtractCalendarDays(
          requiredBy,
          leadDays.get(line.item_id) || 0,
        ),
      };
    });

    expect(aggregate.get("subassembly").demand_references[0]).toMatchObject({
      customer_due_date: "2026-09-30",
      parent_required_by_date: "2026-09-30",
      parent_release_by_date: "2026-09-20",
      due_date: "2026-09-20",
      bom_level: 2,
    });
    expect(aggregate.get("raw").demand_references[0]).toMatchObject({
      customer_due_date: "2026-09-30",
      parent_required_by_date: "2026-09-20",
      parent_release_by_date: "2026-09-15",
      due_date: "2026-09-15",
      bom_level: 3,
    });
  });

  it("rejects circular active BOM dependencies", () => {
    const graph = new Map<string, any[]>([
      ["assembly-a", [{ item_id: "assembly-b" }]],
      ["assembly-b", [{ item_id: "assembly-a" }]],
    ]);

    expect(() => (service as any).assertAcyclicBomGraph(graph)).toThrow(
      "MRP cannot explode a circular BOM dependency",
    );
  });

  it("counts unconverted PR and draft-PO balances without double counting", () => {
    const pipeline = (service as any).purchasePipeline(
      [
        {
          status: "SUBMITTED",
          required_date: "2026-09-12",
          purchase_requisition_items: [
            { id: "pr-item-1", item_id: "item-1", requested_qty: 100 },
          ],
        },
        {
          status: "DRAFT",
          purpose: "MRP release run-1",
          purchase_requisition_items: [
            { id: "pr-item-2", item_id: "item-1", requested_qty: 20 },
          ],
        },
        {
          status: "DRAFT",
          purpose: "Unrelated manual request",
          purchase_requisition_items: [
            { id: "pr-item-3", item_id: "item-1", requested_qty: 500 },
          ],
        },
      ],
      [
        {
          status: "APPROVED",
          purchase_order_items: [
            {
              pr_item_id: "pr-item-1",
              item_id: "item-1",
              ordered_qty: 60,
              received_qty: 0,
            },
          ],
        },
        {
          status: "DRAFT",
          delivery_date: "2026-09-11",
          purchase_order_items: [
            {
              pr_item_id: "pr-item-1",
              item_id: "item-1",
              ordered_qty: 10,
              received_qty: 0,
            },
          ],
        },
      ],
      ["item-1"],
    );

    expect(pipeline.requisitionQuantities.get("item-1")).toBe(50);
    expect(pipeline.draftOrderQuantities.get("item-1")).toBe(10);
  });

  it("rejects a supplier override on a BUILD recommendation", async () => {
    setLine({
      id: "line-1",
      run_id: "run-1",
      recommended_quantity: 5,
      required_by_date: "2026-09-10",
      supply_action: "BUILD",
    });

    await expect(
      service.decide("tenant-1", "user-1", "line-1", {
        decision: "APPROVED",
        preferred_supplier_id: "vendor-1",
      }),
    ).rejects.toThrow(
      "A preferred supplier can only be selected for a BUY recommendation.",
    );
  });

  it("rejects an adjusted date in the past", async () => {
    setLine({
      id: "line-1",
      run_id: "run-1",
      recommended_quantity: 5,
      required_by_date: "2026-09-10",
      supply_action: "BUY",
    });

    await expect(
      service.decide("tenant-1", "user-1", "line-1", {
        decision: "CHANGED",
        adjusted_quantity: 5,
        adjusted_required_by_date: "2020-01-01",
        reason: "Customer date changed.",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("requires a material override for a CHANGED decision", async () => {
    setLine({
      id: "line-1",
      run_id: "run-1",
      recommended_quantity: 5,
      required_by_date: "2026-09-10",
      supply_action: "BUY",
    });

    await expect(
      service.decide("tenant-1", "user-1", "line-1", {
        decision: "CHANGED",
        reason: "Review requested.",
      }),
    ).rejects.toThrow(
      "Change quantity, required date, supplier or work centre before saving a changed recommendation.",
    );
  });

  it("locks a planner decision after its governed release enters approval", async () => {
    const lineQuery: any = {
      eq: jest.fn(() => lineQuery),
      maybeSingle: jest.fn(async () => ({
        data: {
          id: "line-1",
          run_id: "run-1",
          recommended_quantity: 5,
          required_by_date: "2026-09-10",
          supply_action: "BUY",
        },
        error: null,
      })),
    };
    const releaseQuery: any = {
      eq: jest.fn(() => releaseQuery),
      contains: jest.fn(() => releaseQuery),
      limit: jest.fn(async () => ({
        data: [{ source_key: "mrp-buy-packet" }],
        error: null,
      })),
    };
    const actionQuery: any = {
      eq: jest.fn(() => actionQuery),
      in: jest.fn(() => actionQuery),
      order: jest.fn(() => actionQuery),
      limit: jest.fn(() => actionQuery),
      maybeSingle: jest.fn(async () => ({
        data: {
          id: "request-123456",
          status: "PENDING_APPROVAL",
          native_result: null,
        },
        error: null,
      })),
    };
    (service as any).supabase = {
      from: jest.fn((table: string) => ({
        select: jest.fn(() =>
          table === "mrp_planning_lines"
            ? lineQuery
            : table === "mizantra_exception_register"
              ? releaseQuery
              : actionQuery,
        ),
      })),
    };

    await expect(
      service.decide("tenant-1", "user-1", "line-1", {
        decision: "CHANGED",
        adjusted_quantity: 6,
        reason: "Changed after release.",
      }),
    ).rejects.toThrow(
      "This recommendation is locked by governed request request- (PENDING_APPROVAL).",
    );
  });
});
