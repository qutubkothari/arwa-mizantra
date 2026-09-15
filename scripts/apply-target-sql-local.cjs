#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const {
  TARGETS,
  parseEnvFile,
  projectRefFromDatabaseUrl,
  projectRefFromSupabaseUrl,
} = require('./deployment-targets.cjs');

const [targetName, envArg, sqlArg] = process.argv.slice(2);
const target = TARGETS[targetName];
if (!target || !envArg || !sqlArg) {
  console.error('Usage: node scripts/apply-target-sql-local.cjs <live|test> <env-file> <sql-file>');
  process.exit(64);
}

const envPath = path.resolve(envArg);
const sqlPath = path.resolve(sqlArg);
const env = parseEnvFile(envPath);
const databaseConnection = env.DATABASE_URL || env.DIRECT_URL;
const expectedRef = target.databaseProjectRef;
const supabaseRef = projectRefFromSupabaseUrl(env.SUPABASE_URL);
const databaseRef = projectRefFromDatabaseUrl(databaseConnection);

if (supabaseRef !== expectedRef || databaseRef !== expectedRef) {
  console.error(
    `DEPLOYMENT BLOCKED: ${target.name} expected database ${expectedRef}; ` +
      `SUPABASE_URL=${supabaseRef || '<unknown>'}, DATABASE_URL=${databaseRef || '<unknown>'}`,
  );
  process.exit(65);
}

const databaseUrl = new URL(databaseConnection);
for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) {
  databaseUrl.searchParams.delete(key);
}

const pool = new Pool({
  connectionString: databaseUrl.toString(),
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const client = await pool.connect();
  try {
    console.log(
      `Applying ${path.basename(sqlPath)} to target=${targetName}, database=${expectedRef} only.`,
    );
    await client.query('BEGIN');
    await client.query(fs.readFileSync(sqlPath, 'utf8'));
    await client.query('COMMIT');
    console.log(`Migration completed for target=${targetName}, database=${expectedRef}.`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
})().catch((error) => {
  console.error(
    `Migration failed: ${error.message}` +
      (error.detail ? `\nDetail: ${error.detail}` : '') +
      (error.hint ? `\nHint: ${error.hint}` : ''),
  );
  process.exitCode = 1;
});
