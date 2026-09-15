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
    await client.query(fs.readFileSync('/tmp/mizantra-subcontract-reconciliation-20260830/migrations/add-subcontract-reconciliation-control.sql', 'utf8'));
    const result = await client.query(`SELECT
      (SELECT COUNT(*)::int FROM information_schema.tables WHERE table_schema='public' AND table_name='subcontract_reconciliations') AS reconciliation_tables,
      (SELECT COUNT(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='subcontract_reconciliations' AND column_name IN ('input_reconciliation_variance','yield_variance_quantity','standard_service_cost','actual_service_cost','service_cost_variance','status')) AS control_columns`);
    const row = result.rows[0];
    if (row.reconciliation_tables !== 1 || row.control_columns !== 6) throw new Error(`Subcontract reconciliation verification failed: ${JSON.stringify(row)}`);
    await client.query('COMMIT');
    console.log(JSON.stringify({ database_host: url.hostname, ...row }));
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { await client.end(); }
}
main().catch((error) => { console.error(error.message); process.exit(1); });
