const { spawn, execFileSync } = require('node:child_process');

function killProcessTree(pid) {
  if (!pid) return;

  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
      return;
    } catch {
      // fall through
    }
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // ignore
  }
}

const isWindows = process.platform === 'win32';

function getNodeMajorVersion() {
  const major = Number(String(process.versions.node || '').split('.')[0]);
  return Number.isFinite(major) ? major : null;
}

function resolveBuilder() {
  const envBuilder = (process.env.NEST_DEV_BUILDER || '').trim().toLowerCase();
  if (envBuilder) return envBuilder;

  // @swc/core frequently lags behind new Node majors. If SWC native bindings
  // aren't available for the current Node version, Nest can crash (exit 134).
  // Prefer tsc on newer Node versions for a stable dev experience.
  const nodeMajor = getNodeMajorVersion();
  if (nodeMajor && nodeMajor >= 23) return 'tsc';
  return 'swc';
}

const builder = resolveBuilder();

function withDefaultNodeOptions(env) {
  const maxOldSpaceSize = String(process.env.NEST_DEV_MAX_OLD_SPACE_SIZE || '').trim();
  const defaultSize = maxOldSpaceSize ? Number(maxOldSpaceSize) : 4096;
  const requestedSize = Number.isFinite(defaultSize) && defaultSize > 0 ? defaultSize : 4096;

  const existing = String(env.NODE_OPTIONS || '');
  if (/--max-old-space-size=\d+/i.test(existing)) return env;

  const suffix = `--max-old-space-size=${requestedSize}`;
  return {
    ...env,
    NODE_OPTIONS: existing ? `${existing} ${suffix}` : suffix,
  };
}

const command = isWindows ? 'cmd.exe' : 'pnpm';
const args = isWindows
  ? ['/d', '/s', '/c', `pnpm exec nest start --watch --builder ${builder}`]
  : ['exec', 'nest', 'start', '--watch', '--builder', builder];

const child = spawn(command, args, {
  stdio: 'inherit',
  shell: false,
  windowsHide: true,
  env: withDefaultNodeOptions({
    ...process.env,
    // Helps prevent noisy/expensive watch behavior in some setups.
    TSC_WATCHFILE: 'UseFsEvents',
  }),
});

let exiting = false;
function shutdown() {
  if (exiting) return;
  exiting = true;
  killProcessTree(child.pid);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGHUP', shutdown);
process.on('exit', shutdown);

child.on('exit', (code) => {
  process.exitCode = code ?? 0;
});
