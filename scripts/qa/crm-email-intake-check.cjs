const path = require('path');
const dotenv = require('dotenv');
const { Pool } = require('pg');

const envFile = path.resolve(process.argv[2] || 'apps/api/.env');
const recipient = String(process.argv[3] || '').trim().toLowerCase();
dotenv.config({ path: envFile, quiet: true });
const raw = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!raw) throw new Error('DIRECT_URL or DATABASE_URL is required');
const url = new URL(raw);
['sslmode', 'sslrootcert', 'sslcert', 'sslkey'].forEach((key) => url.searchParams.delete(key));
const pool = new Pool({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });

async function main() {
  const { rows: routes } = await pool.query(
    `select r.id, r.tenant_id, r.route_name, r.email_address, r.is_active, r.last_received_at,
            s.email_intake_enabled, s.auto_assign_enabled, s.assignment_strategy,
            (select count(*)::int from crm_sales_pool_members p where p.tenant_id=r.tenant_id and p.is_active) as sales_pool
       from crm_email_receipt_routes r
       left join crm_intake_settings s on s.tenant_id=r.tenant_id
      where ($1 = '' or lower(r.email_address)=$1)
      order by r.created_at desc`,
    [recipient],
  );
  const tenantIds = routes.map((row) => row.tenant_id);
  const { rows: emails } = await pool.query(
    `select id, message_id, thread_id, from_address, subject, received_date,
            processing_status, crm_intake_processed_at, crm_intake_message_id, crm_intake_error,
            to_addresses, cc_addresses
       from email_inbox
      where received_date >= now() - interval '24 hours'
        and ($1 = '' or coalesce(to_addresses::text,'') ilike '%' || $1 || '%' or coalesce(cc_addresses::text,'') ilike '%' || $1 || '%')
      order by received_date desc limit 20`,
    [recipient],
  );
  let intakes = [];
  let leads = [];
  if (tenantIds.length) {
    ({ rows: intakes } = await pool.query(
      `select id, tenant_id, channel, external_id, sender_address, subject, classification,
              confidence, decision, lead_id, reviewed_at,
              fallback_used, received_at, created_at
         from crm_intake_messages
        where tenant_id=any($1::uuid[]) and channel='EMAIL' and created_at >= now() - interval '24 hours'
        order by created_at desc limit 20`,
      [tenantIds],
    ));
    ({ rows: leads } = await pool.query(
      `select id, lead_number, company_name, email, source, stage_id, owner_user_id, created_at
         from crm_leads
        where tenant_id=any($1::uuid[]) and source='EMAIL' and created_at >= now() - interval '24 hours'
        order by created_at desc limit 20`,
      [tenantIds],
    ));
  }
  console.log(JSON.stringify({ checked_at: new Date().toISOString(), routes, emails, intakes, leads }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
