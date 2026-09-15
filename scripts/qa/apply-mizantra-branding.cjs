const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
require('dotenv').config({ path: path.resolve(process.cwd(), process.argv[2] || 'apps/api/.env') });

async function main() {
  const migrationPath = path.resolve(process.cwd(), process.argv[3] || 'migrations/rebrand-mizantra-to-sak-solutions.sql');
  const raw = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!raw) throw new Error('Missing database connection');
  const url = new URL(raw);
  ['sslmode', 'sslrootcert', 'sslcert', 'sslkey'].forEach((key) => url.searchParams.delete(key));
  const client = new Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });
  await client.connect();
  let transactionOpen = false;
  try {
    await client.query('BEGIN');
    transactionOpen = true;
    const before = (await client.query(
      `select id, name, domain, subdomain from public.tenants
       where lower(coalesce(name, '')) like '%saif%'
          or lower(coalesce(domain, '')) like '%saif%'
          or lower(coalesce(subdomain, '')) like '%saif%'
          or lower(coalesce(settings::text, '')) like '%saif%'
       order by name`,
    )).rows;
    await client.query(fs.readFileSync(migrationPath, 'utf8'));
    const remaining = Number((await client.query(
      `select count(*)::int as count from public.tenants
       where lower(coalesce(name, '')) like '%saif%'
          or lower(coalesce(domain, '')) like '%saif%'
          or lower(coalesce(subdomain, '')) like '%saif%'
          or lower(coalesce(settings::text, '')) like '%saif%'`,
    )).rows[0]?.count || 0);
    if (remaining !== 0) throw new Error(`${remaining} legacy tenant-branding record(s) remain`);
    const validateOnly = process.env.MIZANTRA_BRANDING_VALIDATE_ONLY === '1';
    await client.query(validateOnly ? 'ROLLBACK' : 'COMMIT');
    transactionOpen = false;
    console.log(JSON.stringify({ status: validateOnly ? 'validated' : 'applied', persisted: !validateOnly, before, remaining }));
  } finally {
    if (transactionOpen) await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
