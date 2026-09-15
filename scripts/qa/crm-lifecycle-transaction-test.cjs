const path = require("path");
const dotenv = require("dotenv");
const { Client } = require("pg");

dotenv.config({ path: path.resolve(process.argv[2] || "apps/api/.env"), quiet: true });
const raw = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!raw) throw new Error("DIRECT_URL or DATABASE_URL is required");
const url = new URL(raw);
["sslmode", "sslrootcert", "sslcert", "sslkey"].forEach((key) => url.searchParams.delete(key));

async function main() {
  const db = new Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("BEGIN");
    const context = (await db.query(`
      SELECT t.id AS tenant_id, u.id AS user_id, c.id AS customer_id,
             (SELECT id FROM crm_pipeline_stages WHERE tenant_id=t.id AND stage_code='NEW') AS new_stage
        FROM tenants t
        JOIN users u ON u.tenant_id=t.id
        JOIN customers c ON c.tenant_id=t.id AND c.is_active=TRUE
       WHERE EXISTS (SELECT 1 FROM crm_pipeline_stages s WHERE s.tenant_id=t.id AND s.stage_code IN ('NEW','QUOTATION','WON'))
       LIMIT 1
    `)).rows[0];
    if (!context?.new_stage) throw new Error("No tenant has the required CRM/Sales test context.");
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const lead = (await db.query(`INSERT INTO crm_leads
      (tenant_id,lead_number,company_name,source,stage_id,created_by)
      VALUES ($1,$2,$3,'MANUAL',$4,$5) RETURNING id`,
      [context.tenant_id, `QA-LIFECYCLE-${suffix}`, "QA lifecycle rollback", context.new_stage, context.user_id])).rows[0];
    const quote = (await db.query(`INSERT INTO quotations
      (tenant_id,quotation_number,customer_id,quotation_date,created_by)
      VALUES ($1,$2,$3,CURRENT_DATE,$4) RETURNING id`,
      [context.tenant_id, `QA-QUOTE-${suffix}`, context.customer_id, context.user_id])).rows[0];
    await db.query("UPDATE crm_leads SET customer_id=$1 WHERE id=$2", [context.customer_id, lead.id]);
    await db.query("UPDATE quotations SET status=status WHERE id=$1", [quote.id]);
    let state = (await db.query(`SELECT s.stage_code,l.quotation_id FROM crm_leads l JOIN crm_pipeline_stages s ON s.id=l.stage_id WHERE l.id=$1`, [lead.id])).rows[0];
    if (state.stage_code !== "QUOTATION" || state.quotation_id !== quote.id) throw new Error(`Quotation lifecycle sync failed: ${JSON.stringify(state)}`);
    await db.query(`INSERT INTO sales_orders
      (tenant_id,so_number,quotation_id,customer_id,order_date,created_by)
      VALUES ($1,$2,$3,$4,CURRENT_DATE,$5)`,
      [context.tenant_id, `QA-SO-${suffix}`, quote.id, context.customer_id, context.user_id]);
    state = (await db.query(`SELECT s.stage_code FROM crm_leads l JOIN crm_pipeline_stages s ON s.id=l.stage_id WHERE l.id=$1`, [lead.id])).rows[0];
    if (state.stage_code !== "WON") throw new Error(`Sales-order lifecycle sync failed: ${JSON.stringify(state)}`);
    await db.query("ROLLBACK");
    console.log(JSON.stringify({ status: "PASS", environment: "MIZANTRA ONLY", quotation_sync: "QUOTATION", order_sync: "WON", persisted_test_rows: 0 }));
  } catch (error) {
    await db.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await db.end();
  }
}

main().catch((error) => { console.error(error.message); process.exit(1); });
