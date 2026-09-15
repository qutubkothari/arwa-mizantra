import { ForbiddenException } from "@nestjs/common";
import { hasAnyPermissionForResource } from "../auth/utils/permission-utils";
import {
  SemanticErpQueryService,
  SemanticQueryPlan,
} from "./semantic-erp-query.service";

jest.mock("../auth/utils/permission-utils", () => ({
  hasAnyPermissionForResource: jest.fn(() => true),
}));

const permission = hasAnyPermissionForResource as jest.Mock;

const query = (result: any) => {
  const chain: any = {};
  for (const method of [
    "select",
    "eq",
    "in",
    "gte",
    "lte",
    "order",
    "limit",
  ])
    chain[method] = jest.fn(() => chain);
  chain.then = (resolve: any) => resolve(result);
  return chain;
};

const plan = (overrides: Partial<SemanticQueryPlan> = {}): SemanticQueryPlan => ({
  mode: "RECORDS",
  specialist_kind: "",
  dataset: "PURCHASE_ORDERS",
  operation: "LATEST",
  entity_query: "Asons",
  entity_is_named: true,
  statuses: [],
  date_from: "",
  date_to: "",
  sort_by: "DATE",
  sort_direction: "DESC",
  limit: 25,
  clarification: "",
  confidence: 0.96,
  ...overrides,
});

const serviceWith = (
  selectedPlan: SemanticQueryPlan,
  tables: Record<string, any[]> = {},
  provider = "OPENAI",
) => {
  process.env.SUPABASE_URL ||= "http://localhost:54321";
  process.env.SUPABASE_KEY ||= "semantic-query-test-key";
  const ai = {
    structuredJson: jest.fn().mockResolvedValue({
      value: selectedPlan,
      provider,
      fallback_used: provider !== "OPENAI",
    }),
  };
  const specialist = { answer: jest.fn().mockResolvedValue(null) };
  const service = new SemanticErpQueryService(ai as any, specialist as any);
  (service as any).db = {
    from: jest.fn((table: string) =>
      query({ data: tables[table] || [], error: null }),
    ),
  };
  return { service, ai, specialist };
};

describe("SemanticErpQueryService", () => {
  beforeEach(() => permission.mockReturnValue(true));

  it("executes a typo-tolerant AI-planned latest-record query without phrase rules", async () => {
    const { service, ai } = serviceWith(plan(), {
      purchase_orders: [
        {
          id: "po-1",
          po_number: "PO-001",
          po_date: "2026-08-10",
          vendor_id: "vendor-1",
          status: "APPROVED",
          grand_total: 100,
        },
        {
          id: "po-2",
          po_number: "PO-002",
          po_date: "2026-08-20",
          vendor_id: "vendor-2",
          status: "APPROVED",
          grand_total: 200,
        },
      ],
      vendors: [
        { id: "vendor-1", code: "V001", name: "Asons" },
        { id: "vendor-2", code: "V002", name: "Other Supplier" },
      ],
    });

    const answer = await service.answer(
      "tenant-1",
      { permissions: ["purchase_orders:read"] },
      "can u pull d newest buy ordr frm asons",
    );

    expect(ai.structuredJson).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: "SEMANTIC_ERP_QUERY_PLAN",
        cacheTtlMs: 0,
      }),
    );
    expect(answer).toMatchObject({
      kind: "SEMANTIC_QUERY",
      status: "READY",
      title: "Purchase orders matching Asons",
      rows: [expect.objectContaining({ reference: "PO-001", name: "Asons" })],
    });
  });

  it("uses specialist calculations selected semantically by the model", async () => {
    const selected = plan({
      mode: "SPECIALIST",
      specialist_kind: "SUPPLIER_ADVANCES",
      dataset: "",
      operation: "SUMMARY",
      entity_query: "",
    });
    const { service, specialist } = serviceWith(selected);
    specialist.answer.mockResolvedValue({
      kind: "SUPPLIER_ADVANCES",
      status: "READY",
      title: "Available supplier advances",
      questions: [],
      generated_at: new Date().toISOString(),
      read_only: true,
    });

    const answer = await service.answer(
      "tenant-1",
      { permissions: ["accounting:read"] },
      "kitna paisa vendor ko advance pada hai",
    );

    expect(answer?.kind).toBe("SUPPLIER_ADVANCES");
    expect(specialist.answer).toHaveBeenCalledWith(
      "tenant-1",
      expect.anything(),
      "kitna paisa vendor ko advance pada hai",
      expect.objectContaining({
        query_scope: "PORTFOLIO",
        query_operation: "SUMMARY",
      }),
      "SUPPLIER_ADVANCES",
    );
  });

  it("refuses a dataset when the user lacks its permission", async () => {
    permission.mockReturnValue(false);
    const { service } = serviceWith(plan(), { purchase_orders: [] });
    await expect(
      service.answer("tenant-1", { permissions: [] }, "latest PO"),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("falls back safely when the semantic provider is unavailable", async () => {
    const { service } = serviceWith(plan(), {}, "DETERMINISTIC_FALLBACK");
    await expect(
      service.answer("tenant-1", {}, "random business question"),
    ).resolves.toBeNull();
  });

  it("leaves write requests to the controlled transaction planner", async () => {
    const { service } = serviceWith(
      plan({
        mode: "UNSUPPORTED",
        dataset: "",
        operation: "",
        entity_query: "",
        confidence: 0.99,
      }),
    );
    await expect(
      service.answer(
        "tenant-1",
        { permissions: ["purchase_orders:create"] },
        "create and approve a purchase order for 100 bearings",
      ),
    ).resolves.toBeNull();
  });
});
