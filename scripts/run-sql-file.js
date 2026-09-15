const fs = require('fs');
const { Client } = require('pg');

const envPath = process.argv[2];
const sqlPath = process.argv[3];

if (!envPath || !sqlPath) {
  console.error('Usage: node scripts/run-sql-file.js <env-file> <sql-file>');
  process.exit(1);
}

const envText = fs.readFileSync(envPath, 'utf8');
const databaseUrlLine = envText
  .split(/\r?\n/)
  .find((line) => line.trim().startsWith('DATABASE_URL='));

if (!databaseUrlLine) {
  console.error('DATABASE_URL missing');
  process.exit(1);
}

let databaseUrl = databaseUrlLine.slice(databaseUrlLine.indexOf('=') + 1).trim();
if (
  (databaseUrl.startsWith('"') && databaseUrl.endsWith('"')) ||
  (databaseUrl.startsWith("'") && databaseUrl.endsWith("'"))
) {
  databaseUrl = databaseUrl.slice(1, -1);
}

try {
  const parsedUrl = new URL(databaseUrl);
  parsedUrl.searchParams.delete('sslmode');
  databaseUrl = parsedUrl.toString();
} catch {
  // Keep the original connection string if URL parsing fails.
}

const sql = fs.readFileSync(sqlPath, 'utf8');
const client = new Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});

client
  .connect()
  .then(() => client.query(sql))
  .then(() => {
    console.log('SQL applied');
  })
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => client.end());
