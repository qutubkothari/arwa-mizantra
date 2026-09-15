const path = require("path");
const dotenv = require("dotenv");

const envFile = process.argv[2] || "apps/api/.env.test";
const itemCode = process.argv[3];
if (!itemCode) throw new Error("Usage: node diagnose-stock-trail-item.cjs <env-file> <item-code>");

dotenv.config({ path: path.resolve(envFile), quiet: true });
const baseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;
if (!baseUrl || !serviceKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY are required");

async function select(resource) {
  const response = await fetch(`${baseUrl}/rest/v1/${resource}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${text}`);
  return text ? JSON.parse(text) : [];
}

async function main() {
  const items = await select(
    `items?select=id,tenant_id,code,name,created_at&code=eq.${encodeURIComponent(itemCode)}&order=created_at.desc`,
  );
  const output = [];
  for (const item of items) {
    const filter = `tenant_id=eq.${item.tenant_id}&item_id=eq.${item.id}`;
    const [stockRows, movements, entries] = await Promise.all([
      select(`inventory_stock?select=quantity,available_quantity,warehouse_id,updated_at,last_movement_date&${filter}`),
      select(`stock_movements?select=id,movement_number,movement_type,quantity,from_warehouse_id,to_warehouse_id,movement_date&${filter}`),
      select(`stock_entries?select=id,quantity,available_quantity,warehouse_id,created_at,metadata&${filter}`),
    ]);
    output.push({
      ...item,
      stock_quantity: stockRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0),
      available_quantity: stockRows.reduce(
        (sum, row) => sum + Number(row.available_quantity ?? row.quantity ?? 0),
        0,
      ),
      movement_count: movements.length,
      stock_entry_count: entries.length,
      stock_rows: stockRows,
      movements,
      stock_entries: entries,
    });
  }
  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
