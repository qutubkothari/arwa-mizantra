const path = require('path');
const { Client } = require('pg');
const dotenv = require('dotenv');

const envPath = process.argv[2] || 'apps/api/.env';
dotenv.config({ path: path.resolve(envPath), quiet: true });

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
    const { rows } = await client.query(`
      SELECT document_type, last_number
      FROM public.service_document_sequences
      ORDER BY document_type
    `);
    const functionResult = await client.query(`
      SELECT to_regprocedure('public.next_service_document_number(text)') IS NOT NULL AS function_ready
    `);
    console.log(JSON.stringify({
      function_ready: functionResult.rows[0]?.function_ready === true,
      ranges: rows,
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
