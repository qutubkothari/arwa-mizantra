const { Client } = require('pg');
const dotenv = require('dotenv');
const path = require('path');

const envPath = process.argv[2] || 'apps/api/.env';
dotenv.config({ path: path.resolve(envPath) });

const rawUrl = process.env.DATABASE_URL || process.env.DIRECT_URL;
if (!rawUrl) throw new Error('DATABASE_URL or DIRECT_URL is required');
const connectionString = rawUrl.replace(/([?&])sslmode=require(&|$)/, (_match, prefix, suffix) => suffix ? prefix : '');

const checks = {
  duplicateSalesOrders: `SELECT COUNT(*)::int AS count FROM (SELECT tenant_id, so_number FROM sales_orders GROUP BY tenant_id, so_number HAVING COUNT(*) > 1) q`,
  duplicateDispatches: `SELECT COUNT(*)::int AS count FROM (SELECT tenant_id, dn_number FROM dispatch_notes GROUP BY tenant_id, dn_number HAVING COUNT(*) > 1) q`,
  duplicateSalesInvoices: `SELECT COUNT(*)::int AS count FROM (SELECT tenant_id, invoice_number FROM invoices GROUP BY tenant_id, invoice_number HAVING COUNT(*) > 1) q`,
  duplicateServiceTickets: `SELECT COUNT(*)::int AS count FROM (SELECT tenant_id, ticket_number FROM service_tickets GROUP BY tenant_id, ticket_number HAVING COUNT(*) > 1) q`,
  orphanDispatchOrders: `SELECT COUNT(*)::int AS count FROM dispatch_notes d LEFT JOIN sales_orders s ON s.id = d.sales_order_id WHERE s.id IS NULL`,
  orphanSalesInvoices: `SELECT COUNT(*)::int AS count FROM invoices i LEFT JOIN sales_orders s ON s.id = i.sales_order_id WHERE i.sales_order_id IS NOT NULL AND s.id IS NULL`,
  orphanServiceConfirmations: `SELECT COUNT(*)::int AS count FROM service_confirmations c LEFT JOIN service_tickets t ON t.id = c.service_ticket_id WHERE t.id IS NULL`,
  orphanServiceInvoices: `SELECT COUNT(*)::int AS count FROM customer_service_invoices i LEFT JOIN service_tickets t ON t.id = i.service_ticket_id LEFT JOIN service_confirmations c ON c.id = i.service_confirmation_id WHERE t.id IS NULL OR (i.service_confirmation_id IS NOT NULL AND c.id IS NULL)`,
  invalidSalesBalances: `SELECT COUNT(*)::int AS count FROM invoices WHERE COALESCE(billing_status, 'POSTED') <> 'CANCELLED' AND (COALESCE(paid_amount, 0) < 0 OR COALESCE(balance_amount, 0) < 0 OR ABS(COALESCE(paid_amount, 0) + COALESCE(balance_amount, 0) - COALESCE(net_amount, 0)) > 0.02)`,
  invalidServiceBalances: `SELECT COUNT(*)::int AS count FROM customer_service_invoices WHERE billing_status <> 'CANCELLED' AND (paid_amount < 0 OR balance_amount < 0 OR ABS(paid_amount + balance_amount - net_amount) > 0.02)`,
  duplicateInventoryBalances: `SELECT COUNT(*)::int AS count FROM (
    SELECT tenant_id, item_id, warehouse_id, COALESCE(location_id::text, ''), category
    FROM inventory_stock
    GROUP BY tenant_id, item_id, warehouse_id, COALESCE(location_id::text, ''), category
    HAVING COUNT(*) > 1
  ) q`,
  negativeInventoryBalanceRows: `SELECT COUNT(*)::int AS count FROM inventory_stock WHERE quantity < -0.0001`,
  negativeInventoryBalances: `SELECT COUNT(*)::int AS count FROM (
    SELECT tenant_id, item_id, warehouse_id
    FROM inventory_stock
    GROUP BY tenant_id, item_id, warehouse_id
    HAVING SUM(quantity) < -0.0001
  ) q`,
  missingMovementNumbers: `SELECT COUNT(*)::int AS count FROM stock_movements WHERE movement_number IS NULL OR BTRIM(movement_number) = ''`,
};

async function main() {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20_000 });
  await client.connect();
  try {
    const result = {};
    for (const [name, sql] of Object.entries(checks)) {
      const response = await client.query(sql);
      result[name] = response.rows[0].count;
    }
    const inventoryWarnings = ['duplicateInventoryBalances', 'negativeInventoryBalanceRows', 'negativeInventoryBalances'];
    const blocking = Object.entries(result).filter(([name, count]) => count > 0 && !inventoryWarnings.includes(name));
    const warnings = Object.entries(result).filter(([name, count]) => count > 0 && inventoryWarnings.includes(name));
    console.log(JSON.stringify({ status: blocking.length ? 'failed' : 'passed-with-inventory-warnings', checks: result, blocking, warnings }, null, 2));
    if (blocking.length) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
