import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { GovernedActionService } from "./governed-action.service";
import { GovernedToolRegistryService } from "./governed-tool-registry.service";

process.env.SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
process.env.SUPABASE_KEY = process.env.SUPABASE_KEY || "test-anon-key";

const queryReturning = (result: any, observed: any[]) => {
  const query: any = {};
  for (const method of ["select", "eq", "in", "order", "limit"])
    query[method] = jest.fn((...args: any[]) => {
      observed.push([method, ...args]);
      return query;
    });
  query.maybeSingle = jest.fn(async () => result);
  return query;
};

describe("GovernedActionService maker-checker controls", () => {
  it("rejects prompt actions whose source is not bound to the signed context", async () => {
    const service = new GovernedActionService(
      new GovernedToolRegistryService(),
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    await expect(
      service.requestFromPrompt(
        "tenant-a",
        { id: "maker", role: "ADMIN" },
        "CREATE_QUALITY_NCR",
        {
          insight_id: "ACTIVE_PLANNER:different-context",
          description: "Rejected material",
          nonconformance_type: "MATERIAL",
        },
        {
          context_id: "11111111-1111-4111-8111-111111111111",
          intent: "QUALITY_NCR",
        },
        {},
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("prevents the requester from approving their own native action", async () => {
    const observed: any[] = [],
      row = {
        id: "r1",
        tenant_id: "tenant-a",
        created_by: "maker",
        status: "PENDING_APPROVAL",
        tool_code: "CREATE_MAINTENANCE_WORK_ORDER",
      };
    const service = new GovernedActionService(
      new GovernedToolRegistryService(),
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    (service as any).db = {
      from: jest.fn(() => queryReturning({ data: row, error: null }, observed)),
    };
    await expect(
      service.approve(
        "tenant-a",
        { id: "maker", permissions: ["job_orders:create"] },
        "r1",
        {},
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(observed).toContainEqual(["eq", "tenant_id", "tenant-a"]);
  });

  it("does not expose another tenant action through list", async () => {
    const observed: any[] = [],
      query = queryReturning({ data: [], error: null }, observed);
    query.then = (resolve: any) => resolve({ data: [], error: null });
    const service = new GovernedActionService(
      new GovernedToolRegistryService(),
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    (service as any).db = { from: jest.fn(() => query) };
    await service.list("tenant-a", { id: "user-a" });
    expect(observed).toContainEqual(["eq", "tenant_id", "tenant-a"]);
  });
});
