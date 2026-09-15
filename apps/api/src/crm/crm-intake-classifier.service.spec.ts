import { CrmIntakeClassifierService } from "./crm-intake-classifier.service";

describe("CrmIntakeClassifierService", () => {
  it("never creates a lead when AI is unavailable and no identity exists", async () => {
    const ai = {
      structuredJson: jest.fn(async (request: any) => ({
        value: request.fallback,
        provider: "DETERMINISTIC_FALLBACK",
        model: null,
        fallback_used: true,
        latency_ms: 0,
      })),
    } as any;
    const service = new CrmIntakeClassifierService(ai);
    const result = await service.classify({
      tenantId: "11111111-1111-4111-8111-111111111111",
      channel: "WHATSAPP",
      senderAddress: "919999999999",
      body: "Hello",
    });
    expect(result.value.classification).toBe("OTHER");
    expect(result.value.should_create_lead).toBe(false);
    expect(result.fallback_used).toBe(true);
  });

  it("retains an existing conversation for review during provider failure", async () => {
    const ai = {
      structuredJson: jest.fn(async (request: any) => ({
        value: request.fallback,
        provider: "DETERMINISTIC_FALLBACK",
        model: null,
        fallback_used: true,
        latency_ms: 0,
      })),
    } as any;
    const service = new CrmIntakeClassifierService(ai);
    const result = await service.classify({
      tenantId: "11111111-1111-4111-8111-111111111111",
      channel: "EMAIL",
      body: "Please revise the quantity discussed yesterday.",
      existingLead: { id: "lead-1", company_name: "Example Marine" },
    });
    expect(result.value.classification).toBe("CONTINUATION");
    expect(result.value.should_create_lead).toBe(false);
  });

  it("accepts a governed AI enquiry decision and preserves extracted facts", async () => {
    const value = {
      classification: "NEW_ENQUIRY",
      confidence: 0.94,
      rationale: "A prospect requested a priced proposal for a named product.",
      should_create_lead: true,
      company_name: "Ocean Systems",
      contact_person: "Amina",
      requirement_summary: "Quotation for ten navigation displays",
      product_interest: "Navigation display",
      priority: "HIGH",
      expected_value: 250000,
      currency_code: "inr",
    };
    const ai = {
      structuredJson: jest.fn(async () => ({
        value,
        provider: "OPENAI",
        model: "test-model",
        fallback_used: false,
        latency_ms: 1,
      })),
    } as any;
    const service = new CrmIntakeClassifierService(ai);
    const result = await service.classify({
      tenantId: "11111111-1111-4111-8111-111111111111",
      channel: "EMAIL",
      subject: "Navigation displays",
      body: "Please quote ten units.",
    });
    expect(result.value).toEqual(expect.objectContaining({
      classification: "NEW_ENQUIRY",
      should_create_lead: true,
      confidence: 0.94,
      currency_code: "INR",
    }));
  });

  it("blocks lead creation when the provider returns a non-enquiry class", async () => {
    const ai = {
      structuredJson: jest.fn(async () => ({
        value: {
          classification: "ORDER_INTENT",
          confidence: 0.98,
          rationale: "The sender attached a purchase order.",
          should_create_lead: true,
          company_name: "Ocean Systems",
          contact_person: null,
          requirement_summary: "Purchase order received",
          product_interest: null,
          priority: "HIGH",
          expected_value: null,
          currency_code: null,
        },
        provider: "OPENAI",
        model: "test-model",
        fallback_used: false,
        latency_ms: 1,
      })),
    } as any;
    const service = new CrmIntakeClassifierService(ai);
    const result = await service.classify({
      tenantId: "11111111-1111-4111-8111-111111111111",
      channel: "EMAIL",
      body: "Attached is our PO.",
    });
    expect(result.value.classification).toBe("ORDER_INTENT");
    expect(result.value.should_create_lead).toBe(false);
  });
});
