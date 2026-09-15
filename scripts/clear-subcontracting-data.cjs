const dotenv = require('dotenv');
const { Client } = require('pg');

dotenv.config();

const execute = process.argv.includes('--execute');
const expectedProjectArg = process.argv.find((arg) => arg.startsWith('--expected-project='));
const expectedProject = expectedProjectArg?.split('=')[1];
const projectId = (() => {
  try {
    return new URL(process.env.SUPABASE_URL || '').hostname.split('.')[0];
  } catch {
    return '';
  }
})();

if (!expectedProject || projectId !== expectedProject) {
  throw new Error(`Refusing database access: expected Supabase project ${expectedProject || '(missing)'}, found ${projectId || '(unknown)'}`);
}

const rawConnectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!rawConnectionString) throw new Error('DIRECT_URL or DATABASE_URL is required');
const databaseUrl = new URL(rawConnectionString);
['sslmode', 'sslrootcert', 'sslcert', 'sslkey'].forEach((key) => databaseUrl.searchParams.delete(key));
const connectionString = databaseUrl.toString();

const client = new Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20_000,
});

async function counts() {
  const result = await client.query(`
    SELECT 'subcontract_routes' AS table_name, COUNT(*)::int AS row_count FROM public.subcontract_routes
    UNION ALL SELECT 'subcontract_route_steps', COUNT(*)::int FROM public.subcontract_route_steps
    UNION ALL SELECT 'subcontract_orders', COUNT(*)::int FROM public.subcontract_orders
    UNION ALL SELECT 'subcontract_order_steps', COUNT(*)::int FROM public.subcontract_order_steps
    UNION ALL SELECT 'subcontract_movements', COUNT(*)::int FROM public.subcontract_movements
    UNION ALL SELECT 'subcontract_receipt_lines', COUNT(*)::int FROM public.subcontract_receipt_lines
    UNION ALL SELECT 'linked_stock_movements', COUNT(*)::int FROM public.stock_movements WHERE reference_type LIKE 'SUBCONTRACTING%'
    ORDER BY table_name
  `);
  return Object.fromEntries(result.rows.map((row) => [row.table_name, row.row_count]));
}

async function clearData() {
  await client.query('BEGIN');
  try {
    await client.query(`
      CREATE TEMP TABLE subcontract_stock_reversal ON COMMIT DROP AS
      WITH deltas AS (
        SELECT tenant_id, item_id, from_warehouse_id AS warehouse_id, quantity::numeric AS delta
        FROM public.stock_movements
        WHERE reference_type LIKE 'SUBCONTRACTING%' AND from_warehouse_id IS NOT NULL
        UNION ALL
        SELECT tenant_id, item_id, to_warehouse_id AS warehouse_id, -quantity::numeric AS delta
        FROM public.stock_movements
        WHERE reference_type LIKE 'SUBCONTRACTING%' AND to_warehouse_id IS NOT NULL
      )
      SELECT tenant_id, item_id, warehouse_id, SUM(delta)::numeric AS delta
      FROM deltas
      WHERE item_id IS NOT NULL AND warehouse_id IS NOT NULL
      GROUP BY tenant_id, item_id, warehouse_id
      HAVING ABS(SUM(delta)) > 0.000001
    `);

    const shortages = await client.query(`
      SELECT reversal.tenant_id, reversal.item_id, reversal.warehouse_id,
             reversal.delta, COALESCE(stock.quantity, 0)::numeric AS current_quantity,
             item.code AS item_code, warehouse.code AS warehouse_code
      FROM subcontract_stock_reversal reversal
      LEFT JOIN LATERAL (
        SELECT SUM(quantity)::numeric AS quantity
        FROM public.inventory_stock
        WHERE tenant_id = reversal.tenant_id
          AND item_id = reversal.item_id
          AND warehouse_id = reversal.warehouse_id
      ) stock ON true
      LEFT JOIN public.items item ON item.id = reversal.item_id
      LEFT JOIN public.warehouses warehouse ON warehouse.id = reversal.warehouse_id
      WHERE reversal.delta < 0
        AND COALESCE(stock.quantity, 0) + reversal.delta < -0.000001
    `);
    if (shortages.rows.length) {
      const movementHistory = await client.query(`
        SELECT item.code AS item_code, movement.reference_type, movement.reference_number,
               movement.quantity, source.code AS source_warehouse, destination.code AS destination_warehouse,
               movement.movement_date
        FROM public.stock_movements movement
        JOIN public.items item ON item.id = movement.item_id
        LEFT JOIN public.warehouses source ON source.id = movement.from_warehouse_id
        LEFT JOIN public.warehouses destination ON destination.id = movement.to_warehouse_id
        WHERE movement.item_id = ANY($1::uuid[])
        ORDER BY movement.movement_date DESC
        LIMIT 40
      `, [[...new Set(shortages.rows.map((row) => row.item_id))]]);
      console.log(`Affected movement history: ${JSON.stringify(movementHistory.rows)}`);
      const details = shortages.rows.map((row) =>
        `${row.item_code || row.item_id}@${row.warehouse_code || row.warehouse_id}: current ${row.current_quantity}, reversal ${row.delta}`,
      ).join('; ');
      throw new Error(`Inventory reversal would create ${shortages.rows.length} negative stock balance(s): ${details}; cleanup aborted`);
    }

    await client.query(`
      WITH targets AS (
        SELECT reversal.*, stock.id AS stock_id
        FROM subcontract_stock_reversal reversal
        JOIN LATERAL (
          SELECT id
          FROM public.inventory_stock
          WHERE tenant_id = reversal.tenant_id
            AND item_id = reversal.item_id
            AND warehouse_id = reversal.warehouse_id
            AND category = 'RAW_MATERIAL'
          ORDER BY (location_id IS NULL) DESC, quantity DESC
          LIMIT 1
        ) stock ON true
      )
      UPDATE public.inventory_stock stock
      SET quantity = CASE
            WHEN ABS(stock.quantity + targets.delta) < 0.000001 THEN 0
            ELSE stock.quantity + targets.delta
          END,
          updated_at = NOW()
      FROM targets
      WHERE stock.id = targets.stock_id
    `);

    await client.query(`
      INSERT INTO public.inventory_stock (
        tenant_id, item_id, warehouse_id, location_id, category,
        quantity, reserved_quantity, last_movement_date, updated_at
      )
      SELECT reversal.tenant_id, reversal.item_id, reversal.warehouse_id, NULL,
             'RAW_MATERIAL', reversal.delta, 0, NOW(), NOW()
      FROM subcontract_stock_reversal reversal
      WHERE reversal.delta > 0
        AND NOT EXISTS (
          SELECT 1 FROM public.inventory_stock stock
          WHERE stock.tenant_id = reversal.tenant_id
            AND stock.item_id = reversal.item_id
            AND stock.warehouse_id = reversal.warehouse_id
            AND stock.category = 'RAW_MATERIAL'
        )
    `);

    await client.query(`DELETE FROM public.stock_movements WHERE reference_type LIKE 'SUBCONTRACTING%'`);
    await client.query(`DELETE FROM public.subcontract_receipt_lines`);
    await client.query(`DELETE FROM public.subcontract_movements`);
    await client.query(`DELETE FROM public.subcontract_order_steps`);
    await client.query(`DELETE FROM public.subcontract_orders`);
    await client.query(`DELETE FROM public.subcontract_route_steps`);
    await client.query(`DELETE FROM public.subcontract_routes`);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

(async () => {
  await client.connect();
  const before = await counts();
  console.log(`Project: ${projectId}`);
  console.log(`Before: ${JSON.stringify(before)}`);
  if (!execute) {
    console.log('Inspection only; pass --execute to clear the verified test database.');
    return;
  }
  await clearData();
  const after = await counts();
  console.log(`After: ${JSON.stringify(after)}`);
})()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => client.end().catch(() => undefined));
