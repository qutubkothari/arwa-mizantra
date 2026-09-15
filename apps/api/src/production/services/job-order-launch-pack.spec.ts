import { BadRequestException } from "@nestjs/common";
import {
  buildProductionLaunchPack,
  consolidateMasterPurchaseShortages,
  requireExecutableRouting,
} from "./job-order.service";

describe("buildProductionLaunchPack", () => {
  it("prepares the complete controlled production handoff", () => {
    const pack = buildProductionLaunchPack(
      {
        id: "job-1",
        job_order_number: "JO-2026-001",
        linked_pr_number: "PR-2026-001",
        materials: [{ id: "m1" }, { id: "m2" }],
        operations: [{ id: "o1" }, { id: "o2" }, { id: "o3" }],
      },
      "2026-09-08T10:00:00.000Z",
    );

    expect(pack.job_order_number).toBe("JO-2026-001");
    expect(pack.steps).toHaveLength(7);
    expect(
      pack.steps.find((step) => step.code === "SHORTAGE_PR"),
    ).toMatchObject({
      status: "DRAFT_CREATED",
      reference: "PR-2026-001",
    });
    expect(
      pack.steps.find((step) => step.code === "MATERIAL_ISSUE"),
    ).toMatchObject({
      status: "PREPARED",
      count: 2,
      requires_confirmation: true,
    });
    expect(
      pack.steps.find((step) => step.code === "OPERATION_SCHEDULE"),
    ).toMatchObject({
      status: "PREPARED",
      count: 3,
    });
    expect(pack.steps.find((step) => step.code === "QUALITY")?.status).toBe(
      "AWAITING_PHYSICAL_EVENT",
    );
    expect(pack.physical_confirmations).toHaveLength(4);
  });

  it("marks shortage purchasing as unnecessary when stock is sufficient", () => {
    const pack = buildProductionLaunchPack({
      id: "job-2",
      job_order_number: "JO-2026-002",
      materials: [],
      operations: [],
    });

    expect(pack.steps.find((step) => step.code === "SHORTAGE_PR")?.status).toBe(
      "NOT_REQUIRED",
    );
  });
});

describe("requireExecutableRouting", () => {
  it("blocks a manufactured Job Order when no route exists", () => {
    expect(() => requireExecutableRouting([])).toThrow(BadRequestException);
  });

  it("blocks incomplete route rows and accepts executable processes", () => {
    expect(() =>
      requireExecutableRouting([
        { operation_name: "Threading", work_station_id: "" },
      ]),
    ).toThrow("work station");
    expect(
      requireExecutableRouting([
        { operation_name: "Threading", work_station_id: "station-1" },
      ]),
    ).toHaveLength(1);
  });
});

describe("consolidateMasterPurchaseShortages", () => {
  it("groups the same purchased item across parent and child BOM branches", () => {
    const result = consolidateMasterPurchaseShortages([
      {
        level: 1,
        componentType: "ITEM",
        bomId: "bom-child-a",
        itemId: "item-sheet",
        itemCode: "RM-SHEET",
        itemName: "GI Sheet",
        requiredQuantity: 12,
        availableQuantity: 4,
        stockAllocatedQuantity: 4,
        scheduledSupplyQuantity: 0,
        shortageQuantity: 8,
        toMakeQuantity: 0,
        supplyPolicy: "AUTO",
        supplyAction: "ISSUE",
        sourceBomItemId: "line-a",
      },
      {
        level: 1,
        componentType: "ITEM",
        bomId: "bom-child-b",
        itemId: "item-sheet",
        itemCode: "RM-SHEET",
        itemName: "GI Sheet",
        requiredQuantity: 10,
        availableQuantity: 0,
        stockAllocatedQuantity: 0,
        scheduledSupplyQuantity: 2,
        shortageQuantity: 8,
        toMakeQuantity: 0,
        supplyPolicy: "BUY",
        supplyAction: "BUY",
        sourceBomItemId: "line-b",
      },
    ]);

    expect(result).toEqual([
      expect.objectContaining({
        itemId: "item-sheet",
        required: 22,
        available: 6,
        shortage: 16,
        sourceBomItemId: null,
      }),
    ]);
  });

  it("excludes make, subcontract, review and fully supplied components", () => {
    const base = {
      level: 0,
      componentType: "BOM" as const,
      bomId: "bom",
      itemId: "item",
      itemCode: "SA-1",
      itemName: "Sub Assembly",
      requiredQuantity: 5,
      availableQuantity: 0,
      stockAllocatedQuantity: 0,
      scheduledSupplyQuantity: 0,
      shortageQuantity: 5,
      toMakeQuantity: 5,
    };
    expect(
      consolidateMasterPurchaseShortages([
        { ...base, itemId: "make", supplyAction: "BUILD" },
        { ...base, itemId: "outside", supplyAction: "SUBCONTRACT" },
        { ...base, itemId: "review", supplyAction: "REVIEW" },
        {
          ...base,
          itemId: "ready",
          shortageQuantity: 0,
          supplyAction: "RESERVE",
        },
      ]),
    ).toEqual([]);
  });

  it("keeps an explicitly purchased sub-assembly as a PR line", () => {
    expect(
      consolidateMasterPurchaseShortages([
        {
          level: 0,
          componentType: "BOM",
          bomId: "bom-external",
          itemId: "external-sa",
          itemCode: "SA-BUY",
          itemName: "Purchased Sub Assembly",
          requiredQuantity: 5,
          availableQuantity: 1,
          stockAllocatedQuantity: 1,
          scheduledSupplyQuantity: 0,
          shortageQuantity: 4,
          toMakeQuantity: 0,
          supplyPolicy: "BUY",
          supplyAction: "BUY",
        },
      ]),
    ).toEqual([
      expect.objectContaining({ itemId: "external-sa", shortage: 4 }),
    ]);
  });
});
