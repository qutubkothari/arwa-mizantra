import { scaleBomLineQuantity } from "./bom-quantity-basis";

describe("scaleBomLineQuantity", () => {
  it("scales component quantity by the BOM output basis", () => {
    expect(scaleBomLineQuantity({ quantity: 5 }, 250, 100)).toBe(12.5);
  });

  it("supports batch and fixed setup consumption", () => {
    expect(
      scaleBomLineQuantity(
        { quantity: 2, quantity_basis: "PER_BATCH" },
        250,
        100,
      ),
    ).toBe(6);
    expect(
      scaleBomLineQuantity(
        { quantity: 3, quantity_basis: "FIXED_SETUP" },
        250,
        100,
      ),
    ).toBe(3);
  });
});
