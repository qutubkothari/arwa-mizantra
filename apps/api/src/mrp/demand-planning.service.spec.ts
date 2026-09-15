import { buildDemandPlanFingerprint } from "./demand-planning.service";

describe("demand planning freeze", () => {
  it("builds the same fingerprint regardless of line and bucket ordering", () => {
    const first = buildDemandPlanFingerprint([
      { item_id: "b", consensus_forecast: [{ month: "2026-10", quantity: 2 }] },
      {
        item_id: "a",
        consensus_forecast: [
          { month: "2026-11", quantity: 3 },
          { month: "2026-10", quantity: 1 },
        ],
      },
    ]);
    const second = buildDemandPlanFingerprint([
      {
        item_id: "a",
        consensus_forecast: [
          { month: "2026-10", quantity: 1 },
          { month: "2026-11", quantity: 3 },
        ],
      },
      { item_id: "b", consensus_forecast: [{ month: "2026-10", quantity: 2 }] },
    ]);
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes the fingerprint when approved quantity changes", () => {
    const original = buildDemandPlanFingerprint([
      {
        item_id: "a",
        consensus_forecast: [{ month: "2026-10", quantity: 10 }],
      },
    ]);
    const changed = buildDemandPlanFingerprint([
      {
        item_id: "a",
        consensus_forecast: [{ month: "2026-10", quantity: 11 }],
      },
    ]);
    expect(changed).not.toBe(original);
  });
});
