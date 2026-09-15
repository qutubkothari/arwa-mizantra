const fs = require('fs');
const { Client } = require('pg');
require('dotenv').config({ path: '/var/www/sak-erp-test/apps/api/.env' });

async function main() {
  const url = new URL(process.env.DATABASE_URL);
  if (url.hostname !== 'db.nwkaruzvzwwuftjquypk.supabase.co') throw new Error(`Refusing non-Mizantra database host: ${url.hostname}`);
  url.searchParams.set('sslmode', 'no-verify');
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(fs.readFileSync('/tmp/mizantra-tooling-calibration-20260830/migrations/add-production-tooling-calibration-control.sql', 'utf8'));
    const result = await client.query(`SELECT
      (SELECT COUNT(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='production_tool_resources' AND column_name IN ('serial_number','resource_type','life_limit_cycles','cycles_used','calibration_required','last_calibration_date','next_calibration_due','calibration_status','block_reason','created_by','updated_by')) AS tool_columns,
      (SELECT COUNT(*)::int FROM information_schema.tables WHERE table_schema='public' AND table_name='production_tool_events') AS event_tables,
      (SELECT COUNT(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('record_production_tool_usage','verify_production_tool_calibration')) AS control_functions`);
    const row = result.rows[0];
    if (row.tool_columns !== 11 || row.event_tables !== 1 || row.control_functions !== 2) throw new Error(`Tooling schema verification failed: ${JSON.stringify(row)}`);
    await client.query('COMMIT');
    console.log(JSON.stringify({ database_host: url.hostname, ...row }));
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { await client.end(); }
}
main().catch((error) => { console.error(error.message); process.exit(1); });
