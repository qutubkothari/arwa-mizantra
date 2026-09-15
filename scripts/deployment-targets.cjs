const fs = require('fs');
const path = require('path');

const TARGETS = Object.freeze({
  live: Object.freeze({
    name: 'SaifSeas live',
    host: '72.62.192.228',
    sshUser: 'qutubk',
    appRoot: '/var/www/sak-erp',
    apiProcess: 'sak-api',
    webProcess: 'sak-web',
    apiPort: '4000',
    webPort: '3000',
    publicUrl: 'https://erp.saifseas.com',
    databaseProjectRef: 'xjiyiywzmklljrpblcqj',
  }),
  test: Object.freeze({
    name: 'Mizantra test',
    host: '200.141.1.206',
    sshUser: 'root',
    appRoot: '/var/www/sak-erp-test',
    apiProcess: 'sak-api-test',
    webProcess: 'sak-web-test',
    apiPort: '4001',
    webPort: '3001',
    publicUrl: 'https://mizantra.saksolution.com',
    databaseProjectRef: 'nwkaruzvzwwuftjquypk',
  }),
  arwa: Object.freeze({
    name: 'Arwa Egypt production',
    host: '200.141.1.206',
    sshUser: 'root',
    appRoot: '/var/www/arwa-mizantra',
    apiProcess: 'arwa-mizantra-api',
    webProcess: 'arwa-mizantra-web',
    apiPort: '4002',
    webPort: '3003',
    publicUrl: 'https://arwa.mizantra.ae',
    databaseProjectRef: 'igwbnjjepprmmhutrvej',
  }),
});

function normalizePath(value) {
  return path.resolve(value).replace(/\\/g, '/').replace(/\/$/, '');
}

function parseEnvFile(envPath) {
  const values = {};
  const text = fs.readFileSync(envPath, 'utf8').replace(/\r/g, '');
  for (const line of text.split('\n')) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function projectRefFromSupabaseUrl(raw) {
  if (!raw) return '';
  try {
    const host = new URL(raw).hostname.toLowerCase();
    const match = host.match(/^([a-z0-9-]+)\.supabase\.co$/);
    return match ? match[1] : '';
  } catch {
    return '';
  }
}

function projectRefFromDatabaseUrl(raw) {
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    const direct = parsed.hostname.toLowerCase().match(/^db\.([a-z0-9-]+)\.supabase\.co$/);
    if (direct) return direct[1];
    const username = decodeURIComponent(parsed.username || '');
    const pooler = username.match(/^postgres\.([a-z0-9-]+)$/i);
    return pooler ? pooler[1].toLowerCase() : '';
  } catch {
    return '';
  }
}

function projectRefFromJwt(raw) {
  if (!raw || !raw.includes('.')) return '';
  try {
    const payload = JSON.parse(
      Buffer.from(raw.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(),
    );
    return String(payload.ref || '').toLowerCase();
  } catch {
    return '';
  }
}

function validateEnvironment(targetName, appRoot, envPath) {
  const target = TARGETS[targetName];
  if (!target) throw new Error(`Unknown deployment target: ${targetName || '<missing>'}`);

  const normalizedRoot = normalizePath(appRoot);
  if (normalizedRoot !== target.appRoot) {
    throw new Error(
      `Target ${targetName} requires application root ${target.appRoot}; received ${normalizedRoot}`,
    );
  }
  if (!fs.existsSync(envPath)) throw new Error(`API environment file not found: ${envPath}`);

  const env = parseEnvFile(envPath);
  const expected = target.databaseProjectRef;
  const urlRef = projectRefFromSupabaseUrl(env.SUPABASE_URL);
  const databaseRef = projectRefFromDatabaseUrl(env.DATABASE_URL || env.DIRECT_URL);
  const serviceRef = projectRefFromJwt(env.SUPABASE_KEY);

  const checks = { SUPABASE_URL: urlRef, DATABASE_URL: databaseRef, SUPABASE_KEY: serviceRef };
  for (const [key, actual] of Object.entries(checks)) {
    if (actual !== expected) {
      throw new Error(
        `${target.name} deployment blocked: ${key} resolves to ${actual || '<unknown>'}, expected ${expected}`,
      );
    }
  }

  for (const key of ['SUPABASE_SERVICE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY']) {
    if (!env[key]) continue;
    const actual = projectRefFromJwt(env[key]);
    if (actual && actual !== expected) {
      throw new Error(
        `${target.name} deployment blocked: ${key} belongs to ${actual}, expected ${expected}`,
      );
    }
  }

  const envText = fs.readFileSync(envPath, 'utf8');
  for (const [otherName, otherTarget] of Object.entries(TARGETS)) {
    if (otherName === targetName) continue;
    if (envText.includes(otherTarget.databaseProjectRef)) {
      throw new Error(
        `${target.name} deployment blocked: environment contains the ${otherTarget.name} database reference`,
      );
    }
  }

  return { target: targetName, ...target, envPath, databaseProjectRef: expected };
}

module.exports = {
  TARGETS,
  normalizePath,
  parseEnvFile,
  projectRefFromDatabaseUrl,
  projectRefFromJwt,
  projectRefFromSupabaseUrl,
  validateEnvironment,
};
