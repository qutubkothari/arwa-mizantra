const path = require("path");
const { Client } = require("pg");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(process.argv[2] || "apps/api/.env"), quiet: true });

const rawUrl = process.env.DATABASE_URL || process.env.DIRECT_URL;
if (!rawUrl) throw new Error("DATABASE_URL or DIRECT_URL is required");
const connectionString = rawUrl.replace(
  /([?&])sslmode=require(&|$)/,
  (_match, prefix, suffix) => (suffix ? prefix : ""),
);

async function main() {
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20_000,
  });
  await client.connect();
  try {
    const tables = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'crm_pipeline_stages', 'crm_assignment_rules', 'crm_leads',
          'crm_activities', 'crm_lead_stage_history'
        )
      ORDER BY table_name
    `);
    const columns = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'crm_leads'
        AND column_name IN ('lead_score', 'score_explanation')
      ORDER BY column_name
    `);
    const counts = await client.query(`
      SELECT
        (SELECT count(*)::int FROM public.crm_leads) AS leads,
        (SELECT count(*)::int FROM public.crm_pipeline_stages) AS stages,
        (SELECT count(*)::int FROM public.crm_assignment_rules) AS rules
    `);
    if (tables.rowCount !== 5) throw new Error(`Expected 5 CRM tables, found ${tables.rowCount}`);
    if (columns.rowCount !== 2) throw new Error(`CRM scoring columns are incomplete (${columns.rowCount}/2)`);
    console.log(JSON.stringify({
      status: "PASS",
      tables: tables.rows.map((row) => row.table_name),
      scoring_columns: columns.rows.map((row) => row.column_name),
      records: counts.rows[0],
    }));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
