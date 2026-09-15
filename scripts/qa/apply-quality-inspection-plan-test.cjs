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
    await client.query(fs.readFileSync('/tmp/mizantra-quality-plans-20260830/migrations/add-quality-inspection-plan-control.sql', 'utf8'));
    const result = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('quality_inspection_plans','quality_inspection_plan_parameters')) AS plan_tables,
        (SELECT COUNT(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='quality_inspections' AND column_name IN ('inspection_plan_id','inspection_plan_revision','inspection_plan_snapshot')) AS inspection_columns,
        (SELECT COUNT(*)::int FROM public.app_feature_catalogue WHERE feature_key='quality-inspection-plans') AS feature_rows
    `);
    const row = result.rows[0];
    if (row.plan_tables !== 2 || row.inspection_columns !== 3 || row.feature_rows !== 1) {
      throw new Error(`Inspection-plan schema verification failed: ${JSON.stringify(row)}`);
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

main().catch((error) => { console.error(error.message); process.exit(1); });
