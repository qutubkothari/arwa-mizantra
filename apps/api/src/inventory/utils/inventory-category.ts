export const INVENTORY_CATEGORIES = [
  'RAW_MATERIAL',
  'SUB_ASSEMBLY',
  'CAPITAL_GOODS',
  'CONSUMABLE',
  'SERVICES',
  'FINISHED_GOODS',
] as const;

export type InventoryCategory = (typeof INVENTORY_CATEGORIES)[number];

const INVENTORY_CATEGORY_SET = new Set<string>(INVENTORY_CATEGORIES);

const normalizeKey = (value: unknown) =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');

export function normalizeInventoryCategory(
  value: unknown,
  fallback: InventoryCategory = 'RAW_MATERIAL',
): InventoryCategory {
  const key = normalizeKey(value);
  if (!key) return fallback;
  if (INVENTORY_CATEGORY_SET.has(key)) return key as InventoryCategory;

  const mapped: Record<string, InventoryCategory> = {
    // Common plural/singular mismatches
    CONSUMABLES: 'CONSUMABLE',
    SERVICE: 'SERVICES',
    SERVICES_PURCHASE: 'SERVICES',
    CAPITAL_GOOD: 'CAPITAL_GOODS',
    RAW_MATERIALS: 'RAW_MATERIAL',
    SUB: 'SUB_ASSEMBLY',
    SUBASSEMBLY: 'SUB_ASSEMBLY',
    SUB_ASSEMBLIES: 'SUB_ASSEMBLY',
    FINISHED: 'FINISHED_GOODS',
    FINISHED_GOOD: 'FINISHED_GOODS',
    FG: 'FINISHED_GOODS',
    PACKING: 'RAW_MATERIAL',
    PACKING_MATERIAL: 'RAW_MATERIAL',
  };

  return mapped[key] ?? fallback;
}

export type InventoryStockCategory =
  | 'RAW_MATERIAL'
  | 'WIP'
  | 'FINISHED_GOODS'
  | 'DEMO'
  | 'SERVICE_SPARES'
  | 'CONSUMABLES';

/**
 * inventory_stock uses the older database enum while the item master uses the
 * commercial material categories above. Keep the conversion explicit at the
 * inventory-posting boundary so item categories never reach the RPC verbatim.
 */
export function normalizeInventoryStockCategory(
  value: unknown,
  fallback: InventoryStockCategory = 'RAW_MATERIAL',
): InventoryStockCategory {
  const key = normalizeKey(value);
  const mapped: Record<string, InventoryStockCategory> = {
    RAW_MATERIAL: 'RAW_MATERIAL',
    RAW_MATERIALS: 'RAW_MATERIAL',
    PACKING: 'RAW_MATERIAL',
    PACKING_MATERIAL: 'RAW_MATERIAL',
    SUB_ASSEMBLY: 'WIP',
    SUB_ASSEMBLIES: 'WIP',
    SUBASSEMBLY: 'WIP',
    SUB: 'WIP',
    WIP: 'WIP',
    CAPITAL_GOODS: 'FINISHED_GOODS',
    CAPITAL_GOOD: 'FINISHED_GOODS',
    FINISHED: 'FINISHED_GOODS',
    FINISHED_GOOD: 'FINISHED_GOODS',
    FINISHED_GOODS: 'FINISHED_GOODS',
    FG: 'FINISHED_GOODS',
    DEMO: 'DEMO',
    SERVICE: 'SERVICE_SPARES',
    SERVICES: 'SERVICE_SPARES',
    SERVICE_SPARES: 'SERVICE_SPARES',
    CONSUMABLE: 'CONSUMABLES',
    CONSUMABLES: 'CONSUMABLES',
  };
  return mapped[key] ?? fallback;
}
