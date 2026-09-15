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
    const response = await client.query(`
      SELECT
        procedure.oid::regprocedure::text AS signature,
        pg_get_functiondef(procedure.oid) AS definition
      FROM pg_proc procedure
      JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
      WHERE namespace.nspname = 'public'
        AND procedure.proname = 'adjust_inventory_stock'
      ORDER BY procedure.oid
    `);
    console.log(JSON.stringify(response.rows, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
