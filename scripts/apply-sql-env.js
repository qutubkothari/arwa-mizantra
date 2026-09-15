/*
  Apply a SQL file using an explicit dotenv env file.

  Usage:
    node scripts/apply-sql-env.js apps/api/.env.test migrations/my-change.sql
*/

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { Pool } = require('pg');

const envPathArg = process.argv[2];
const sqlPathArg = process.argv[3];

if (!envPathArg || !sqlPathArg) {
  console.error('Usage: node scripts/apply-sql-env.js <env-file> <sql-file>');
  process.exit(1);
}

const envPath = path.isAbsolute(envPathArg)
  ? envPathArg
  : path.resolve(process.cwd(), envPathArg);
const sqlPath = path.isAbsolute(sqlPathArg)
  ? sqlPathArg
  : path.resolve(process.cwd(), sqlPathArg);

if (!fs.existsSync(envPath)) {
  console.error(`Env file not found: ${envPath}`);
  process.exit(1);
}

if (!fs.existsSync(sqlPath)) {
  console.error(`SQL file not found: ${sqlPath}`);
  process.exit(1);
}

dotenv.config({ path: envPath });

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Missing DIRECT_URL or DATABASE_URL in env file');
  process.exit(1);
}

const sql = fs.readFileSync(sqlPath, 'utf8');
const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
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
