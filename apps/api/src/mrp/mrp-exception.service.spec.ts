import { MrpExceptionService } from "./mrp-exception.service";

describe("MrpExceptionService", () => {
  let service: MrpExceptionService;

  beforeEach(() => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_KEY = "test-key";
    service = new MrpExceptionService();
  });

  it("uses a stable item-and-condition key across planning runs", () => {
    const line = {
      id: "line-1",
      item_id: "item-1",
      item_code: "RM-1",
      net_requirement: 8,
      recommended_quantity: 10,
      required_by_date: "2026-09-15",
      release_by_date: "2026-09-05",
      planner_decision: { decision: "PENDING" },
    };

    const first = (service as any).candidate(
      { id: "run-1" },
      line,
      "MATERIAL_SHORTAGE",
    );
    const second = (service as any).candidate(
      { id: "run-2" },
      { ...line, id: "line-2" },
      "MATERIAL_SHORTAGE",
    );

    expect(first.source_key).toBe("MRP:item-1:MATERIAL_SHORTAGE");
    expect(second.source_key).toBe(first.source_key);
    expect(second.evidence.fingerprint).toBe(first.evidence.fingerprint);
    expect(second.evidence.run_id).toBe("run-2");
    expect(second.evidence.action_due_date).toBe("2026-09-05");
  });

  it("synchronizes shortage and pending-decision exceptions without creating transactions", async () => {
    const upsert = jest.fn(async () => ({ error: null }));
    const selectQuery: any = {
      eq: jest.fn(() => selectQuery),
      then: (resolve: (value: any) => void) =>
        resolve({ data: [], error: null }),
    };
    (service as any).db = {
      from: jest.fn(() => ({
        select: jest.fn(() => selectQuery),
        upsert,
      })),
    };

    const result = await service.syncPlan("tenant-1", {
      run: { id: "run-1" },
      lines: [
        {
          id: "line-1",
          item_id: "item-1",
          item_code: "RM-1",
          net_requirement: 8,
          recommended_quantity: 10,
          required_by_date: "2026-09-15",
          release_by_date: "2026-09-05",
          exception_codes: ["MATERIAL_SHORTAGE"],
          planner_decision: null,
          demand_references: [],
        },
      ],
    });

    expect(result).toEqual({ active: 2, closed: 0, reopened: 0 });
    expect(upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          source_key: "MRP:item-1:MATERIAL_SHORTAGE",
          source_type: "MRP_PLAN",
          status: "OPEN",
        }),
        expect.objectContaining({
          source_key: "MRP:item-1:PLANNER_DECISION_REQUIRED",
        }),
      ]),
      { onConflict: "tenant_id,source_key" },
    );
  });

  it("creates a critical exception for a changed recommendation inside the time fence", () => {
    const candidate = (service as any).candidate(
      { id: "run-2" },
      {
        id: "line-2",
        item_id: "item-1",
        item_code: "RM-1",
        net_requirement: 0,
        recommended_quantity: 0,
        required_by_date: "2026-09-08",
        release_by_date: "2026-09-01",
        run_change: {
          classification: "RECOMMENDATION_RESOLVED",
          planning_time_fence_days: 7,
          requires_planner_reapproval: true,
        },
      },
      "PLANNING_TIME_FENCE_CHANGE",
    );

    expect(candidate).toMatchObject({
      source_key: "MRP:item-1:PLANNING_TIME_FENCE_CHANGE",
      severity: "CRITICAL",
      priority_score: 96,
    });
    expect(candidate.explanation).toContain("7-day planning time fence");
  });

  it("creates dedicated reservation commitment and reconciliation exceptions", () => {
    const line = {
      id: "line-1",
      item_id: "item-1",
      item_code: "RM-1",
      reserved_elsewhere_quantity: 20,
      reservation_mismatch_quantity: 5,
      reservation_evidence: [],
    };
    const committed = (service as any).candidate(
      { id: "run-1" },
      line,
      "STOCK_COMMITTED_ELSEWHERE",
    );
    const mismatch = (service as any).candidate(
      { id: "run-1" },
      line,
      "RESERVATION_LEDGER_MISMATCH",
    );

    expect(committed).toMatchObject({
      severity: "HIGH",
      priority_score: 88,
    });
    expect(mismatch).toMatchObject({
      severity: "CRITICAL",
      priority_score: 97,
    });
    expect(mismatch.explanation).toContain("5 units");
  });

  it("creates dedicated policy exceptions for substitution, stock, shelf life, batch and transfer controls", () => {
    const line = {
      id: "line-1",
      item_id: "item-1",
      item_code: "RM-1",
      maximum_stock_quantity: 100,
      maximum_stock_conflict: true,
      shelf_life_policy_risk: true,
      batch_constraint: "SINGLE_BATCH",
      recommended_intervention: "TRANSFER_SOURCE_REQUIRED",
      substitution_candidates: [{ coverage_quantity: 40 }],
    };
    const codes = [
      "APPROVED_SUBSTITUTE_AVAILABLE",
      "MAXIMUM_STOCK_CONFLICT",
      "SHELF_LIFE_POLICY_RISK",
      "SINGLE_BATCH_SOURCE_REQUIRED",
      "TRANSFER_SOURCE_REQUIRED",
    ];
    const candidates = codes.map((code) =>
      (service as any).candidate({ id: "run-1" }, line, code),
    );

    expect(
      candidates.map((candidate: any) => candidate.priority_score),
    ).toEqual([83, 87, 93, 85, 89]);
    expect(candidates[2].severity).toBe("CRITICAL");
    expect(candidates[4].explanation).toContain("blocked automatic BUY/BUILD");
  });
});
