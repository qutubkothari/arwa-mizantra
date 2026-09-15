const path = require("path");
const { Client } = require("pg");
const dotenv = require("dotenv");

const envPath = process.argv[2] || "apps/api/.env";
dotenv.config({ path: path.resolve(envPath), quiet: true });

const rawUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!rawUrl) throw new Error("DIRECT_URL or DATABASE_URL is required");
const url = new URL(rawUrl);
if (url.hostname !== "db.nwkaruzvzwwuftjquypk.supabase.co") {
  throw new Error(`Refusing non-Mizantra database: ${url.hostname}`);
}
["sslmode", "sslrootcert", "sslcert", "sslkey"].forEach((key) =>
  url.searchParams.delete(key),
);

async function main() {
  const client = new Client({
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const result = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM public.production_job_orders) AS job_orders,
        (SELECT COUNT(*)::int FROM public.production_job_orders WHERE bom_id IS NOT NULL) AS jobs_with_bom,
        (SELECT COUNT(*)::int FROM public.production_orders WHERE job_order_id IS NOT NULL) AS linked_execution_orders,
        (SELECT COUNT(*)::int FROM public.job_order_operations WHERE routing_id IS NOT NULL) AS linked_operations,
        (SELECT COUNT(*)::int FROM public.station_completions WHERE job_order_id IS NOT NULL) AS linked_completions,
        (SELECT COUNT(*)::int FROM information_schema.columns
          WHERE table_schema='public' AND table_name='station_completions'
            AND column_name IN ('job_order_id','job_order_operation_id','rework_quantity')) AS completion_columns,
        (SELECT COUNT(*)::int FROM pg_trigger
          WHERE NOT tgisinternal AND tgname IN (
            'trg_sync_job_order_execution_order',
            'trg_sync_job_order_execution_component',
            'trg_link_job_order_operation_to_routing',
            'trg_link_station_completion_to_job_order',
            'trg_roll_up_station_completion_to_job_order'
          )) AS control_triggers
    `);
    const row = result.rows[0];
    if (row.completion_columns !== 3 || row.control_triggers !== 5) {
      throw new Error(`Unified production schema incomplete: ${JSON.stringify(row)}`);
    }
    console.log(JSON.stringify({ database: url.hostname, ...row }));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
