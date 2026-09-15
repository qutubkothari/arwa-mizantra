const path = require("path");
const dotenv = require("dotenv");
const { Client } = require("pg");

dotenv.config({ path: path.resolve(process.argv[2] || "apps/api/.env"), quiet: true });
const raw = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!raw) throw new Error("DIRECT_URL or DATABASE_URL is required");
const url = new URL(raw);
["sslmode", "sslrootcert", "sslcert", "sslkey"].forEach((key) => url.searchParams.delete(key));

async function main() {
  const client = new Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const result = await client.query(`
      SELECT table_name, array_agg(column_name ORDER BY ordinal_position) AS columns
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name IN ('quotations','sales_orders','invoices','service_tickets','service_installed_assets','crm_leads','crm_notifications')
       GROUP BY table_name
       ORDER BY table_name
    `);
    console.log(JSON.stringify(result.rows));
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error(error.message); process.exit(1); });
