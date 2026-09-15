import {
  assertVisitTransition,
  evaluateLocation,
  haversineMetres,
  payloadHash,
  recommendationScore,
  recurrenceDates,
} from "./fsm.domain";

describe("FSM domain acceptance controls", () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(new Date("2026-09-11T10:00:00Z")));
  afterEach(() => jest.useRealTimers());

  it("AT-05 generates canonical recurrence dates deterministically", () => {
    const rule = { starts_on: "2026-09-01", frequency: "WEEKLY", weekday: 2 };
    const first = recurrenceDates(rule, "2026-09-01", "2026-09-30");
    expect(first).toEqual(["2026-09-01", "2026-09-08", "2026-09-15", "2026-09-22", "2026-09-29"]);
    expect(recurrenceDates(rule, "2026-09-01", "2026-09-30")).toEqual(first);
  });

  it("AT-12 flags stale and outside evidence", () => {
    const policy = { radiusM: 100, maxAgeSeconds: 120, maxAccuracyM: 50 };
    const site = { latitude: 22.5726, longitude: 88.3639 };
    expect(evaluateLocation({ latitude: 22.5726, longitude: 88.3639, accuracy_m: 10, captured_at: "2026-09-11T09:50:00Z" }, site, policy).status).toBe("STALE");
    expect(evaluateLocation({ latitude: 23.5726, longitude: 88.3639, accuracy_m: 10, captured_at: "2026-09-11T09:59:30Z" }, site, policy).status).toBe("OUTSIDE");
  });

  it("AT-14 rejects an invalid lifecycle transition", () => {
    expect(() => assertVisitTransition("PLANNED", "COMPLETED")).toThrow();
  });

  it("AT-20 hashes equal payloads equally and changed payloads differently", () => {
    expect(payloadHash({ b: 2, a: 1 })).toBe(payloadHash({ a: 1, b: 2 }));
    expect(payloadHash({ a: 1 })).not.toBe(payloadHash({ a: 2 }));
  });

  it("explains deterministic recommendation scores", () => {
    expect(recommendationScore({ daysSinceVisit: 60, overdueAmount: 100000 }).reasons).toContain("Receivable follow-up is due");
    expect(haversineMetres(0, 0, 0, 0)).toBe(0);
  });
});
