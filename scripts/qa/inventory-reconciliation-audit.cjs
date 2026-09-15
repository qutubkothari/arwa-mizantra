const { Client } = require('pg');
const dotenv = require('dotenv');
const path = require('path');

const envPath = process.argv[2] || 'apps/api/.env';
dotenv.config({ path: path.resolve(envPath) });

const rawUrl = process.env.DATABASE_URL || process.env.DIRECT_URL;
if (!rawUrl) throw new Error('DATABASE_URL or DIRECT_URL is required');
const connectionString = rawUrl.replace(/([?&])sslmode=require(&|$)/, (_match, prefix, suffix) => suffix ? prefix : '');

async function main() {
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20_000,
  });
  await client.connect();

  try {
    const database = await client.query(`
      SELECT current_database() AS database_name, inet_server_addr()::text AS server_address
    `);
    const balances = await client.query(`
      SELECT
        stock.tenant_id,
        stock.item_id,
        item.code AS item_code,
        item.name AS item_name,
        item.uom,
        stock.warehouse_id,
        warehouse.code AS warehouse_code,
        warehouse.name AS warehouse_name,
        ROUND(SUM(stock.quantity)::numeric, 6) AS quantity,
        ROUND(SUM(stock.reserved_quantity)::numeric, 6) AS reserved_quantity,
        COUNT(*)::int AS row_count,
        ARRAY_AGG(DISTINCT stock.category::text ORDER BY stock.category::text) AS categories,
        COUNT(DISTINCT stock.location_id)::int AS location_count,
        MIN(stock.created_at) AS first_balance_created_at,
        MAX(stock.updated_at) AS last_balance_updated_at
      FROM inventory_stock stock
      LEFT JOIN items item ON item.id = stock.item_id
      LEFT JOIN warehouses warehouse ON warehouse.id = stock.warehouse_id
      GROUP BY
        stock.tenant_id,
        stock.item_id,
        item.code,
        item.name,
        item.uom,
        stock.warehouse_id,
        warehouse.code,
        warehouse.name
      HAVING SUM(stock.quantity) < -0.0001
      ORDER BY SUM(stock.quantity)
    `);

    const details = [];
    for (const balance of balances.rows) {
      const movementSummary = await client.query(`
        SELECT
          COUNT(*)::int AS movement_count,
          ROUND(COALESCE(SUM(
            CASE
              WHEN to_warehouse_id = $3 AND from_warehouse_id IS DISTINCT FROM $3 THEN quantity
              WHEN from_warehouse_id = $3 AND to_warehouse_id IS DISTINCT FROM $3 THEN -quantity
              ELSE 0
            END
          ), 0)::numeric, 6) AS movement_net
        FROM stock_movements
        WHERE tenant_id = $1
          AND item_id = $2
          AND (from_warehouse_id = $3 OR to_warehouse_id = $3)
      `, [balance.tenant_id, balance.item_id, balance.warehouse_id]);

      const recentMovements = await client.query(`
        SELECT
          movement_number,
          movement_type,
          quantity,
          reference_type,
          reference_number,
          from_warehouse_id,
          to_warehouse_id,
          movement_date,
          notes
        FROM stock_movements
        WHERE tenant_id = $1
          AND item_id = $2
          AND (from_warehouse_id = $3 OR to_warehouse_id = $3)
        ORDER BY movement_date DESC, created_at DESC
        LIMIT 10
      `, [balance.tenant_id, balance.item_id, balance.warehouse_id]);

      details.push({
        ...balance,
        movement_count: movementSummary.rows[0].movement_count,
        movement_net: movementSummary.rows[0].movement_net,
        recent_movements: recentMovements.rows,
      });
    }

    const output = {
      database: database.rows[0],
      negative_warehouse_balances: details.length,
      details,
    };
    if (process.env.SUMMARY_ONLY === '1') delete output.details;
    console.log(JSON.stringify(output, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
