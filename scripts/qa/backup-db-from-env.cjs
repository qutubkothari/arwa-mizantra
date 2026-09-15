const path = require('path');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');

const envFile = path.resolve(process.argv[2] || 'apps/api/.env');
const output = path.resolve(process.argv[3] || `database-backup-${Date.now()}.dump`);
dotenv.config({ path: envFile, quiet: true });
const connection = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!connection) throw new Error('DIRECT_URL or DATABASE_URL is required');

const result = spawnSync('pg_dump', ['--format=custom', '--no-owner', '--no-acl', '--file', output, connection], {
  stdio: 'inherit',
  env: process.env,
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
console.log(`Database backup created: ${output}`);
