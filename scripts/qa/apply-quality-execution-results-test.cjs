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
    await client.query(fs.readFileSync('/tmp/mizantra-quality-execution-20260830/migrations/add-quality-execution-result-control.sql', 'utf8'));
    const result = await client.query(`SELECT
      (SELECT COUNT(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='inspection_parameters' AND column_name IN ('tenant_id','plan_parameter_id','sequence_number','data_type','criticality','is_mandatory','evaluated_at','evaluated_by')) AS execution_columns,
      (SELECT COUNT(*)::int FROM public.inspection_parameters WHERE tenant_id IS NULL) AS unscoped_rows`);
    const row = result.rows[0];
    if (row.execution_columns !== 8 || row.unscoped_rows !== 0) throw new Error(`Quality execution verification failed: ${JSON.stringify(row)}`);
    await client.query('COMMIT');
    console.log(JSON.stringify({ database_host: url.hostname, ...row }));
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { await client.end(); }
}
main().catch((error) => { console.error(error.message); process.exit(1); });
