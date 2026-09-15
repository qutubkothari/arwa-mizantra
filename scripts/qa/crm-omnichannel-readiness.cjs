const path = require('path');
const dotenv = require('dotenv');
const { Pool } = require('pg');

const envFile = path.resolve(process.argv[2] || 'apps/api/.env');
dotenv.config({ path: envFile, quiet: true });
const raw = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!raw) throw new Error('DIRECT_URL or DATABASE_URL is required');
const url = new URL(raw);
['sslmode', 'sslrootcert', 'sslcert', 'sslkey'].forEach((key) => url.searchParams.delete(key));
const pool = new Pool({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });

async function main() {
  const expectedTables = [
    'crm_intake_settings',
    'crm_sales_pool_members',
    'crm_email_receipt_routes',
    'crm_intake_messages',
  ];
  const { rows: tables } = await pool.query(
    `select table_name from information_schema.tables
       where table_schema = 'public' and table_name = any($1::text[])`,
    [expectedTables],
  );
  const found = new Set(tables.map((row) => row.table_name));
  const missing = expectedTables.filter((name) => !found.has(name));
  if (missing.length) throw new Error(`Missing CRM intake tables: ${missing.join(', ')}`);

  const { rows: functions } = await pool.query(
    `select count(*)::int as count from pg_proc
      where proname = 'crm_claim_round_robin_owner'`,
  );
  if (!functions[0]?.count) throw new Error('Missing crm_claim_round_robin_owner function');

  const { rows: counts } = await pool.query(
    `select
       (select count(*)::int from crm_intake_settings) as settings,
       (select count(*)::int from crm_sales_pool_members) as sales_pool,
       (select count(*)::int from crm_email_receipt_routes) as email_routes,
       (select count(*)::int from crm_intake_messages) as intake_messages`,
  );
  console.log(JSON.stringify({ ready: true, tables: expectedTables, ...counts[0] }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
