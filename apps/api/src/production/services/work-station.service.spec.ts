import { operationQueuePosition } from "./work-station.service";

describe("shop-floor operation queue", () => {
  it("makes the first operation available up to its remaining target", () => {
    expect(operationQueuePosition(100, 25, 30)).toEqual({
      target_remaining: 75,
      input_available: 75,
      ready: true,
    });
  });

  it("limits a downstream operation to completed upstream WIP", () => {
    expect(operationQueuePosition(100, 20, 25, 40)).toEqual({
      target_remaining: 80,
      input_available: 15,
      ready: true,
    });
  });

  it("blocks a downstream operation when no upstream WIP remains", () => {
    expect(operationQueuePosition(100, 20, 40, 40)).toEqual({
      target_remaining: 80,
      input_available: 0,
      ready: false,
    });
  });
});
