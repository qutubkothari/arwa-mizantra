const fs = require('fs');
const { Client } = require('pg');

async function main() {
  const sqlPath = process.argv[2];
  if (!sqlPath) throw new Error('Usage: node --env-file=<env> scripts/apply-sql-file.cjs <migration.sql>');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  const client = new Client({
    connectionString: process.env.DATABASE_URL.replace(/([?&])sslmode=[^&]+&?/i, '$1').replace(/[?&]$/, ''),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query(fs.readFileSync(sqlPath, 'utf8'));
  } finally {
    await client.end();
  }
  process.stdout.write(`Applied ${sqlPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
