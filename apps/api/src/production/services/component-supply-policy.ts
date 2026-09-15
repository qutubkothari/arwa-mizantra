export const COMPONENT_SUPPLY_POLICIES = [
  "AUTO",
  "MAKE",
  "BUY",
  "SUBCONTRACT",
  "DIRECT",
  "PHANTOM",
  "PLANNER_CHOICE",
] as const;

export type ComponentSupplyPolicy = (typeof COMPONENT_SUPPLY_POLICIES)[number];

export function normalizeComponentSupplyPolicy(
  value: unknown,
  hasBom: boolean,
): ComponentSupplyPolicy {
  const normalized = String(value || "AUTO")
    .trim()
    .toUpperCase();
  if (COMPONENT_SUPPLY_POLICIES.includes(normalized as ComponentSupplyPolicy)) {
    return normalized as ComponentSupplyPolicy;
  }
  return hasBom ? "MAKE" : "DIRECT";
}

export function planComponentSupply(input: {
  requiredQuantity: unknown;
  availableQuantity: unknown;
  scheduledSupplyQuantity?: unknown;
  supplyPolicy?: unknown;
  hasBom: boolean;
}) {
  const required = Math.max(0, Number(input.requiredQuantity || 0));
  const available = Math.max(0, Number(input.availableQuantity || 0));
  const scheduled = Math.max(0, Number(input.scheduledSupplyQuantity || 0));
  const policy = normalizeComponentSupplyPolicy(
    input.supplyPolicy,
    input.hasBom,
  );
  // A phantom is a planning structure, not a stocked component. Its children
  // must be exploded for the entire parent requirement irrespective of any
  // accidental inventory balance on the phantom item code.
  const stockUsed = policy === "PHANTOM" ? 0 : Math.min(required, available);
  const remainingAfterStock = Math.max(0, required - stockUsed);
  const scheduledUsed =
    policy === "PHANTOM" ? 0 : Math.min(remainingAfterStock, scheduled);
  const shortage = Math.max(0, remainingAfterStock - scheduledUsed);

  const action =
    shortage <= 0
      ? "RESERVE"
      : policy === "PHANTOM"
        ? "EXPLODE"
        : policy === "MAKE" || (policy === "AUTO" && input.hasBom)
          ? "BUILD"
          : policy === "BUY"
            ? "BUY"
            : policy === "SUBCONTRACT"
              ? "SUBCONTRACT"
              : policy === "PLANNER_CHOICE"
                ? "REVIEW"
                : "ISSUE";

  return {
    policy,
    action,
    requiredQuantity: Number(required.toFixed(4)),
    stockUsedQuantity: Number(stockUsed.toFixed(4)),
    scheduledSupplyUsedQuantity: Number(scheduledUsed.toFixed(4)),
    shortageQuantity: Number(shortage.toFixed(4)),
    remainingStockQuantity: Number(
      Math.max(0, available - stockUsed).toFixed(4),
    ),
    remainingScheduledSupplyQuantity: Number(
      Math.max(0, scheduled - scheduledUsed).toFixed(4),
    ),
    createJobOrder: shortage > 0 && action === "BUILD",
    explodeChildren:
      policy === "PHANTOM" || (shortage > 0 && action === "BUILD"),
    childExplosionQuantity:
      policy === "PHANTOM" ? required : action === "BUILD" ? shortage : 0,
  };
}
