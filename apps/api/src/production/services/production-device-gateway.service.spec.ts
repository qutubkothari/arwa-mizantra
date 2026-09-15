import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { createHash } from "crypto";
import { ProductionDeviceGatewayService } from "./production-device-gateway.service";

process.env.SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
process.env.SUPABASE_KEY = process.env.SUPABASE_KEY || "test-anon-key";

const gatewayQuery = (gateway: any) => {
  const query: any = {};
  for (const method of ["select", "eq", "in"])
    query[method] = jest.fn(() => query);
  query.maybeSingle = jest.fn(async () => ({ data: gateway, error: null }));
  return query;
};

describe("ProductionDeviceGatewayService external boundary", () => {
  it("does not allow registration to bypass independent live-mapping approval", async () => {
    const service = new ProductionDeviceGatewayService({} as any);
    await expect(
      service.save("tenant-a", "maker-a", {
        gateway_code: "PLC-1",
        gateway_name: "PLC 1",
        protocol: "HTTPS_WEBHOOK",
        status: "ACTIVE",
        is_test_mode: false,
      }),
    ).rejects.toThrow("independent activation approval");
  });

  it("requires an authorised production or administrator approver for live activation", async () => {
    const service = new ProductionDeviceGatewayService({} as any);
    await expect(
      service.decideActivation(
        "tenant-a",
        { userId: "maker-a", role: "OPERATOR" },
        "gateway-a",
        { decision: "APPROVE" },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects an invalid gateway key before accepting an event", async () => {
    const gateway = {
      id: "g1",
      tenant_id: "tenant-a",
      api_key_hash: createHash("sha256").update("correct").digest("hex"),
      status: "ACTIVE",
      field_mapping: {},
    };
    const service = new ProductionDeviceGatewayService({} as any);
    (service as any).db = { from: jest.fn(() => gatewayQuery(gateway)) };
    await expect(
      service.ingestExternal("gw_public", "wrong", {
        source_event_id: "e1",
        event_type: "RUN",
        payload: {},
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it("rejects replay-window timestamps after authenticating the gateway", async () => {
    const gateway = {
      id: "g1",
      tenant_id: "tenant-a",
      api_key_hash: createHash("sha256").update("correct").digest("hex"),
      status: "ACTIVE",
      field_mapping: {},
    };
    const service = new ProductionDeviceGatewayService({} as any);
    (service as any).db = { from: jest.fn(() => gatewayQuery(gateway)) };
    await expect(
      service.ingestExternal("gw_public", "correct", {
        source_event_id: "e1",
        event_type: "RUN",
        occurred_at: "2020-01-01T00:00:00Z",
        payload: {},
      }),
    ).rejects.toThrow("31-day acceptance window");
  });
});
