import { BadRequestException } from "@nestjs/common";
import {
  calculatedToolUsage,
  normalizeCompletionQuantities,
  normalizeReworkQuantity,
  normalizeDowntimeReason,
  toolLifeUnit,
  partialProductionSummary,
} from "./station-completion.service";

describe("shop-floor completion controls", () => {
  it("accepts good and rejected quantities as one processed batch", () => {
    expect(normalizeCompletionQuantities(8, 2)).toEqual({
      good: 8,
      reject: 2,
      processed: 10,
    });
  });

  it("allows a fully rejected batch so the loss is recorded", () => {
    expect(normalizeCompletionQuantities(0, 5)).toEqual({
      good: 0,
      reject: 5,
      processed: 5,
    });
  });

  it("rejects negative rework through the completion validation contract", () => {
    expect(normalizeReworkQuantity(3)).toBe(3);
    expect(normalizeReworkQuantity(undefined)).toBe(0);
    expect(() => normalizeReworkQuantity(-1)).toThrow(BadRequestException);
    expect(() => normalizeReworkQuantity("invalid")).toThrow(
      BadRequestException,
    );
  });

  it.each([
    [-1, 0],
    [0, -1],
    [0, 0],
    ["invalid", 1],
  ])("rejects an invalid completion payload (%s, %s)", (good, reject) => {
    expect(() => normalizeCompletionQuantities(good, reject)).toThrow(
      BadRequestException,
    );
  });

  it("requires a structured downtime reason for manual pauses", () => {
    expect(
      normalizeDowntimeReason({
        loss_category: "roll_change",
        reason: "60 kg wire roll exhausted",
        source: "MANUAL",
      }),
    ).toEqual({
      lossCategory: "ROLL_CHANGE",
      reason: "60 kg wire roll exhausted",
      source: "MANUAL",
    });
    expect(() =>
      normalizeDowntimeReason({ loss_category: "POWER", reason: "" }),
    ).toThrow(BadRequestException);
  });

  it("charges a kg-life punch from actual wire processed", () => {
    expect(
      calculatedToolUsage({
        basis: "KG_INPUT",
        good: 10000,
        rejected: 100,
        actualInputKg: 82.4,
        actualMinutes: 180,
      }),
    ).toBe(82.4);
    expect(toolLifeUnit("KG_INPUT")).toBe("KG");
  });

  it("derives mould strokes from total pieces and cavities", () => {
    expect(
      calculatedToolUsage({
        basis: "STROKES",
        good: 1190,
        rejected: 10,
        actualMinutes: 60,
        cavities: 12,
      }),
    ).toBe(100);
  });

  it("supports piece, batch and runtime life bases", () => {
    const base = { good: 950, rejected: 50, actualMinutes: 120 };
    expect(calculatedToolUsage({ ...base, basis: "GOOD_PIECES" })).toBe(950);
    expect(calculatedToolUsage({ ...base, basis: "TOTAL_PIECES" })).toBe(1000);
    expect(
      calculatedToolUsage({ ...base, basis: "BATCHES", batchCount: 3 }),
    ).toBe(3);
    expect(calculatedToolUsage({ ...base, basis: "RUN_HOURS" })).toBe(2);
  });

  it("shows the remaining plan after a short production run", () => {
    expect(
      partialProductionSummary({
        planned: 500,
        priorGood: 0,
        priorRejected: 0,
        currentGood: 420,
        currentRejected: 10,
      }),
    ).toEqual({
      planned_quantity: 500,
      good_quantity: 420,
      rejected_quantity: 10,
      processed_quantity: 430,
      remaining_quantity: 80,
      is_partial: true,
    });
  });

  it("does not request a balance decision once good output meets plan", () => {
    expect(
      partialProductionSummary({
        planned: 500,
        priorGood: 300,
        priorRejected: 5,
        currentGood: 200,
        currentRejected: 0,
      }).is_partial,
    ).toBe(false);
  });
});
