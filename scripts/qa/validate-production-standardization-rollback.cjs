const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const dotenv = require('dotenv');

const migrationPath = process.argv[2];
const envPath = process.argv[3] || 'apps/api/.env';
if (!migrationPath) throw new Error('Migration path is required');

dotenv.config({ path: path.resolve(envPath) });
const rawUrl = process.env.DATABASE_URL || process.env.DIRECT_URL;
if (!rawUrl) throw new Error('DATABASE_URL or DIRECT_URL is required');
const connectionString = rawUrl.replace(/([?&])sslmode=require(&|$)/, (_match, prefix, suffix) => suffix ? prefix : '');
const sql = fs.readFileSync(path.resolve(migrationPath), 'utf8');

async function main() {
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20_000,
  });
  await client.connect();
  let began = false;
  try {
    await client.query('BEGIN');
    began = true;
    await client.query(sql);
    await client.query('ROLLBACK');
    began = false;
    console.log(JSON.stringify({ status: 'valid', persisted: false, migration: path.basename(migrationPath) }));
  } finally {
    if (began) await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
