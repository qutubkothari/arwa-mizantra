import { BadRequestException } from "@nestjs/common";
import { MrpReleaseService } from "./mrp-release.service";

describe("MrpReleaseService", () => {
  const mrp = { latest: jest.fn() };
  const governedActions = { request: jest.fn() };
  const registry = {
    require: jest.fn(),
    authorize: jest.fn(),
    validate: jest.fn(),
  };
  const readiness = {
    assessBuild: jest.fn(async () => ({
      ready: true,
      status: "READY",
      reason: null,
      required_capacity_minutes: 120,
      available_capacity_minutes: 480,
      committed_capacity_minutes: 0,
      remaining_capacity_minutes: 480,
      work_centres: [],
      checks: ["FINITE_CAPACITY_PASSED"],
    })),
  };
  const exceptions = {
    syncPlan: jest.fn(),
    syncReadiness: jest.fn(),
  };
  let service: MrpReleaseService;
  let governanceRows: any[];

  beforeEach(() => {
    jest.clearAllMocks();
    governanceRows = [];
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_KEY = "test-key";
    service = new MrpReleaseService(
      mrp as any,
      governedActions as any,
      registry as any,
      readiness as any,
      exceptions as any,
    );
    (service as any).db = {
      from: jest.fn((table: string) => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            in: jest.fn(() =>
              table === "items"
                ? Promise.resolve({
                    data: [
                      {
                        id: "buy-item",
                        code: "RM-1",
                        name: "Raw material",
                        uom: "KG",
                        standard_cost: 25,
                      },
                      {
                        id: "build-item",
                        code: "FG-1",
                        name: "Finished good",
                        uom: "NOS",
                        standard_cost: 100,
                      },
                    ],
                    error: null,
                  })
                : {
                    order: jest.fn(async () => ({
                      data: governanceRows,
                      error: null,
                    })),
                  },
            ),
          })),
        })),
      })),
    };
  });

  it("groups approved BUY lines and creates individual BUILD preview packets without native documents", async () => {
    mrp.latest.mockResolvedValue({
      run: { id: "run-1", run_at: "2026-08-29T10:00:00Z", shortage_lines: 2 },
      lines: [
        {
          id: "line-buy",
          item_id: "buy-item",
          item_code: "RM-1",
          item_name: "Raw material",
          net_requirement: 10,
          recommended_quantity: 12,
          required_by_date: "2026-09-10",
          release_by_date: "2026-09-01",
          supply_action: "BUY",
          planner_decision: { decision: "APPROVED" },
        },
        {
          id: "line-build",
          item_id: "build-item",
          item_code: "FG-1",
          item_name: "Finished good",
          net_requirement: 4,
          recommended_quantity: 5,
          required_by_date: "2026-09-15",
          release_by_date: "2026-09-05",
          supply_action: "BUILD",
          planner_decision: { decision: "CHANGED", adjusted_quantity: 6 },
        },
      ],
    });

    const result: any = await service.preview("tenant-1", [
      "line-buy",
      "line-build",
    ]);

    expect(result.summary).toMatchObject({
      eligible_lines: 2,
      buy_packets: 1,
      build_packets: 1,
      native_documents_created: 0,
    });
    expect(result.packets).toHaveLength(2);
    expect(
      result.packets.find((packet: any) => packet.type === "BUY").input
        .items[0],
    ).toMatchObject({ item_id: "buy-item", requested_qty: 12 });
    expect(
      result.packets.find((packet: any) => packet.type === "BUILD").input,
    ).toMatchObject({ item_id: "build-item", quantity: 6 });
    expect(governedActions.request).not.toHaveBeenCalled();
  });

  it("attaches an executed governed request and native document trace", async () => {
    mrp.latest.mockResolvedValue({
      run: { id: "run-trace", shortage_lines: 1 },
      lines: [
        {
          id: "line-buy",
          item_id: "buy-item",
          item_code: "RM-1",
          item_name: "Raw material",
          net_requirement: 10,
          recommended_quantity: 10,
          required_by_date: "2026-09-10",
          supply_action: "BUY",
          planner_decision: { decision: "APPROVED" },
        },
      ],
    });
    const initial: any = await service.preview("tenant-1", ["line-buy"]);
    governanceRows = [
      {
        id: "request-1",
        insight_id: initial.packets[0].insight_id,
        status: "EXECUTED",
        native_result: {
          id: "pr-1",
          number: "PR-2026-0001",
          route: "/dashboard/purchase/requisitions",
        },
      },
    ];

    const traced: any = await service.preview("tenant-1", ["line-buy"]);

    expect(traced.packets[0]).toMatchObject({
      can_submit: false,
      governance: {
        status: "EXECUTED",
        native_result: { number: "PR-2026-0001" },
      },
    });
    expect(traced.summary.native_documents_created).toBe(1);
  });

  it("maps durable release evidence back to every line in the current run", async () => {
    mrp.latest.mockResolvedValue({
      run: { id: "run-status", shortage_lines: 2 },
      lines: [],
    });
    const exceptionChain: any = {};
    exceptionChain.select = jest.fn(() => exceptionChain);
    exceptionChain.eq = jest.fn(() => exceptionChain);
    exceptionChain.order = jest.fn(() => exceptionChain);
    exceptionChain.limit = jest.fn(async () => ({
      data: [
        {
          source_key: "mrp-buy-packet",
          title: "Draft PR release",
          source_route: "/dashboard/purchase/requisitions",
          evidence: {
            run_id: "run-status",
            line_ids: ["line-1", "line-2"],
            release_type: "BUY",
          },
          updated_at: "2026-08-29T10:00:00Z",
        },
      ],
      error: null,
    }));
    const actionChain: any = {};
    actionChain.select = jest.fn(() => actionChain);
    actionChain.eq = jest.fn(() => actionChain);
    actionChain.in = jest.fn(() => actionChain);
    actionChain.order = jest.fn(async () => ({
      data: [
        {
          id: "request-1",
          insight_id: "mrp-buy-packet",
          status: "PENDING_APPROVAL",
          updated_at: "2026-08-29T10:01:00Z",
        },
      ],
      error: null,
    }));
    (service as any).db = {
      from: jest.fn((table: string) =>
        table === "mizantra_exception_register" ? exceptionChain : actionChain,
      ),
    };

    const result: any = await service.status("tenant-1");

    expect(result.release_count).toBe(2);
    expect(result.by_line["line-1"].governance.status).toBe("PENDING_APPROVAL");
    expect(result.by_line["line-2"].insight_id).toBe("mrp-buy-packet");
  });

  it("blocks unapproved recommendations from release", async () => {
    mrp.latest.mockResolvedValue({
      run: { id: "run-2", shortage_lines: 1 },
      lines: [
        {
          id: "line-1",
          net_requirement: 3,
          recommended_quantity: 3,
          supply_action: "BUY",
          planner_decision: { decision: "PENDING" },
        },
      ],
    });

    const result: any = await service.preview("tenant-1", ["line-1"]);

    expect(result.packets).toHaveLength(0);
    expect(result.blocked_lines).toEqual([
      expect.objectContaining({
        line_id: "line-1",
        reason: "Planner approval is required.",
      }),
    ]);
  });

  it("creates a maker-checker packet for the exact pegged supply document", async () => {
    mrp.latest.mockResolvedValue({
      run: { id: "run-pegging", shortage_lines: 1 },
      lines: [
        {
          id: "line-pegging",
          item_id: "buy-item",
          item_code: "RM-1",
          item_name: "Raw material",
          net_requirement: 25,
          recommended_quantity: 0,
          required_by_date: "2026-09-10",
          supply_action: "MONITOR",
          planner_decision: { decision: "APPROVED" },
          supply_interventions: [
            {
              intervention_type: "RESCHEDULE_IN",
              source: "OPEN_PO",
              document_type: "PURCHASE_ORDER",
              document_id: "po-1",
              document_number: "PO-2026-0001",
              document_line_id: "po-line-1",
              status: "APPROVED",
              current_date: "2026-09-20",
              required_date: "2026-09-10",
              quantity: 25,
            },
          ],
        },
      ],
    });

    const result: any = await service.preview("tenant-1", ["line-pegging"]);

    expect(result.summary.supply_reschedule_packets).toBe(1);
    expect(result.blocked_lines).toHaveLength(0);
    expect(result.packets[0]).toMatchObject({
      type: "SUPPLY_RESCHEDULE",
      tool_code: "CREATE_SUPPLY_RESCHEDULE_REVIEW",
      input: {
        document_id: "po-1",
        document_number: "PO-2026-0001",
        document_line_id: "po-line-1",
        quantity: 25,
        current_date: "2026-09-20",
        required_date: "2026-09-10",
      },
    });
    expect(governedActions.request).not.toHaveBeenCalled();
  });

  it("creates a governed review packet for unpegged document supply", async () => {
    mrp.latest.mockResolvedValue({
      run: { id: "run-excess", shortage_lines: 0 },
      lines: [
        {
          id: "line-excess",
          item_id: "buy-item",
          item_code: "RM-1",
          item_name: "Raw material",
          net_requirement: 0,
          recommended_quantity: 0,
          required_by_date: "2026-09-10",
          supply_action: "MONITOR",
          planner_decision: { decision: "APPROVED" },
          unpegged_supply_documents: [
            {
              intervention_type: "REVIEW_UNPEGGED_SUPPLY",
              source: "OPEN_PO",
              document_type: "PURCHASE_ORDER",
              document_id: "po-excess",
              document_number: "PO-2026-0099",
              document_line_id: "po-line-excess",
              status: "APPROVED",
              current_date: "2026-09-10",
              required_date: "2026-09-10",
              quantity: 30,
              review_reason: "EXCESS_AFTER_HORIZON",
              suggested_action: "RESCHEDULE_OUT_OR_REDUCE",
            },
          ],
        },
      ],
    });

    const result: any = await service.preview("tenant-1", ["line-excess"]);

    expect(result.blocked_lines).toHaveLength(0);
    expect(result.summary.supply_reschedule_packets).toBe(1);
    expect(result.packets[0]).toMatchObject({
      type: "SUPPLY_RESCHEDULE",
      tool_code: "CREATE_SUPPLY_RESCHEDULE_REVIEW",
      input: {
        document_id: "po-excess",
        document_number: "PO-2026-0099",
        quantity: 30,
      },
    });
    expect(result.packets[0].explanation).toContain(
      "left after demand and safety-stock coverage",
    );
  });

  it("blocks a BUILD packet when finite-capacity readiness fails", async () => {
    readiness.assessBuild.mockResolvedValueOnce({
      ready: false,
      status: "BLOCKED",
      reason:
        "Available work-centre capacity is insufficient before the required date.",
      work_centres: [],
      checks: ["FINITE_CAPACITY_FAILED"],
    });
    mrp.latest.mockResolvedValue({
      run: { id: "run-3", shortage_lines: 1 },
      lines: [
        {
          id: "line-build",
          item_id: "build-item",
          item_code: "FG-1",
          item_name: "Finished good",
          net_requirement: 5,
          recommended_quantity: 5,
          required_by_date: "2026-09-15",
          release_by_date: "2026-09-05",
          supply_action: "BUILD",
          planner_decision: { decision: "APPROVED" },
        },
      ],
    });

    const result: any = await service.preview("tenant-1", ["line-build"]);

    expect(result.packets).toHaveLength(0);
    expect(result.blocked_lines).toEqual([
      expect.objectContaining({
        line_id: "line-build",
        reason:
          "Available work-centre capacity is insufficient before the required date.",
      }),
    ]);
  });

  it("requires explicit confirmation before creating maker-checker requests", async () => {
    await expect(
      service.request("tenant-1", {}, { confirm: false }, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(governedActions.request).not.toHaveBeenCalled();
  });
});
