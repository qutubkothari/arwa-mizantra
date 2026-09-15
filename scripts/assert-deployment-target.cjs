#!/usr/bin/env node
const path = require('path');
const { TARGETS, normalizePath, validateEnvironment } = require('./deployment-targets.cjs');

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function required(name) {
  const value = argument(name);
  if (!value) throw new Error(`Missing required --${name} argument`);
  return value;
}

try {
  const targetName = required('target');
  const target = TARGETS[targetName];
  if (!target) throw new Error(`--target must be exactly live or test; received ${targetName}`);

  const appRoot = normalizePath(required('app-root'));
  const actual = {
    host: required('host'),
    sshUser: required('ssh-user'),
    apiProcess: required('api-process'),
    webProcess: required('web-process'),
    apiPort: required('api-port'),
    webPort: required('web-port'),
    publicUrl: required('public-url').replace(/\/$/, ''),
  };
  for (const [key, value] of Object.entries(actual)) {
    if (value !== target[key]) {
      throw new Error(
        `${target.name} deployment blocked: ${key} must be ${target[key]}, received ${value}`,
      );
    }
  }

  const envPath = argument('env-file') || path.join(appRoot, 'apps/api/.env');
  const result = validateEnvironment(targetName, appRoot, envPath);
  console.log(
    JSON.stringify({
      approved: true,
      target: result.target,
      name: result.name,
      host: result.host,
      sshUser: result.sshUser,
      appRoot: result.appRoot,
      publicUrl: result.publicUrl,
      apiProcess: result.apiProcess,
      webProcess: result.webProcess,
      databaseProjectRef: result.databaseProjectRef,
    }),
  );
} catch (error) {
  console.error(`DEPLOYMENT BLOCKED: ${error.message}`);
  process.exit(2);
}
