const path = require('path');
const dotenv = require('dotenv');
const { Pool } = require('pg');

const envFile = process.argv[2] || 'apps/api/.env';
dotenv.config({ path: path.resolve(process.cwd(), envFile) });
const raw = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!raw) throw new Error('Missing database connection');
const url = new URL(raw);
['sslmode', 'sslrootcert', 'sslcert', 'sslkey'].forEach((key) => url.searchParams.delete(key));
const pool = new Pool({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });

(async () => {
  const tables = await pool.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_name IN ('project_work_packages','project_work_package_lines')
    ORDER BY table_name`);
  const columns = await pool.query(`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema='public' AND (
      (table_name='projects' AND column_name IN ('customer_id','site_name','committed_delivery_date')) OR
      (table_name='item_drawings' AND column_name IN ('drawing_number','revision_code','lifecycle_status','approved_by','effective_from')) OR
      (table_name IN ('production_programs','production_job_orders') AND column_name='work_package_line_id')
    ) ORDER BY table_name,column_name`);
  const duplicate = await pool.query(`
    SELECT COUNT(*)::int AS groups FROM (
      SELECT 1 FROM public.item_drawings
      GROUP BY tenant_id,item_id,drawing_number,revision_code HAVING COUNT(*) > 1
    ) d`);
  const index = await pool.query(`SELECT to_regclass('public.uq_item_drawing_revision') IS NOT NULL AS present`);
  const result = {
    tables: tables.rows.map((row) => row.table_name),
    columns: columns.rows,
    duplicate_drawing_revision_groups: duplicate.rows[0].groups,
    unique_revision_index: index.rows[0].present,
  };
  console.log(JSON.stringify(result));
  if (result.tables.length !== 2 || result.columns.length !== 10 || result.duplicate_drawing_revision_groups !== 0 || !result.unique_revision_index) process.exitCode = 1;
})().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => pool.end());
