const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { Pool } = require('pg');

const envPathArg = process.argv[2];
const sqlPathArg = process.argv[3];

if (!envPathArg || !sqlPathArg) {
  console.error('Usage: node scripts/apply-sql-env-noverify.cjs <env-file> <sql-file>');
  process.exit(1);
}

const envPath = path.isAbsolute(envPathArg)
  ? envPathArg
  : path.resolve(process.cwd(), envPathArg);
const sqlPath = path.isAbsolute(sqlPathArg)
  ? sqlPathArg
  : path.resolve(process.cwd(), sqlPathArg);

dotenv.config({ path: envPath });

const rawConnectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!rawConnectionString) {
  console.error('Missing DIRECT_URL or DATABASE_URL in env file');
  process.exit(1);
}

// `pg` gives SSL query-string options precedence over the explicit ssl object.
// Remove certificate-policy parameters so this deliberately named deployment
// helper can consistently connect to managed PostgreSQL endpoints whose chain
// is not available on the application host.
const databaseUrl = new URL(rawConnectionString);
['sslmode', 'sslrootcert', 'sslcert', 'sslkey'].forEach((key) => databaseUrl.searchParams.delete(key));
const connectionString = databaseUrl.toString();

const sql = fs.readFileSync(sqlPath, 'utf8');
const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false, ca: undefined },
});

pool.query(sql)
  .then(() => {
    console.log(`Applied SQL successfully: ${path.basename(sqlPath)}`);
  })
  .catch((error) => {
    console.error(`Failed applying SQL: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
