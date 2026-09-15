import { detectAnalyticsQuestionKind } from "../intelligence/conversational-analytics.service";

describe("Mizantra Field Sales plain-language questions", () => {
  it.each([
    "Who should I visit today?",
    "show my customer visits",
    "what is my day route",
    "which visits need location review",
    "show the field sales visit plan",
    "where am I going today?",
    "who do I need to meet today?",
    "what customer appointments do I have?",
    "show customers I have not seen for a while",
    "how is my field sales team doing?",
    "show the visit reps performance",
    "did we miss any customer visits today?",
  ])("recognises %s", (question) => {
    expect(detectAnalyticsQuestionKind(question)).toBe("FIELD_SALES");
  });

  it("does not confuse employee attendance check-in with a field visit", () => {
    expect(detectAnalyticsQuestionKind("which employees checked in late today")).toBe("EMPLOYEE_ATTENDANCE");
  });
});
