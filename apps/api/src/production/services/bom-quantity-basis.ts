export type BomQuantityBasis =
  | "PER_OUTPUT"
  | "PER_BATCH"
  | "FIXED_SETUP"
  | "FORMULA";

export function scaleBomLineQuantity(
  line: {
    quantity?: number | string | null;
    quantity_basis?: BomQuantityBasis | string | null;
  },
  finishedQuantity: number,
  bomOutputQuantity = 1,
) {
  const quantity = Number(line?.quantity || 0);
  const demand = Number(finishedQuantity || 0);
  const output = Number(bomOutputQuantity || 1);
  const basis = String(line?.quantity_basis || "PER_OUTPUT").toUpperCase();
  if (!(quantity >= 0) || !(demand >= 0) || !(output > 0)) return 0;
  if (basis === "FIXED_SETUP") return demand > 0 ? quantity : 0;
  if (basis === "PER_BATCH") return Math.ceil(demand / output) * quantity;
  return (demand / output) * quantity;
}
