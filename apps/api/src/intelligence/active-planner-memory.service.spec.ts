import {
  ActivePlannerMemoryService,
  plannerAssistantMessage,
} from "./active-planner-memory.service";

process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_KEY ||= "planner-memory-test-key";

describe("ActivePlannerMemoryService presentation", () => {
  it("persists the direct analytics answer as the planner message", () => {
    expect(
      plannerAssistantMessage({
        status: "READY_WITH_ANALYTICS",
        analytics: { headline: "15 PCS available across 1 warehouse." },
        questions: [],
      }),
    ).toBe("15 PCS available across 1 warehouse.");
  });

  it("persists follow-up questions before generic status text", () => {
    expect(
      plannerAssistantMessage({
        status: "NEEDS_INFORMATION",
        questions: ["Which customer?", "Which period?"],
      }),
    ).toBe("Which customer?\nWhich period?");
  });

  it("uses a grounded same-language answer without allowing new figures", async () => {
    const ai = {
      isEnabled: jest.fn(() => true),
      structuredJson: jest.fn().mockResolvedValue({
        value: {
          answer: "Super8 Antenna ka available stock 15 PCS hai.",
          language_code: "hi-Latn",
        },
        fallback_used: false,
      }),
    };
    const service = new ActivePlannerMemoryService(ai as any);
    await expect(
      (service as any).groundedAssistantMessage(
        "tenant-1",
        "user-1",
        "super8 antenna ka stock kitna hai?",
        {
          status: "READY_WITH_ANALYTICS",
          analytics: {
            title: "Inventory — Super8 Antenna",
            headline: "15 PCS available across 1 warehouse.",
          },
          questions: [],
        },
      ),
    ).resolves.toBe("Super8 Antenna ka available stock 15 PCS hai.");
  });

  it("rejects a composed answer that introduces an unverified number", async () => {
    const ai = {
      isEnabled: jest.fn(() => true),
      structuredJson: jest.fn().mockResolvedValue({
        value: {
          answer: "You have 15000 PCS available.",
          language_code: "en",
        },
        fallback_used: false,
      }),
    };
    const service = new ActivePlannerMemoryService(ai as any);
    await expect(
      (service as any).groundedAssistantMessage(
        "tenant-1",
        "user-1",
        "stock?",
        {
          status: "READY_WITH_ANALYTICS",
          analytics: { headline: "15 PCS available across 1 warehouse." },
          questions: [],
        },
      ),
    ).resolves.toBe("15 PCS available across 1 warehouse.");
  });

  it("classifies a user correction into a bounded learning target", async () => {
    const ai = {
      isEnabled: jest.fn(() => true),
      structuredJson: jest.fn().mockResolvedValue({
        value: {
          intent_type: "REPORT",
          analytics_kind: "SUPPLIER_ADVANCES",
          confidence: 0.96,
        },
        fallback_used: false,
      }),
    };
    const service = new ActivePlannerMemoryService(ai as any);

    await expect(
      (service as any).classifyCorrection(
        "tenant-1",
        "user-1",
        "supplier money",
        "I meant unused supplier advances, not outstanding payables",
      ),
    ).resolves.toEqual({
      intent_type: "REPORT",
      analytics_kind: "SUPPLIER_ADVANCES",
      confidence: 0.96,
    });
    expect(ai.structuredJson).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: "ACTIVE_PLANNER_VERIFIED_CORRECTION",
        cacheTtlMs: 0,
      }),
    );
  });

  it("does not learn a low-confidence correction", async () => {
    const ai = {
      isEnabled: jest.fn(() => true),
      structuredJson: jest.fn().mockResolvedValue({
        value: {
          intent_type: "REPORT",
          analytics_kind: "SUPPLIER_DUES",
          confidence: 0.61,
        },
        fallback_used: false,
      }),
    };
    const service = new ActivePlannerMemoryService(ai as any);

    await expect(
      (service as any).classifyCorrection(
        "tenant-1",
        "user-1",
        "supplier money",
        "something else",
      ),
    ).resolves.toBeNull();
  });

  it("clears only the signed-in user's visible conversation list by archiving it", async () => {
    const chain: any = {};
    chain.update = jest.fn(() => chain);
    chain.eq = jest.fn(() => chain);
    chain.then = (resolve: any) => resolve({ error: null });
    const service = new ActivePlannerMemoryService();
    (service as any).db = { from: jest.fn(() => chain) };

    await expect(
      service.clear("tenant-1", { id: "user-1" }),
    ).resolves.toMatchObject({ cleared: true });
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        is_archived: true,
        current_context_token: null,
      }),
    );
    expect(chain.eq).toHaveBeenCalledWith("tenant_id", "tenant-1");
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(chain.eq).toHaveBeenCalledWith("is_archived", false);
  });
});
