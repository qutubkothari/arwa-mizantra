const path = require('path');
const dotenv = require('dotenv');
const { Pool } = require('pg');

dotenv.config({ path: path.resolve(process.cwd(), process.argv[2] || 'apps/api/.env') });
const raw = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!raw) throw new Error('Missing database connection');
const url = new URL(raw);
['sslmode', 'sslrootcert', 'sslcert', 'sslkey'].forEach((key) => url.searchParams.delete(key));
const pool = new Pool({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });

(async () => {
  const columns = await pool.query(`
    SELECT table_name,column_name FROM information_schema.columns
    WHERE table_schema='public' AND (
      (table_name IN ('bom_headers','bom_routing') AND column_name='drawing_revision_id') OR
      (table_name='production_job_orders' AND column_name IN (
        'drawing_revision_id','drawing_number','drawing_revision_code','drawing_file_url',
        'engineering_snapshot','definition_frozen_at')))
    ORDER BY table_name,column_name`);
  const trigger = await pool.query(`
    SELECT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname='trg_freeze_job_order_engineering_definition' AND NOT tgisinternal
    ) AS present`);
  const fn = await pool.query(`
    SELECT pg_get_functiondef('public.freeze_job_order_engineering_definition()'::regprocedure) AS definition`);
  const enumSafeStatusCheck = fn.rows[0].definition.includes('NEW.status::text');
  const result = { columns: columns.rows, trigger: trigger.rows[0].present, enum_safe_status_check: enumSafeStatusCheck };
  console.log(JSON.stringify(result));
  if (columns.rows.length !== 8 || !result.trigger || !enumSafeStatusCheck) process.exitCode = 1;
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(() => pool.end());
