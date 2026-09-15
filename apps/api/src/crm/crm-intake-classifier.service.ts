import { Injectable } from "@nestjs/common";
import { AiProviderService } from "../ai/ai-provider.service";

export const CRM_INTAKE_CLASSES = [
  "NEW_ENQUIRY",
  "CONTINUATION",
  "ORDER_INTENT",
  "SERVICE_SUPPORT",
  "SUPPLIER_PROCUREMENT",
  "FINANCE",
  "IRRELEVANT",
  "SPAM",
  "OTHER",
] as const;

export type CrmIntakeClass = (typeof CRM_INTAKE_CLASSES)[number];

export type CrmIntakeClassification = {
  classification: CrmIntakeClass;
  confidence: number;
  rationale: string;
  should_create_lead: boolean;
  company_name: string | null;
  contact_person: string | null;
  requirement_summary: string | null;
  product_interest: string | null;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  expected_value: number | null;
  currency_code: string | null;
};

export type CrmIntakeInput = {
  tenantId: string;
  actorId?: string;
  channel: "WHATSAPP" | "EMAIL" | "WEBSITE" | "API" | "CAMPAIGN";
  senderName?: string | null;
  senderAddress?: string | null;
  subject?: string | null;
  body?: string | null;
  hasAttachments?: boolean;
  existingLead?: {
    id: string;
    lead_number?: string;
    company_name?: string;
    requirement?: string;
    stage_name?: string;
  } | null;
  existingCustomer?: { id: string; customer_name?: string } | null;
  recentConversation?: Array<{
    classification?: string;
    subject?: string | null;
    body_preview?: string | null;
  }>;
};

@Injectable()
export class CrmIntakeClassifierService {
  constructor(private readonly ai: AiProviderService) {}

  private clean(value: unknown, max = 4000) {
    return String(value ?? "").trim().slice(0, max);
  }

  private fallback(input: CrmIntakeInput): CrmIntakeClassification {
    const content = `${this.clean(input.subject, 500)} ${this.clean(input.body, 4000)}`.trim();
    if (!content) {
      return {
        classification: "OTHER",
        confidence: 1,
        rationale: "No message content was available for classification.",
        should_create_lead: false,
        company_name: null,
        contact_person: null,
        requirement_summary: null,
        product_interest: null,
        priority: "LOW",
        expected_value: null,
        currency_code: null,
      };
    }
    return {
      classification: input.existingLead ? "CONTINUATION" : "OTHER",
      confidence: input.existingLead ? 0.55 : 0.2,
      rationale: input.existingLead
        ? "AI was unavailable; an exact existing CRM identity was found, so the message is retained as a possible continuation for review."
        : "AI was unavailable and no existing CRM identity was found; the message is held for review and no lead is created.",
      should_create_lead: false,
      company_name: input.existingLead?.company_name || null,
      contact_person: input.senderName || null,
      requirement_summary: this.clean(input.body, 1000) || null,
      product_interest: null,
      priority: "MEDIUM",
      expected_value: null,
      currency_code: null,
    };
  }

  async classify(input: CrmIntakeInput) {
    const fallback = this.fallback(input);
    const result = await this.ai.structuredJson<CrmIntakeClassification>({
      capability: "crm_omnichannel_intake_classification",
      scope: `tenant:${input.tenantId}`,
      actorId: input.actorId,
      cacheTtlMs: 0,
      system:
        "You classify inbound business communications for an ERP CRM. Understand meaning and conversation context, not keywords alone. " +
        "NEW_ENQUIRY means a genuine new request for pricing, product, availability, proposal, demo, or commercial information from a prospect with enough substance for sales action. " +
        "CONTINUATION means a reply, clarification, greeting, acknowledgement, or follow-up belonging to an existing lead/customer conversation. " +
        "ORDER_INTENT means a purchase order, order confirmation, intent to buy, or order-status message; never create an order automatically. " +
        "SERVICE_SUPPORT means complaint, fault, warranty, installation, maintenance, or support. SUPPLIER_PROCUREMENT means supplier quote, vendor response, purchase-side invoice, dispatch, or procurement discussion. " +
        "FINANCE means payment, remittance, statement, tax, collection, or account discussion. IRRELEVANT/SPAM includes newsletters, promotions, automated alerts, job applications, personal chat, and unrelated mail. " +
        "A short greeting, thanks, emoji, or vague message is not a new enquiry. If an exact existing lead is provided, normally classify a related message as CONTINUATION or the relevant operational class. " +
        "Set should_create_lead true only for a confident NEW_ENQUIRY. Extract facts only when explicitly present; do not invent names, values, products, or currency. Return concise rationale.",
      data: {
        channel: input.channel,
        sender_name: this.clean(input.senderName, 200) || null,
        sender_address: this.clean(input.senderAddress, 320) || null,
        subject: this.clean(input.subject, 500) || null,
        body: this.clean(input.body, 12000) || null,
        has_attachments: Boolean(input.hasAttachments),
        exact_existing_lead: input.existingLead || null,
        exact_existing_customer: input.existingCustomer || null,
        recent_conversation: (input.recentConversation || []).slice(0, 8),
      },
      fallback,
      jsonSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          classification: { type: "string", enum: [...CRM_INTAKE_CLASSES] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          rationale: { type: "string" },
          should_create_lead: { type: "boolean" },
          company_name: { type: ["string", "null"] },
          contact_person: { type: ["string", "null"] },
          requirement_summary: { type: ["string", "null"] },
          product_interest: { type: ["string", "null"] },
          priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "URGENT"] },
          expected_value: { type: ["number", "null"], minimum: 0 },
          currency_code: { type: ["string", "null"] },
        },
        required: [
          "classification", "confidence", "rationale", "should_create_lead",
          "company_name", "contact_person", "requirement_summary", "product_interest",
          "priority", "expected_value", "currency_code"
        ],
      },
    });
    const value = result.value;
    const classification = CRM_INTAKE_CLASSES.includes(value.classification)
      ? value.classification
      : "OTHER";
    return {
      ...result,
      value: {
        ...value,
        classification,
        confidence: Math.max(0, Math.min(1, Number(value.confidence || 0))),
        should_create_lead:
          classification === "NEW_ENQUIRY" && value.should_create_lead === true,
        rationale: this.clean(value.rationale, 1000) || fallback.rationale,
        company_name: this.clean(value.company_name, 200) || null,
        contact_person: this.clean(value.contact_person, 160) || null,
        requirement_summary: this.clean(value.requirement_summary, 4000) || null,
        product_interest: this.clean(value.product_interest, 240) || null,
        expected_value:
          value.expected_value == null
            ? null
            : Math.max(0, Number(value.expected_value) || 0),
        currency_code: this.clean(value.currency_code, 10).toUpperCase() || null,
      } as CrmIntakeClassification,
    };
  }
}
