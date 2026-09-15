import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { IntelligenceService } from "./intelligence.service";
import { GovernedToolRegistryService } from "./governed-tool-registry.service";

process.env.SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
process.env.SUPABASE_KEY = process.env.SUPABASE_KEY || "test-anon-key";

describe("IntelligenceService critical behaviour", () => {
  const dashboard = { getCockpit: jest.fn() };
  const value = { dashboard: jest.fn() };
  const audit = { logActivity: jest.fn().mockResolvedValue(undefined) };
  const events = { recent: jest.fn(), record: jest.fn() };
  const crossModuleExceptions = { collect: jest.fn().mockResolvedValue([]) };
  const tools = new GovernedToolRegistryService();
  const ai = {
    structuredJson: jest.fn(async (request: any) => ({
      value: request.fallback,
      provider: "DETERMINISTIC_FALLBACK",
      model: null,
      fallback_used: true,
      latency_ms: 0,
    })),
    status: jest.fn(() => ({ configured: false })),
  };
  let service: IntelligenceService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new IntelligenceService(
      dashboard as any,
      value as any,
      audit as any,
      events as any,
      tools,
      ai as any,
      crossModuleExceptions as any,
    );
  });

  it("rejects empty and oversized Copilot questions", async () => {
    await expect(
      service.ask("tenant-a", { id: "u" }, "", {}),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.ask("tenant-a", { id: "u" }, "x".repeat(501), {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("returns missing-data behaviour instead of inventing a report", async () => {
    jest.spyOn(service, "commandCenter").mockResolvedValue({
      decision_inbox: [],
      metrics: [],
      operating_health: {},
      role_view: "EXECUTIVE",
    } as any);
    const result = await service.naturalLanguageReport(
      "tenant-a",
      { id: "u" },
      "invent a number",
      {},
    );
    expect(result.sufficient_data).toBe(false);
    expect(result.confidence).toBe("LOW");
    expect(result.rows).toEqual([]);
  });

  it("does not execute a high-risk native action through the task endpoint", async () => {
    await expect(
      service.executeControlledAction(
        "tenant-a",
        { id: "u", permissions: ["job_orders:create"] },
        { insight_id: "i", action_code: "CREATE_MAINTENANCE_WORK_ORDER" },
        {},
      ),
    ).rejects.toThrow("governed action-request workflow");
  });

  it("passes tenant scope to the AI provider and audits the question", async () => {
    jest.spyOn(service, "commandCenter").mockResolvedValue({
      decision_inbox: [],
      daily_focus: [],
      operating_health: { open_exceptions: 0 },
      roi_impact: null,
    } as any);
    jest.spyOn(service, "transformationCockpit").mockResolvedValue({
      summary: {
        active_programs: 0,
        programs_at_risk: 0,
        material_shortages: 0,
        capacity_overloads: 0,
        late_wip_operations: 0,
        open_cost_remediations: 0,
        pending_mrp_releases: 0,
        material_cash_required: 0,
        excess_wip_cash_risk: 0,
      },
      action_queue: [],
    } as any);
    const result = await service.ask(
      "tenant-a",
      { id: "u" },
      "What needs attention?",
      { ip: "127.0.0.1", headers: {} },
    );
    expect(ai.structuredJson).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "tenant:tenant-a" }),
    );
    expect(audit.logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-a" }),
    );
    expect(result.read_only).toBe(true);
  });

  it("grounds capacity questions in transformation evidence", async () => {
    jest.spyOn(service, "commandCenter").mockResolvedValue({
      decision_inbox: [],
      daily_focus: [],
      operating_health: { open_exceptions: 0 },
      roi_impact: null,
    } as any);
    jest.spyOn(service, "transformationCockpit").mockResolvedValue({
      summary: {
        active_programs: 2,
        programs_at_risk: 1,
        material_shortages: 3,
        capacity_overloads: 1,
        late_wip_operations: 0,
        open_cost_remediations: 2,
        pending_mrp_releases: 1,
        material_cash_required: 500,
        excess_wip_cash_risk: 100,
      },
      action_queue: [
        {
          id: "delivery-1",
          domain: "DELIVERY",
          title: "Higher-ranked delivery risk",
        },
      ],
      domain_actions: {
        CAPACITY: [
          {
            id: "stage-1",
            domain: "CAPACITY",
            title: "Machining: planned capacity overload",
            recommended_action: "Review alternate capacity.",
            route: "/dashboard/production/capacity-planning",
          },
        ],
      },
    } as any);
    const result = await service.ask(
      "tenant-a",
      { id: "u" },
      "Where are the capacity bottlenecks?",
      { headers: {} },
    );
    expect(result.intent).toBe("TRANSFORMATION_CAPACITY");
    expect(result.evidence[0].id).toBe("stage-1");
    expect(ai.structuredJson).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: "ASK_MIZANTRA_EXPLANATION",
        jsonSchema: expect.objectContaining({ additionalProperties: false }),
      }),
    );
  });

  it("keeps business-memory queries tenant scoped", async () => {
    jest.spyOn(service, "exceptionRegister").mockResolvedValue([
      {
        id: "e1",
        source_type: "INVENTORY",
        source_key: "risk-1",
        title: "Shortage",
        status: "OPEN",
        evidence: {},
        last_seen_at: "2026-01-01",
      },
    ] as any);
    events.recent.mockResolvedValue([
      {
        id: "v1",
        title: "Task created",
        event_type: "TASK",
        correlation_id: "risk-1",
        source_type: "automation_task",
        source_id: "t1",
        payload: {},
        created_at: "2026-01-01",
      },
    ]);
    const result = await service.businessMemory("tenant-a", 100);
    expect(events.recent).toHaveBeenCalledWith("tenant-a", 100);
    expect(
      result.edges.some((edge: any) => edge.relationship === "CORRELATED_WITH"),
    ).toBe(true);
  });

  it("requires historical observations before forecasting", async () => {
    jest
      .spyOn(service, "healthHistory")
      .mockResolvedValue({ history: [] } as any);
    jest.spyOn(service, "healthConfiguration").mockResolvedValue({
      historical_observations_required: 14,
      management_attention_threshold: 65,
    } as any);
    const result = await service.healthForecast("tenant-a", 7);
    expect(result.sufficient_data).toBe(false);
    expect(result.confidence).toBe("LOW");
    expect(result.forecast).toEqual([]);
    expect(result.observations_required).toBe(14);
  });

  it("keeps Factory Health configuration tenant-scoped and uses safe defaults when its migration is unavailable", async () => {
    const maybeSingle = jest.fn().mockResolvedValue({
      data: null,
      error: { message: "relation does not exist" },
    });
    const eq = jest.fn(() => ({ maybeSingle }));
    (service as any).db = {
      from: jest.fn(() => ({ select: jest.fn(() => ({ eq })) })),
    };
    const result = await service.healthConfiguration("tenant-a");
    expect((service as any).db.from).toHaveBeenCalledWith(
      "mizantra_factory_health_configurations",
    );
    expect(eq).toHaveBeenCalledWith("tenant_id", "tenant-a");
    expect(result.configured).toBe(false);
    expect(result.factor_caps.approvals).toBe(18);
    expect(result.historical_observations_required).toBe(14);
  });

  it("does not allow a non-administrator to alter Factory Health weighting", async () => {
    await expect(
      service.saveHealthConfiguration(
        "tenant-a",
        { id: "ordinary-user", roles: ["PRODUCTION"] },
        { factor_caps: { approvals: 0 } },
        {},
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("limits Command Center evidence to recognised management roles", () => {
    expect(service.canAccessCommandCenter({ role: "PRODUCTION_MANAGER" })).toBe(
      true,
    );
    expect(service.canAccessCommandCenter({ role: "CFO" })).toBe(true);
    expect(
      service.canAccessCommandCenter({ role: "SHOP_FLOOR_OPERATOR" }),
    ).toBe(false);
  });

  it("does not forecast before the tenant-approved historical calibration threshold", async () => {
    jest.spyOn(service, "healthHistory").mockResolvedValue({
      history: Array.from({ length: 13 }, (_x, index) => ({
        snapshot_date: `2026-08-${String(index + 1).padStart(2, "0")}`,
        score: 80,
      })),
    } as any);
    jest.spyOn(service, "healthConfiguration").mockResolvedValue({
      historical_observations_required: 14,
      management_attention_threshold: 65,
    } as any);
    const result = await service.healthForecast("tenant-a", 7);
    expect(result.sufficient_data).toBe(false);
    expect(result.observations_available).toBe(13);
    expect(result.observations_required).toBe(14);
  });

  it("labels projections based on test calibration fixtures", async () => {
    jest.spyOn(service, "healthHistory").mockResolvedValue({
      history: Array.from({ length: 14 }, (_x, index) => ({
        snapshot_date: `2026-08-${String(index + 1).padStart(2, "0")}`,
        score: 80 + index / 10,
        factors: [
          {
            key: "test_calibration_fixture",
            source: "mizantra-test-fixture",
          },
        ],
      })),
    } as any);
    jest.spyOn(service, "healthConfiguration").mockResolvedValue({
      historical_observations_required: 14,
      management_attention_threshold: 65,
    } as any);
    const result = await service.healthForecast("tenant-a", 7);
    expect(result.sufficient_data).toBe(true);
    expect(result.data_classification).toBe("TEST_SIMULATION");
    expect(result.data_classification_note).toContain("must not be used");
  });

  it("returns only tenant-scoped eligible exception owners", async () => {
    const limit = jest.fn().mockResolvedValue({
      data: [
        {
          id: "user-1",
          first_name: "Mina",
          last_name: "Owner",
          username: "mina",
        },
      ],
      error: null,
    });
    const order = jest.fn(() => ({ limit }));
    const eq = jest.fn(() => ({ order }));
    (service as any).db = {
      from: jest.fn(() => ({ select: jest.fn(() => ({ eq })) })),
    };
    const result = await service.exceptionAssignees("tenant-a");
    expect((service as any).db.from).toHaveBeenCalledWith("users");
    expect(eq).toHaveBeenCalledWith("tenant_id", "tenant-a");
    expect(result).toEqual([{ id: "user-1", label: "Mina Owner" }]);
  });

  it("returns only owner- or role-visible in-app exception notifications", async () => {
    const limit = jest.fn().mockResolvedValue({
      data: [
        {
          id: "mine",
          recipient: "USER:user-1",
          delivery_status: "DELIVERED",
          metadata: {},
        },
        {
          id: "finance",
          recipient: "FINANCE_REVIEWER",
          delivery_status: "DELIVERED",
          metadata: {},
        },
        {
          id: "other",
          recipient: "OPERATIONS_MANAGER",
          delivery_status: "DELIVERED",
          metadata: {},
        },
      ],
      error: null,
    });
    const order = jest.fn(() => ({ limit }));
    const eq3 = jest.fn(() => ({ order }));
    const eq2 = jest.fn(() => ({ eq: eq3 }));
    const eq1 = jest.fn(() => ({ eq: eq2 }));
    (service as any).db = {
      from: jest.fn(() => ({ select: jest.fn(() => ({ eq: eq1 })) })),
    };
    const result = await service.exceptionNotifications("tenant-a", {
      id: "user-1",
      role: "Finance Reviewer",
    });
    expect(result.map((row: any) => row.id)).toEqual(["mine", "finance"]);
    expect(
      result.every(
        (row: any) => row.route === "/dashboard/command-center/exceptions",
      ),
    ).toBe(true);
  });
});
