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
        '/tmp/mizantra-permission-ai-20260830/migrations/add-active-planner-execution-idempotency.sql',
        'utf8',
      ),
    );
    const result = await client.query(`SELECT
      (SELECT COUNT(*)::int FROM information_schema.tables WHERE table_schema='public' AND table_name='active_planner_executions') AS execution_tables,
      (SELECT COUNT(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='active_planner_executions' AND column_name IN ('tenant_id','user_id','context_id','intent_type','status','prompt_hash','resource_type','resource_id','failure_reason','completed_at')) AS execution_columns,
      (SELECT COUNT(*)::int FROM pg_indexes WHERE schemaname='public' AND tablename='active_planner_executions' AND indexdef ILIKE '%UNIQUE%tenant_id, context_id%') AS one_time_constraints`);
    const row = result.rows[0];
    if (row.execution_tables !== 1 || row.execution_columns !== 10 || row.one_time_constraints !== 1) {
      throw new Error(`Active Planner schema verification failed: ${JSON.stringify(row)}`);
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
