const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { Client } = require('pg');

const envFile = process.argv[2] || 'apps/api/.env';
const migrations = process.argv.slice(3);
if (!migrations.length) throw new Error('At least one migration is required');
dotenv.config({ path: path.resolve(process.cwd(), envFile) });
const raw = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!raw) throw new Error('Missing database connection');
const url = new URL(raw);
['sslmode','sslrootcert','sslcert','sslkey'].forEach((key) => url.searchParams.delete(key));

(async () => {
  const client = new Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query('BEGIN');
    for (const migration of migrations) await client.query(fs.readFileSync(path.resolve(process.cwd(), migration), 'utf8'));
    const validateOnly = process.env.PRODUCTION_STANDARDIZATION_VALIDATE_ONLY === '1';
    await client.query(validateOnly ? 'ROLLBACK' : 'COMMIT');
    console.log(JSON.stringify({ status: validateOnly ? 'validated' : 'applied', persisted: !validateOnly, migrations: migrations.map((file) => path.basename(file)) }));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { await client.end(); }
})().catch((error) => { console.error(error.message); process.exit(1); });
