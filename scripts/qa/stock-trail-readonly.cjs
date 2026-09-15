const path = require("path");
const dotenv = require("dotenv");

const envFile = process.argv[2] || "apps/api/.env.test";
const itemCode = process.argv[3];
if (!itemCode) throw new Error("Usage: node stock-trail-readonly.cjs <env-file> <item-code>");

dotenv.config({ path: path.resolve(envFile), quiet: true });
process.env.SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;

function assert(condition, message, detail) {
  if (!condition) {
    throw new Error(`${message}\n${JSON.stringify(detail, null, 2)}`);
  }
}

async function select(resource) {
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${resource}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${text}`);
  return text ? JSON.parse(text) : [];
}

async function main() {
  const items = await select(
    `items?select=id,tenant_id,code,name&code=eq.${encodeURIComponent(itemCode)}`,
  );
  assert(items.length > 0, "Item was not found", { itemCode });

  const { ItemsService } = require("../../apps/api/dist/items/services/items.service.js");
  const service = new ItemsService({});
  const results = [];
  for (const item of items) {
    const trail = await service.getStockTrail(item.tenant_id, item.id);
    const trailBalance = (trail.trails || []).reduce(
      (sum, row) => sum + Number(row.qty_in || 0) - Number(row.qty_out || 0),
      0,
    );
    assert(trail.trails.length > 0 || Number(trail.currentBalance) === 0, "Non-zero stock has an empty trail", trail);
    assert(
      Math.abs(trailBalance - Number(trail.currentBalance || 0)) < 0.000001,
      "Stock trail does not reconcile to current stock",
      { trailBalance, currentBalance: trail.currentBalance, trails: trail.trails },
    );
    results.push({
      item: `${item.code} — ${item.name}`,
      currentBalance: trail.currentBalance,
      eventCount: trail.trails.length,
      eventTypes: trail.trails.map((row) => row.type),
      references: trail.trails.map((row) => row.reference),
      warehouseBalances: trail.currentStock.map((row) => ({
        warehouse: row.warehouses?.name,
        quantity: row.quantity,
      })),
    });
  }
  console.log(JSON.stringify({ status: "PASS", results }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
