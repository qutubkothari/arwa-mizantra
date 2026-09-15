import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import OpenAI, { toFile } from "openai";
import { createHash } from "crypto";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

export type StructuredAiRequest<T> = {
  capability: string;
  system: string;
  data: unknown;
  fallback: T;
  model?: string;
  scope?: string;
  cacheTtlMs?: number;
  jsonSchema?: Record<string, unknown>;
  actorId?: string;
};

export type AiProviderResult<T> = {
  value: T;
  provider: "OPENAI" | "DETERMINISTIC_FALLBACK";
  model: string | null;
  fallback_used: boolean;
  latency_ms: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
  failure_reason?: string;
};

@Injectable()
export class AiProviderService {
  private readonly logger = new Logger(AiProviderService.name);
  private readonly client?: OpenAI;
  private readonly defaultModel: string;
  private readonly providerName:
    | "OPENAI"
    | "OPENAI_COMPATIBLE"
    | "DETERMINISTIC_FALLBACK";
  private readonly db?: SupabaseClient;
  private readonly cache = new Map<
    string,
    { expiresAt: number; value: AiProviderResult<any> }
  >();
  private readonly cacheMaxEntries: number;
  private readonly defaultCacheTtlMs: number;
  private readonly circuitFailureThreshold: number;
  private readonly circuitResetMs: number;
  private consecutiveFailures = 0;
  private circuitOpenedAt = 0;
  private metrics = {
    calls: 0,
    provider_calls: 0,
    fallbacks: 0,
    cache_hits: 0,
    failures: 0,
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    total_latency_ms: 0,
  };

  constructor(private readonly config: ConfigService) {
    const configuredProvider = String(
      this.config.get<string>("AI_PROVIDER") || "OPENAI",
    )
      .trim()
      .toUpperCase();
    const apiKey = this.config.get<string>("OPENAI_API_KEY");
    this.defaultModel =
      this.config.get<string>("OPENAI_MODEL") || "gpt-4o-mini";
    this.cacheMaxEntries = Math.min(
      Math.max(
        Number(this.config.get<string>("AI_CACHE_MAX_ENTRIES") || 250),
        0,
      ),
      2000,
    );
    this.defaultCacheTtlMs = Math.min(
      Math.max(Number(this.config.get<string>("AI_CACHE_TTL_MS") || 300000), 0),
      3600000,
    );
    this.circuitFailureThreshold = Math.min(
      Math.max(
        Number(this.config.get<string>("AI_CIRCUIT_FAILURE_THRESHOLD") || 3),
        1,
      ),
      20,
    );
    this.circuitResetMs = Math.min(
      Math.max(
        Number(this.config.get<string>("AI_CIRCUIT_RESET_MS") || 60000),
        5000,
      ),
      900000,
    );
    if (
      configuredProvider !== "DISABLED" &&
      apiKey &&
      apiKey !== "your_key_here"
    ) {
      const baseURL = this.config.get<string>("OPENAI_BASE_URL") || undefined;
      this.client = new OpenAI({
        apiKey,
        baseURL,
        timeout: Math.min(
          Math.max(
            Number(this.config.get<string>("AI_TIMEOUT_MS") || 20000),
            1000,
          ),
          60000,
        ),
        maxRetries: 1,
      });
      this.providerName = baseURL ? "OPENAI_COMPATIBLE" : "OPENAI";
    } else this.providerName = "DETERMINISTIC_FALLBACK";
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;
    if (supabaseUrl && supabaseKey)
      this.db = createClient(supabaseUrl, supabaseKey);
  }

  isEnabled() {
    return !!this.client;
  }

  async transcribeAudio(input: {
    buffer: Buffer;
    fileName: string;
    mimeType: string;
    language?: string;
  }) {
    if (!this.client) throw new Error("AI_AUDIO_PROVIDER_NOT_CONFIGURED");
    const model =
      this.config.get<string>("OPENAI_TRANSCRIBE_MODEL") || "gpt-transcribe";
    const file = await toFile(input.buffer, input.fileName, {
      type: input.mimeType,
    });
    const response = await this.client.audio.transcriptions.create({
      file,
      model: model as any,
      language: input.language || undefined,
      prompt:
        "ERP business request. Preserve company names, item codes, document numbers, quantities, units, dates, currencies, GST, PO, GRN, BOM, MRP, QC, SIV and SRV accurately.",
    });
    return {
      text: String(response.text || "").trim(),
      model,
    };
  }

  async synthesizeSpeech(input: {
    text: string;
    languageCode: string;
    languageName: string;
    scope: string;
    actorId?: string;
  }) {
    if (!this.client) throw new Error("AI_AUDIO_PROVIDER_NOT_CONFIGURED");
    const translation =
      input.languageCode === "en"
        ? {
            value: { translated_text: input.text },
            fallback_used: false,
          }
        : await this.structuredJson({
            capability: "active_planner_spoken_answer_translation",
            system:
              `Translate the ERP assistant answer into ${input.languageName}. Preserve names, codes, quantities, dates, currencies and accounting meaning exactly. ` +
              "Use natural, concise business language. Return only the requested JSON fields.",
            data: { text: input.text, language_code: input.languageCode },
            fallback: { translated_text: input.text },
            scope: input.scope,
            actorId: input.actorId,
            cacheTtlMs: 300000,
            jsonSchema: {
              type: "object",
              additionalProperties: false,
              properties: { translated_text: { type: "string" } },
              required: ["translated_text"],
            },
          });
    const spokenText = String(translation.value.translated_text || input.text)
      .trim()
      .slice(0, 4096);
    const model =
      this.config.get<string>("OPENAI_TTS_MODEL") || "gpt-4o-mini-tts";
    const speech = await this.client.audio.speech.create({
      model: model as any,
      voice: (this.config.get<string>("OPENAI_TTS_VOICE") || "marin") as any,
      input: spokenText,
      instructions: `Speak naturally and clearly in ${input.languageName}. This is a professional ERP assistant response. Read numbers, dates, units and currency amounts accurately.`,
      response_format: "mp3",
    });
    return {
      audio: Buffer.from(await speech.arrayBuffer()),
      model,
      translated: !translation.fallback_used,
    };
  }

  status() {
    const circuitOpen =
      this.circuitOpenedAt > 0 &&
      Date.now() - this.circuitOpenedAt < this.circuitResetMs;
    return {
      configured: this.isEnabled(),
      provider: this.providerName,
      default_model: this.isEnabled() ? this.defaultModel : null,
      api_mode: this.isEnabled() ? "RESPONSES" : null,
      circuit: circuitOpen ? "OPEN" : "CLOSED",
      consecutive_failures: this.consecutiveFailures,
      cache: {
        entries: this.cache.size,
        max_entries: this.cacheMaxEntries,
        ttl_ms: this.defaultCacheTtlMs,
        tenant_scoped: true,
      },
      metrics: {
        ...this.metrics,
        average_latency_ms: this.metrics.calls
          ? Math.round(this.metrics.total_latency_ms / this.metrics.calls)
          : 0,
      },
    };
  }

  private clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
  }

  private cacheKey<T>(request: StructuredAiRequest<T>, model: string) {
    if (!request.scope) return null;
    return createHash("sha256")
      .update(
        JSON.stringify({
          scope: request.scope,
          capability: request.capability,
          model,
          system: request.system,
          data: request.data,
        }),
      )
      .digest("hex");
  }

  private remember<T>(
    key: string | null,
    ttlMs: number,
    result: AiProviderResult<T>,
  ) {
    if (!key || ttlMs <= 0 || this.cacheMaxEntries <= 0 || result.fallback_used)
      return;
    while (this.cache.size >= this.cacheMaxEntries)
      this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key, {
      expiresAt: Date.now() + ttlMs,
      value: this.clone(result),
    });
  }

  private fallback<T>(
    request: StructuredAiRequest<T>,
    model: string | null,
    started: number,
    reason: string,
  ): AiProviderResult<T> {
    const result: AiProviderResult<T> = {
      value: this.clone(request.fallback),
      provider: "DETERMINISTIC_FALLBACK",
      model,
      fallback_used: true,
      latency_ms: Date.now() - started,
      failure_reason: reason,
    };
    this.metrics.fallbacks += 1;
    this.metrics.total_latency_ms += result.latency_ms;
    return result;
  }

  private record(
    request: StructuredAiRequest<any>,
    result: AiProviderResult<any>,
    cacheHit = false,
  ) {
    if (!this.db) return;
    const tenantId = String(request.scope || "").match(
      /^tenant:([0-9a-f-]{36})$/i,
    )?.[1];
    if (!tenantId) return;
    void this.db
      .from("mizantra_ai_call_metrics")
      .insert({
        tenant_id: tenantId,
        capability: String(request.capability || "").slice(0, 80),
        provider: result.provider,
        model: result.model,
        fallback_used: result.fallback_used,
        cache_hit: cacheHit,
        latency_ms: result.latency_ms,
        input_tokens: Number(result.usage?.input_tokens || 0),
        output_tokens: Number(result.usage?.output_tokens || 0),
        total_tokens: Number(result.usage?.total_tokens || 0),
        failure_reason: result.failure_reason || null,
      })
      .then(({ error }) => {
        if (error) this.logger.warn(`AI metric not recorded: ${error.message}`);
      });
  }

  async structuredJson<T>(
    request: StructuredAiRequest<T>,
  ): Promise<AiProviderResult<T>> {
    const started = Date.now();
    const model = request.model || this.defaultModel;
    this.metrics.calls += 1;
    const serializedData = JSON.stringify(request.data);
    if (serializedData.length > 200000) {
      const result = this.fallback(
        request,
        null,
        started,
        "BOUNDED_CONTEXT_EXCEEDED",
      );
      this.record(request, result);
      return result;
    }
    const key = this.cacheKey(request, model);
    const cached = key ? this.cache.get(key) : null;
    if (cached && cached.expiresAt > Date.now()) {
      this.metrics.cache_hits += 1;
      const result = this.clone({
        ...cached.value,
        latency_ms: Date.now() - started,
      });
      this.record(request, result, true);
      return result;
    }
    if (cached) this.cache.delete(key!);
    if (!this.client) {
      const result = this.fallback(
        request,
        null,
        started,
        "PROVIDER_NOT_CONFIGURED",
      );
      this.record(request, result);
      return result;
    }
    if (
      this.circuitOpenedAt &&
      Date.now() - this.circuitOpenedAt < this.circuitResetMs
    ) {
      const result = this.fallback(
        request,
        model,
        started,
        "PROVIDER_CIRCUIT_OPEN",
      );
      this.record(request, result);
      return result;
    }
    if (this.circuitOpenedAt) {
      this.circuitOpenedAt = 0;
      this.consecutiveFailures = 0;
    }
    try {
      this.metrics.provider_calls += 1;
      const safetyIdentifier = request.actorId
        ? createHash("sha256")
            .update(`${request.scope || "unscoped"}:${request.actorId}`)
            .digest("hex")
            .slice(0, 64)
        : undefined;
      const response = await this.client.responses.create({
        model,
        store: false,
        temperature: 0.2,
        max_output_tokens: Math.min(
          Math.max(
            Number(this.config.get<string>("AI_MAX_OUTPUT_TOKENS") || 2000),
            256,
          ),
          8000,
        ),
        instructions: request.system,
        input: serializedData,
        safety_identifier: safetyIdentifier,
        text: {
          format: request.jsonSchema
            ? ({
                type: "json_schema",
                name: String(request.capability || "structured_response")
                  .replace(/[^a-zA-Z0-9_-]/g, "_")
                  .slice(0, 64),
                strict: true,
                schema: request.jsonSchema,
              } as any)
            : ({ type: "json_object" } as any),
        },
      });
      const content = response.output_text;
      if (!content) throw new Error("EMPTY_PROVIDER_RESPONSE");
      const value = JSON.parse(content) as T;
      const result: AiProviderResult<T> = {
        value,
        provider: "OPENAI",
        model,
        fallback_used: false,
        latency_ms: Date.now() - started,
        usage: {
          input_tokens: response.usage?.input_tokens,
          output_tokens: response.usage?.output_tokens,
          total_tokens: response.usage?.total_tokens,
        },
      };
      this.consecutiveFailures = 0;
      this.metrics.input_tokens += Number(result.usage?.input_tokens || 0);
      this.metrics.output_tokens += Number(result.usage?.output_tokens || 0);
      this.metrics.total_tokens += Number(result.usage?.total_tokens || 0);
      this.metrics.total_latency_ms += result.latency_ms;
      this.remember(
        key,
        request.cacheTtlMs == null
          ? this.defaultCacheTtlMs
          : Math.min(Math.max(Number(request.cacheTtlMs), 0), 3600000),
        result,
      );
      this.record(request, result);
      this.logger.log(
        JSON.stringify({
          event: "AI_CALL_COMPLETED",
          capability: request.capability,
          provider: result.provider,
          model,
          latency_ms: result.latency_ms,
          usage: result.usage,
        }),
      );
      return result;
    } catch (error: any) {
      const reason = String(
        error?.code || error?.name || "PROVIDER_FAILURE",
      ).slice(0, 80);
      this.consecutiveFailures += 1;
      this.metrics.failures += 1;
      if (this.consecutiveFailures >= this.circuitFailureThreshold)
        this.circuitOpenedAt = Date.now();
      const result = this.fallback(request, model, started, reason);
      this.record(request, result);
      this.logger.warn(
        JSON.stringify({
          event: "AI_CALL_FALLBACK",
          capability: request.capability,
          model,
          latency_ms: result.latency_ms,
          reason,
        }),
      );
      return result;
    }
  }
}
