const fs = require('fs');
const { Client } = require('pg');
require('dotenv').config({ path: '/var/www/sak-erp-test/apps/api/.env' });

async function main() {
  const url = new URL(process.env.DATABASE_URL);
  if (url.hostname !== 'db.nwkaruzvzwwuftjquypk.supabase.co') {
    throw new Error(`Refusing non-Mizantra database host: ${url.hostname}`);
  }
  url.searchParams.set('sslmode', 'no-verify');
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      fs.readFileSync(
        '/tmp/mizantra-production-consumption-20260830/migrations/add-production-consumption-backflush-control.sql',
        'utf8',
      ),
    );
    const result = await client.query(`SELECT
      (SELECT COUNT(*)::int FROM information_schema.tables WHERE table_schema='public' AND table_name='production_material_consumptions') AS consumption_tables,
      (SELECT COUNT(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='record_job_order_material_backflush') AS backflush_functions,
      (SELECT COUNT(*)::int FROM information_schema.triggers WHERE event_object_schema='public' AND event_object_table='production_material_consumptions' AND trigger_name='trg_production_consumption_immutable') AS immutable_triggers`);
    const row = result.rows[0];
    if (
      row.consumption_tables !== 1 ||
      row.backflush_functions !== 1 ||
      row.immutable_triggers !== 2
    ) {
      throw new Error(`Production consumption verification failed: ${JSON.stringify(row)}`);
    }
    await client.query('COMMIT');
    console.log(JSON.stringify({ database_host: url.hostname, ...row }));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
