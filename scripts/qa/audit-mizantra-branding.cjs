const path = require('path');
const { Client } = require('pg');
require('dotenv').config({ path: process.argv[2] || path.resolve('apps/api/.env') });

async function main() {
  const raw = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!raw) throw new Error('Missing database connection');
  const url = new URL(raw);
  ['sslmode', 'sslrootcert', 'sslcert', 'sslkey'].forEach((key) => url.searchParams.delete(key));
  const client = new Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const result = {};
    for (const table of ['tenants', 'companies']) {
      const exists = await client.query('select to_regclass($1) as table_name', [`public.${table}`]);
      if (!exists.rows[0]?.table_name) continue;
      const rows = await client.query(
        `select id, name${table === 'tenants' ? ', domain, subdomain' : ''} from public.${table}
         where lower(coalesce(name, '')) like '%saif%'
         order by name`,
      );
      result[table] = rows.rows;
    }
    result.tenantColumns = (await client.query(
      `select column_name, data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'tenants'
         and column_name in ('name', 'domain', 'subdomain', 'settings')
       order by column_name`,
    )).rows;
    result.tenantSettingMatches = Number((await client.query(
      `select count(*)::int as count from public.tenants
       where lower(coalesce(settings::text, '')) like '%saif%'`,
    )).rows[0]?.count || 0);
    console.log(JSON.stringify(result));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
