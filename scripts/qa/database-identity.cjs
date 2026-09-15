const crypto = require('crypto');
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
    const response = await client.query(`
      SELECT
        current_database() AS database_name,
        inet_server_addr()::text AS server_address,
        inet_server_port() AS server_port
    `);
    const identity = response.rows[0];
    const source = `${identity.server_address}|${identity.server_port}|${identity.database_name}`;
    console.log(JSON.stringify({
      ...identity,
      fingerprint: crypto.createHash('sha256').update(source).digest('hex'),
    }));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
