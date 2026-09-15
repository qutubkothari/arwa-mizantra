/*
 * Applies the additive Accounts close/remittance migration only to the
 * explicitly selected test database.  This safeguard prevents an accidental
 * production run when deployments are operated from a shared workstation.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const apiDirectory = path.resolve(__dirname, '../apps/api');
const envPath = path.join(apiDirectory, '.env');
const migrationPath = path.resolve(
  __dirname,
  '../migrations/add-accounting-close-remittance-controls.sql',
);
const expectedHost = process.env.EXPECTED_DB_HOST;

function environmentValue(text, key) {
  const match = text.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return match ? match[1].trim().replace(/^['"]|['"]$/g, '') : '';
}

async function main() {
  const env = fs.readFileSync(envPath, 'utf8');
  const databaseUrl = environmentValue(env, 'DATABASE_URL');
  if (!databaseUrl) throw new Error('DATABASE_URL is not configured.');
  const host = new URL(databaseUrl).hostname;
  if (!expectedHost || host !== expectedHost) {
    throw new Error(
      `Refusing migration. Expected DB host ${expectedHost || '(not supplied)'}, found ${host}.`,
    );
  }
  const client = new Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  await client.query(fs.readFileSync(migrationPath, 'utf8'));
  await client.end();
  console.log(`Accounts migration applied to ${host}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
