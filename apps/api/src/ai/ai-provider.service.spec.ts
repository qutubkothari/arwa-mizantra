import { AiProviderService } from "./ai-provider.service";

const config = (values: Record<string, string> = {}) =>
  ({ get: (key: string) => values[key] }) as any;

describe("AiProviderService controlled degradation", () => {
  it("returns deterministic fallback when no provider is configured", async () => {
    const service = new AiProviderService(config({ AI_PROVIDER: "DISABLED" }));
    const result = await service.structuredJson({
      capability: "TEST",
      system: "Return JSON",
      data: {},
      fallback: { answer: "safe" },
    });
    expect(result.value).toEqual({ answer: "safe" });
    expect(result.fallback_used).toBe(true);
    expect(result.failure_reason).toBe("PROVIDER_NOT_CONFIGURED");
  });

  it("rejects oversized provider context before making a provider call", async () => {
    const service = new AiProviderService(config({ AI_PROVIDER: "DISABLED" }));
    const result = await service.structuredJson({
      capability: "TEST",
      system: "Return JSON",
      data: { text: "x".repeat(200001) },
      fallback: { safe: true },
    });
    expect(result.failure_reason).toBe("BOUNDED_CONTEXT_EXCEEDED");
  });

  it("uses tenant-scoped cache without a second provider call", async () => {
    const service = new AiProviderService(
      config({ OPENAI_API_KEY: "test", AI_CACHE_TTL_MS: "60000" }),
    );
    const create = jest.fn().mockResolvedValue({
      output_text: '{"answer":"verified"}',
      usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
    });
    (service as any).client = { responses: { create } };
    const request = {
      capability: "TEST",
      scope: "tenant:t-1",
      system: "Return JSON",
      data: { bounded: true },
      fallback: { answer: "safe" },
    };
    const first = await service.structuredJson(request);
    const second = await service.structuredJson(request);
    expect(first.value).toEqual({ answer: "verified" });
    expect(second.value).toEqual({ answer: "verified" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(service.status().cache.entries).toBe(1);
  });

  it("opens its circuit after configured provider failures", async () => {
    const service = new AiProviderService(
      config({
        OPENAI_API_KEY: "test",
        AI_CIRCUIT_FAILURE_THRESHOLD: "1",
        AI_CIRCUIT_RESET_MS: "60000",
      }),
    );
    const create = jest
      .fn()
      .mockRejectedValue(new Error("provider unavailable"));
    (service as any).client = { responses: { create } };
    const request = {
      capability: "TEST",
      system: "Return JSON",
      data: {},
      fallback: { safe: true },
    };
    const first = await service.structuredJson(request);
    const second = await service.structuredJson(request);
    expect(first.fallback_used).toBe(true);
    expect(second.failure_reason).toBe("PROVIDER_CIRCUIT_OPEN");
    expect(create).toHaveBeenCalledTimes(1);
    expect(service.status().circuit).toBe("OPEN");
  });

  it("uses strict Responses output without storing provider state", async () => {
    const service = new AiProviderService(config({ OPENAI_API_KEY: "test" }));
    const create = jest
      .fn()
      .mockResolvedValue({ output_text: '{"answer":"ok"}', usage: {} });
    (service as any).client = { responses: { create } };
    await service.structuredJson({
      capability: "STRICT_TEST",
      scope: "tenant:11111111-1111-4111-8111-111111111111",
      actorId: "22222222-2222-4222-8222-222222222222",
      system: "Return the supplied schema.",
      data: { bounded: true },
      fallback: { answer: "safe" },
      jsonSchema: {
        type: "object",
        additionalProperties: false,
        required: ["answer"],
        properties: { answer: { type: "string" } },
      },
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        store: false,
        instructions: "Return the supplied schema.",
        safety_identifier: expect.stringMatching(/^[a-f0-9]{64}$/),
        text: {
          format: expect.objectContaining({
            type: "json_schema",
            strict: true,
          }),
        },
      }),
    );
  });
});
