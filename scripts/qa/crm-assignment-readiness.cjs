#!/usr/bin/env node
const path = require("path");
const { Client } = require("pg");
const dotenv = require("dotenv");
dotenv.config({ path: path.resolve(process.argv[2] || "apps/api/.env"), quiet: true });
const rawUrl = process.env.DATABASE_URL || process.env.DIRECT_URL;
if (!rawUrl) throw new Error("Database URL missing");
const db = new Client({ connectionString: rawUrl.replace(/([?&])sslmode=require(&|$)/, (_m,p,s)=>s?p:""), ssl: { rejectUnauthorized: false } });
(async () => {
  await db.connect();
  try {
    const result = await db.query(`
      WITH target AS (
        SELECT tenant_id FROM users WHERE lower(username)=lower($1) LIMIT 1
      )
      SELECT
        (SELECT count(*)::int FROM users WHERE tenant_id=(SELECT tenant_id FROM target) AND is_active=TRUE) AS active_users,
        (SELECT count(*)::int FROM employees WHERE tenant_id=(SELECT tenant_id FROM target) AND status='ACTIVE' AND user_id IS NOT NULL AND department ~* '(sales|commercial|business development)') AS sales_candidates,
        (SELECT count(*)::int FROM crm_assignment_rules WHERE tenant_id=(SELECT tenant_id FROM target) AND is_active=TRUE) AS active_rules,
        (SELECT COALESCE(sum(jsonb_array_length(assignee_user_ids)),0)::int FROM crm_assignment_rules WHERE tenant_id=(SELECT tenant_id FROM target) AND is_active=TRUE) AS configured_rule_owners
    `, [process.env.QA_USERNAME || "hnoman"]);
    console.log(JSON.stringify({ status: "PASS", ...result.rows[0] }));
  } finally { await db.end(); }
})().catch((error) => { console.error(error.message); process.exit(1); });
