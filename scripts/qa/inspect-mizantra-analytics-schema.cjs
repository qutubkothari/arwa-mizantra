const fs = require("fs");
const path = require("path");

for (const file of ["apps/api/.env", "apps/api/.env.test"]) {
  const full = path.join(process.cwd(), file);
  if (!fs.existsSync(full)) continue;
  for (const line of fs.readFileSync(full, "utf8").replace(/\r/g, "").split("\n")) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match && !process.env[match[1]])
      process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, "");
  }
}

const expected = "nwkaruzvzwwuftjquypk.supabase.co";
const base = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
if (new URL(base).hostname !== expected) throw new Error("Refusing non-Mizantra database.");

const tables = [
  "inventory_stock",
  "stock_movements",
  "sales_orders",
  "sales_order_items",
  "invoices",
  "invoice_items",
  "production_orders",
  "job_orders",
  "accounting_open_items",
  "accounting_parties",
  "customers",
  "vendors",
  "purchase_orders",
  "purchase_order_items",
];

async function main() {
  const result = {};
  for (const table of tables) {
    const response = await fetch(`${base}/rest/v1/${table}?select=*&limit=1`, {
      headers: { apikey: key, authorization: `Bearer ${key}` },
    });
    const body = await response.json().catch(() => null);
    result[table] = response.ok
      ? { available: true, columns: Object.keys(body?.[0] || {}).sort() }
      : { available: false, error: body?.message || response.status };
  }
  console.log(JSON.stringify({ database: expected, read_only: true, tables: result }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
