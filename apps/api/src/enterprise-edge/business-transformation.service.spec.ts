import {
  buildDeterministicTransformationAdvice,
  calculateTransformationProgress,
} from "./business-transformation.service";

describe("Business Transformation progress", () => {
  it("calculates increasing KPI progress", () => {
    expect(calculateTransformationProgress(70, 90, 80, "INCREASE")).toBe(50);
  });

  it("calculates decreasing KPI progress", () => {
    expect(calculateTransformationProgress(10, 4, 7, "DECREASE")).toBe(50);
  });

  it("caps overachievement and prevents negative progress", () => {
    expect(calculateTransformationProgress(70, 90, 95, "INCREASE")).toBe(100);
    expect(calculateTransformationProgress(70, 90, 60, "INCREASE")).toBe(0);
  });

  it("fails closed for an invalid zero-range target", () => {
    expect(calculateTransformationProgress(70, 70, 70, "INCREASE")).toBe(0);
  });
});

describe("Business Transformation deterministic advisor", () => {
  it("fails closed when no governed evidence exists", () => {
    const advice = buildDeterministicTransformationAdvice({ objectives: [] });
    expect(advice.business_health).toBe("NO_DATA");
    expect(advice.priorities).toEqual([]);
    expect(advice.missing_evidence.length).toBeGreaterThan(0);
  });

  it("prioritizes an evidence gap without granting execution authority", () => {
    const advice = buildDeterministicTransformationAdvice({
      kpis: { objectives_at_risk: 1 },
      objectives: [
        {
          id: "objective-1",
          objective_code: "OTIF",
          title: "Improve on-time delivery",
          health: "AT_RISK",
          progress_pct: 25,
          kpis: [],
          actions: [],
        },
      ],
    });
    expect(advice.business_health).toBe("AT_RISK");
    expect(advice.priorities[0]).toMatchObject({
      objective_id: "objective-1",
      category: "EVIDENCE_GAP",
      requires_human_approval: true,
    });
    expect(advice.guardrails.join(" ")).toMatch(/no business record/i);
  });
});
