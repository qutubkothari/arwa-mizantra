import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { AiProviderService } from "../ai/ai-provider.service";
import { ACTIVE_PLANNER_CAPABILITIES } from "./active-planner.capabilities";

const clean = (value: unknown) => String(value ?? "").trim();
const userIdOf = (user: any) => clean(user?.userId || user?.id);
const uuid = (value: unknown) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    clean(value),
  );
const normalizedUtterance = (value: unknown) =>
  clean(value).toLocaleLowerCase().replace(/\s+/g, " ").slice(0, 2000);
const usesNonLatinScript = (value: unknown) =>
  (clean(value).match(/\p{Letter}/gu) || []).some(
    (letter) => !/\p{Script=Latin}/u.test(letter),
  );
const usesNonAsciiDigits = (value: unknown) =>
  (clean(value).match(/\p{Decimal_Number}/gu) || []).some(
    (digit) => !/[0-9]/.test(digit),
  );
const CORRECTABLE_INTENTS = [
  ...new Set(
    ACTIVE_PLANNER_CAPABILITIES.map((capability) => capability.intent),
  ),
  "UNKNOWN",
] as string[];
const CORRECTABLE_ANALYTICS = [
  "",
  "CUSTOMER_SALES",
  "CUSTOMER_RECEIVABLES",
  "SUPPLIER_DUES",
  "SUPPLIER_ADVANCES",
  "SUPPLIER_PAYMENTS",
  "SUPPLIER_PRICE_COMPARISON",
  "INVENTORY_POSITION",
  "SALES_ORDER_STATUS",
  "PRODUCTION_STATUS",
  "EMPLOYEE_ATTENDANCE",
  "CRM_PIPELINE",
  "CRM_FOLLOWUPS",
  "SEMANTIC_QUERY",
  "MANAGEMENT_SUMMARY",
] as string[];

export function plannerAssistantMessage(result: any) {
  if (result?.questions?.length) return result.questions.join("\n");
  // The planner service can provide a workflow-specific, fact-grounded message
  // (for example a Job Order production-pack summary). Preserve it instead of
  // replacing every draft-ready response with the generic transaction text.
  if (clean(result?.assistant_message)) return clean(result.assistant_message);
  if (result?.status === "READY_WITH_ANALYTICS")
    return (
      result?.analytics?.headline ||
      "I analysed the governed ERP records and prepared the answer."
    );
  if (result?.status === "READY_TO_CREATE_DRAFT")
    return "I resolved and validated the transaction. Review it before creating the ERP draft.";
  if (result?.status === "READY_TO_REQUEST_APPROVAL")
    return "I validated the request and its source masters. Submit it for independent approval; no native record will be created yet.";
  if (result?.status === "READY_FOR_BILLING_REVIEW")
    return "The billing prerequisites are valid. Open the native workflow for final review.";
  if (result?.status === "READY_TO_OPEN_WORKFLOW")
    return `I have enough information. Open ${result?.capability?.label || "the native workflow"} to continue under its normal controls.`;
  return "Please provide the remaining details.";
}

@Injectable()
export class ActivePlannerMemoryService {
  private readonly db: SupabaseClient = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!,
  );

  constructor(@Optional() private readonly ai?: AiProviderService) {}

  private numericFacts(value: unknown) {
    return (String(value || "").match(/[0-9][0-9,./-]*/g) || []).map((token) =>
      token.replace(/[^0-9]/g, ""),
    );
  }

  private async groundedAssistantMessage(
    tenantId: string,
    userId: string,
    utterance: string,
    result: any,
    responseLanguage?: string,
  ) {
    const fallback = plannerAssistantMessage(result);
    const requestedLanguage = clean(responseLanguage).toLowerCase();
    const forceArabic =
      requestedLanguage === "ar" || requestedLanguage.startsWith("ar-");
    const explicitNonEnglishLanguage =
      Boolean(requestedLanguage) &&
      requestedLanguage !== "en" &&
      requestedLanguage !== "auto" &&
      !forceArabic;
    const autoMatchLanguage = requestedLanguage === "auto";
    const matchUserLanguage = usesNonLatinScript(utterance);
    const localizeReply =
      forceArabic ||
      explicitNonEnglishLanguage ||
      autoMatchLanguage ||
      matchUserLanguage;
    if (
      // Workflow-specific messages are already fact-grounded by the planner.
      // Preserve them in English, but compose them in the user's explicitly
      // selected language or script when a localized answer is requested.
      (clean(result?.assistant_message) && !localizeReply) ||
      !this.ai?.isEnabled() ||
      (!localizeReply && result?.status !== "READY_WITH_ANALYTICS") ||
      (!localizeReply && !result?.analytics)
    )
      return fallback;
    const sections = Array.isArray(result?.analytics?.sections)
      ? result.analytics.sections
      : result?.analytics
        ? [result.analytics]
        : [];
    const verifiedFacts = sections.map((section: any) => ({
      title: clean(section.title),
      answer: clean(section.headline),
      period: section.period?.label || null,
      currency_code: section.currency_code || null,
      warnings: (section.warnings || []).slice(0, 3),
    }));
    if (localizeReply && !result?.analytics) {
      verifiedFacts.push({
        title: "Verified ERP response",
        answer: fallback,
        period: null,
        currency_code: null,
        warnings: [],
      });
    }
    const composed = await this.ai.structuredJson<{
      answer: string;
      language_code: string;
    }>({
      capability: "ACTIVE_PLANNER_GROUNDED_ANSWER",
      scope: `tenant:${tenantId}`,
      actorId: userId,
      cacheTtlMs: 0,
      system:
        "Write a concise, professional ERP answer using only verified_facts. If response_language is ar-EG, always answer in clear Modern Standard Arabic suitable for an Egyptian business user, even when user_request is English. If response_language is another explicit language code, answer in that language; if it is MATCH_USER or AUTO, use the language and script of user_request. Use everyday words that a new office, sales, stores or factory employee can understand. Use short sentences and active voice. Avoid jargon and form names unless they are needed; expand an ERP acronym once. If verified_facts asks for missing information, ask only the minimum needed, as one short direct question where possible, and include a simple example when that would help. Never blame the user for spelling or grammar. Keep business document codes and all digits unchanged. Do not infer, calculate, round, convert, recommend, or introduce any new name, date, quantity, currency, status, or business fact. Preserve all digits using 0-9. Return strict JSON only.",
      data: {
        user_request: clean(utterance).slice(0, 2000),
        response_language: forceArabic
          ? "ar-EG"
          : explicitNonEnglishLanguage
            ? requestedLanguage
            : matchUserLanguage
              ? "MATCH_USER"
              : "AUTO",
        verified_facts: verifiedFacts,
      },
      fallback: { answer: fallback, language_code: "en" },
      jsonSchema: {
        type: "object",
        additionalProperties: false,
        required: ["answer", "language_code"],
        properties: {
          answer: { type: "string" },
          language_code: { type: "string" },
        },
      },
    });
    const answer = clean(composed.value?.answer).slice(0, 900);
    if (composed.fallback_used || !answer) return fallback;
    const allowedNumbers = new Set(
      this.numericFacts(JSON.stringify(verifiedFacts)),
    );
    const introducedNumber = this.numericFacts(answer).some(
      (number) => number && !allowedNumbers.has(number),
    );
    return introducedNumber || usesNonAsciiDigits(answer) ? fallback : answer;
  }

  private async classifyCorrection(
    tenantId: string,
    userId: string,
    originalUtterance: string,
    correction: string,
  ) {
    if (!this.ai?.isEnabled() || !clean(correction)) return null;
    const classified = await this.ai.structuredJson<{
      intent_type: string;
      analytics_kind: string;
      confidence: number;
    }>({
      capability: "ACTIVE_PLANNER_VERIFIED_CORRECTION",
      scope: `tenant:${tenantId}`,
      actorId: userId,
      cacheTtlMs: 0,
      system:
        "Classify the user's correction of a misunderstood ERP request. The correction explains the business meaning they intended; it never authorizes or executes an action. Choose exactly one allowed intent. For a read-only report, choose REPORT and the closest allowed analytics kind; use SEMANTIC_QUERY for ordinary record list/count/latest/status queries that do not have a specialist calculation. For a transaction request, leave analytics_kind empty. Do not extract or retain operational amounts, names, dates or instructions. Return strict JSON only.",
      data: {
        original_request: clean(originalUtterance).slice(0, 2000),
        user_correction: clean(correction).slice(0, 500),
        allowed_intents: CORRECTABLE_INTENTS,
        allowed_analytics_kinds: CORRECTABLE_ANALYTICS,
      },
      fallback: { intent_type: "UNKNOWN", analytics_kind: "", confidence: 0 },
      jsonSchema: {
        type: "object",
        additionalProperties: false,
        required: ["intent_type", "analytics_kind", "confidence"],
        properties: {
          intent_type: { type: "string", enum: CORRECTABLE_INTENTS },
          analytics_kind: { type: "string", enum: CORRECTABLE_ANALYTICS },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    });
    const target = classified.value;
    if (
      classified.fallback_used ||
      Number(target.confidence || 0) < 0.8 ||
      !CORRECTABLE_INTENTS.includes(target.intent_type) ||
      target.intent_type === "UNKNOWN" ||
      !CORRECTABLE_ANALYTICS.includes(target.analytics_kind) ||
      (target.intent_type === "REPORT" && !target.analytics_kind) ||
      (target.intent_type !== "REPORT" && target.analytics_kind)
    )
      return null;
    return {
      intent_type: target.intent_type,
      analytics_kind: target.analytics_kind || null,
      confidence: Number(target.confidence),
    };
  }

  private async rememberVerifiedCorrection(
    tenantId: string,
    userId: string,
    utterance: string,
    hash: string,
    target: { intent_type: string; analytics_kind: string | null },
  ) {
    let query = this.db
      .from("active_planner_learning_examples")
      .select("id,positive_count")
      .eq("tenant_id", tenantId)
      .eq("utterance_hash", hash)
      .eq("intent_type", target.intent_type);
    query = target.analytics_kind
      ? query.eq("analytics_kind", target.analytics_kind)
      : query.is("analytics_kind", null);
    const existing = await query.maybeSingle();
    if (existing.error) throw new BadRequestException(existing.error.message);
    const now = new Date().toISOString();
    if (existing.data) {
      const updated = await this.db
        .from("active_planner_learning_examples")
        .update({
          source: "USER_FEEDBACK",
          status: "VERIFIED",
          positive_count: Number(existing.data.positive_count || 0) + 1,
          verified_by: userId,
          verified_at: now,
          last_seen_by: userId,
          updated_at: now,
        })
        .eq("tenant_id", tenantId)
        .eq("id", existing.data.id);
      if (updated.error) throw new BadRequestException(updated.error.message);
      return;
    }
    const inserted = await this.db
      .from("active_planner_learning_examples")
      .insert({
        tenant_id: tenantId,
        utterance: clean(utterance).slice(0, 2000),
        utterance_hash: hash,
        intent_type: target.intent_type,
        analytics_kind: target.analytics_kind,
        source: "USER_FEEDBACK",
        status: "VERIFIED",
        occurrence_count: 1,
        positive_count: 1,
        first_seen_by: userId,
        last_seen_by: userId,
        verified_by: userId,
        verified_at: now,
      });
    if (inserted.error) throw new BadRequestException(inserted.error.message);
  }

  private async ownedConversation(
    tenantId: string,
    userId: string,
    conversationId: string,
  ) {
    if (!uuid(conversationId))
      throw new BadRequestException("Conversation reference is invalid.");
    const { data, error } = await this.db
      .from("active_planner_conversations")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .eq("id", conversationId)
      .eq("is_archived", false)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException("Planner conversation not found.");
    return data;
  }

  async create(tenantId: string, user: any, title?: string) {
    const userId = userIdOf(user);
    const { data, error } = await this.db
      .from("active_planner_conversations")
      .insert({
        tenant_id: tenantId,
        user_id: userId,
        title: clean(title).slice(0, 180) || "New conversation",
      })
      .select("*")
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async clear(tenantId: string, user: any) {
    const userId = userIdOf(user);
    const { error } = await this.db
      .from("active_planner_conversations")
      .update({
        is_archived: true,
        current_context_token: null,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .eq("is_archived", false);
    if (error) throw new BadRequestException(error.message);
    return {
      cleared: true,
      message:
        "Conversation list cleared. Archived history remains available for audit and is not used as active chat context.",
    };
  }

  async history(tenantId: string, user: any, requestedId?: string) {
    const userId = userIdOf(user);
    const { data: conversations, error } = await this.db
      .from("active_planner_conversations")
      .select(
        "id,title,message_count,created_at,updated_at,last_message_at,current_context_token,last_result",
      )
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .eq("is_archived", false)
      .order("last_message_at", { ascending: false })
      .limit(30);
    if (error) throw new BadRequestException(error.message);
    const selected = requestedId
      ? (conversations || []).find((row: any) => row.id === requestedId)
      : conversations?.[0];
    if (requestedId && !selected)
      throw new NotFoundException("Planner conversation not found.");
    let messages: any[] = [];
    if (selected) {
      const response = await this.db
        .from("active_planner_messages")
        .select("id,role,content,intent_type,analytics_kind,created_at")
        .eq("tenant_id", tenantId)
        .eq("conversation_id", selected.id)
        .eq("user_id", userId)
        .order("created_at", { ascending: true })
        .limit(200);
      if (response.error) throw new BadRequestException(response.error.message);
      messages = response.data || [];
    }
    return {
      conversations: (conversations || []).map((row: any) => ({
        id: row.id,
        title: row.title,
        message_count: row.message_count,
        created_at: row.created_at,
        last_message_at: row.last_message_at,
      })),
      active: selected
        ? {
            conversation: selected,
            messages,
          }
        : null,
    };
  }

  private async examples(tenantId: string) {
    const { data, error } = await this.db
      .from("active_planner_learning_examples")
      .select("utterance,intent_type,analytics_kind,language_code")
      .eq("tenant_id", tenantId)
      .eq("status", "VERIFIED")
      .order("updated_at", { ascending: false })
      .limit(12);
    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  async prepare(tenantId: string, user: any, body: any) {
    const userId = userIdOf(user);
    const message = clean(body?.message);
    let conversation = body?.conversation_id
      ? await this.ownedConversation(
          tenantId,
          userId,
          clean(body.conversation_id),
        )
      : await this.create(tenantId, user, message.slice(0, 80));
    const priorMessagesResponse = await this.db
      .from("active_planner_messages")
      .select("role,content,created_at")
      .eq("tenant_id", tenantId)
      .eq("conversation_id", conversation.id)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(12);
    if (priorMessagesResponse.error)
      throw new BadRequestException(priorMessagesResponse.error.message);
    const durableTranscript = (priorMessagesResponse.data || [])
      .slice()
      .reverse()
      .map((entry: any) => ({
        role: entry.role === "USER" ? "user" : "assistant",
        content: clean(entry.content).slice(0, 2000),
      }));
    const lastResult =
      conversation.last_result && typeof conversation.last_result === "object"
        ? conversation.last_result
        : null;
    const title =
      conversation.message_count === 0 &&
      conversation.title === "New conversation"
        ? message.slice(0, 80) || "New conversation"
        : conversation.title;
    const { error } = await this.db.from("active_planner_messages").insert({
      tenant_id: tenantId,
      conversation_id: conversation.id,
      user_id: userId,
      role: "USER",
      content: message,
    });
    if (error) throw new BadRequestException(error.message);
    if (title !== conversation.title) {
      await this.db
        .from("active_planner_conversations")
        .update({ title, updated_at: new Date().toISOString() })
        .eq("tenant_id", tenantId)
        .eq("user_id", userId)
        .eq("id", conversation.id);
      conversation = { ...conversation, title };
    }
    return {
      conversation,
      body: {
        ...body,
        conversation_id: conversation.id,
        // This field is always overwritten server-side. It restores semantic
        // continuity after the short-lived execution token expires, while the
        // next interpretation still produces a fresh governed action token.
        _memory_context: lastResult
          ? {
              transcript: durableTranscript,
              extracted: lastResult.extracted || null,
              resolved: lastResult.analytics
                ? { analytics: lastResult.analytics }
                : null,
            }
          : null,
        context_token:
          Date.now() - new Date(conversation.last_message_at).getTime() <
          25 * 60 * 1000
            ? clean(conversation.current_context_token)
            : undefined,
        learning_examples: await this.examples(tenantId),
      },
    };
  }

  private async observe(
    tenantId: string,
    userId: string,
    utterance: string,
    result: any,
  ) {
    if (!String(result?.status || "").startsWith("READY")) return;
    const normalized = normalizedUtterance(utterance);
    if (!normalized || result?.intent_type === "UNKNOWN") return;
    const hash = createHash("sha256").update(normalized).digest("hex");
    const analyticsKind = clean(result?.analytics?.kind) || null;
    let query = this.db
      .from("active_planner_learning_examples")
      .select("id,occurrence_count,positive_count,negative_count,status")
      .eq("tenant_id", tenantId)
      .eq("utterance_hash", hash)
      .eq("intent_type", result.intent_type);
    query = analyticsKind
      ? query.eq("analytics_kind", analyticsKind)
      : query.is("analytics_kind", null);
    const existing = await query.maybeSingle();
    if (existing.error) throw new BadRequestException(existing.error.message);
    const now = new Date().toISOString();
    if (!existing.data) {
      const inserted = await this.db
        .from("active_planner_learning_examples")
        .insert({
          tenant_id: tenantId,
          utterance: clean(utterance).slice(0, 2000),
          utterance_hash: hash,
          intent_type: result.intent_type,
          analytics_kind: analyticsKind,
          source: "SYSTEM_SUCCESS",
          status: "CANDIDATE",
          first_seen_by: userId,
          last_seen_by: userId,
        });
      if (inserted.error) throw new BadRequestException(inserted.error.message);
      return;
    }
    const occurrence = Number(existing.data.occurrence_count || 0) + 1;
    const update = await this.db
      .from("active_planner_learning_examples")
      .update({
        occurrence_count: occurrence,
        last_seen_by: userId,
        updated_at: now,
        status:
          existing.data.status === "CANDIDATE" &&
          occurrence >= 3 &&
          Number(existing.data.negative_count || 0) === 0
            ? "VERIFIED"
            : existing.data.status,
        verified_at:
          existing.data.status === "CANDIDATE" && occurrence >= 3
            ? now
            : undefined,
      })
      .eq("tenant_id", tenantId)
      .eq("id", existing.data.id);
    if (update.error) throw new BadRequestException(update.error.message);
  }

  async complete(
    tenantId: string,
    user: any,
    conversation: any,
    utterance: string,
    result: any,
    responseLanguage?: string,
  ) {
    const userId = userIdOf(user);
    const assistantMessage = await this.groundedAssistantMessage(
      tenantId,
      userId,
      utterance,
      result,
      responseLanguage,
    );
    const completedResult = {
      ...result,
      conversation_id: conversation.id,
      assistant_message: assistantMessage,
    };
    const now = new Date().toISOString();
    const { error: messageError } = await this.db
      .from("active_planner_messages")
      .insert({
        tenant_id: tenantId,
        conversation_id: conversation.id,
        user_id: userId,
        role: "PLANNER",
        content: assistantMessage,
        intent_type: result?.intent_type || null,
        analytics_kind: result?.analytics?.kind || null,
        provider: result?.provider || null,
        response_snapshot: completedResult,
      });
    if (messageError) throw new BadRequestException(messageError.message);
    const { error: conversationError } = await this.db
      .from("active_planner_conversations")
      .update({
        current_context_token: result?.context_token || null,
        last_result: completedResult,
        message_count: Number(conversation.message_count || 0) + 2,
        updated_at: now,
        last_message_at: now,
      })
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .eq("id", conversation.id);
    if (conversationError)
      throw new BadRequestException(conversationError.message);
    await this.observe(tenantId, userId, utterance, result);
    return completedResult;
  }

  async feedback(tenantId: string, user: any, body: any) {
    const userId = userIdOf(user);
    const conversation = await this.ownedConversation(
      tenantId,
      userId,
      clean(body?.conversation_id),
    );
    const helpful = body?.helpful === true;
    const correction = clean(body?.correction);
    if (correction.length > 500)
      throw new BadRequestException(
        "Correction must be 500 characters or less.",
      );
    const result = conversation.last_result || {};
    const { data: lastUser, error: userError } = await this.db
      .from("active_planner_messages")
      .select("content")
      .eq("tenant_id", tenantId)
      .eq("conversation_id", conversation.id)
      .eq("user_id", userId)
      .eq("role", "USER")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (userError || !lastUser)
      throw new BadRequestException(
        userError?.message || "No planner request is available for feedback.",
      );
    const normalized = normalizedUtterance(lastUser.content);
    const hash = createHash("sha256").update(normalized).digest("hex");
    const classifiedTarget =
      !helpful && correction
        ? await this.classifyCorrection(
            tenantId,
            userId,
            lastUser.content,
            correction,
          )
        : null;
    const analyticsKind = clean(result?.analytics?.kind) || null;
    const correctedTarget =
      classifiedTarget &&
      (classifiedTarget.intent_type !== (result?.intent_type || "UNKNOWN") ||
        classifiedTarget.analytics_kind !== analyticsKind)
        ? classifiedTarget
        : null;
    let query = this.db
      .from("active_planner_learning_examples")
      .select("id,positive_count,negative_count")
      .eq("tenant_id", tenantId)
      .eq("utterance_hash", hash)
      .eq("intent_type", result?.intent_type || "UNKNOWN");
    query = analyticsKind
      ? query.eq("analytics_kind", analyticsKind)
      : query.is("analytics_kind", null);
    const example = await query.maybeSingle();
    if (example.error) throw new BadRequestException(example.error.message);
    const now = new Date().toISOString();
    if (!example.data) {
      if (helpful)
        throw new BadRequestException(
          "Only a successfully resolved interpretation can be verified for learning.",
        );
      const { error: rejectedError } = await this.db
        .from("active_planner_learning_examples")
        .insert({
          tenant_id: tenantId,
          utterance: clean(lastUser.content).slice(0, 2000),
          utterance_hash: hash,
          intent_type: result?.intent_type || "UNKNOWN",
          analytics_kind: analyticsKind,
          source: "USER_FEEDBACK",
          status: "REJECTED",
          occurrence_count: 1,
          negative_count: 1,
          first_seen_by: userId,
          last_seen_by: userId,
        });
      if (rejectedError) throw new BadRequestException(rejectedError.message);
      if (correctedTarget)
        await this.rememberVerifiedCorrection(
          tenantId,
          userId,
          lastUser.content,
          hash,
          correctedTarget,
        );
      return {
        recorded: true,
        helpful: false,
        correction_verified: Boolean(correctedTarget),
        corrected_target: correctedTarget,
        learning: correctedTarget
          ? "The incorrect interpretation was rejected and your corrected meaning was saved as a verified tenant example."
          : "This incorrect interpretation was rejected and will not be reused.",
        operational_values_learned: false,
      };
    }
    const { error } = await this.db
      .from("active_planner_learning_examples")
      .update({
        source: "USER_FEEDBACK",
        status: helpful ? "VERIFIED" : "REJECTED",
        positive_count:
          Number(example.data.positive_count || 0) + (helpful ? 1 : 0),
        negative_count:
          Number(example.data.negative_count || 0) + (helpful ? 0 : 1),
        verified_by: helpful ? userId : null,
        verified_at: helpful ? now : null,
        updated_at: now,
      })
      .eq("tenant_id", tenantId)
      .eq("id", example.data.id);
    if (error) throw new BadRequestException(error.message);
    if (correctedTarget)
      await this.rememberVerifiedCorrection(
        tenantId,
        userId,
        lastUser.content,
        hash,
        correctedTarget,
      );
    return {
      recorded: true,
      helpful,
      correction_verified: Boolean(correctedTarget),
      corrected_target: correctedTarget,
      learning: helpful
        ? "This phrasing is now a verified tenant example for intent recognition."
        : correctedTarget
          ? "The incorrect interpretation was rejected and your corrected meaning was saved as a verified tenant example."
          : "This phrasing was rejected and will not be used as a learning example.",
      operational_values_learned: false,
    };
  }
}
