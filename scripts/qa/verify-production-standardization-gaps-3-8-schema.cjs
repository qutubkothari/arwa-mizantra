const path = require('path');
const dotenv = require('dotenv');
const { Pool } = require('pg');

dotenv.config({ path: path.resolve(process.cwd(), process.argv[2] || 'apps/api/.env') });
const raw = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!raw) throw new Error('Missing database connection');
const url = new URL(raw);
['sslmode','sslrootcert','sslcert','sslkey'].forEach((key) => url.searchParams.delete(key));
const pool = new Pool({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });

(async () => {
  const expectedTables = [
    'production_attribute_definitions','production_item_specifications','production_formula_definitions',
    'production_formula_test_cases','production_formula_evaluations','production_job_cost_statements',
    'project_delivery_allocations','production_engineering_results','production_engineering_result_lines',
  ];
  const tables = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name=ANY($1) ORDER BY table_name`, [expectedTables]);
  const columns = await pool.query(`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND ((table_name='bom_items' AND column_name IN ('route_operation_id','issue_method','input_warehouse_id','quantity_formula_id')) OR (table_name='job_order_materials' AND column_name IN ('route_operation_id','issue_method','input_warehouse_id')) OR (table_name='production_job_orders' AND column_name='engineering_result_id')) ORDER BY table_name,column_name`);
  const triggers = await pool.query(`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('trg_formula_definition_immutable','trg_engineering_result_immutable','trg_freeze_job_order_engineering_result') ORDER BY tgname`);
  const result = { tables: tables.rows.map((r) => r.table_name), columns: columns.rows, triggers: triggers.rows.map((r) => r.tgname) };
  console.log(JSON.stringify(result));
  if (result.tables.length !== expectedTables.length || result.columns.length !== 8 || result.triggers.length !== 3) process.exitCode = 1;
})().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => pool.end());
