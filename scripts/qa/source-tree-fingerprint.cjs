const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const manifestMode = process.argv.includes('--manifest');
const roots = process.argv.slice(2).filter((arg) => arg !== '--manifest');
if (!roots.length) {
  console.error('usage: node source-tree-fingerprint.cjs <path> [...]');
  process.exit(64);
}

const files = [];
function walk(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    files.push(target);
    return;
  }
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (['.next', 'dist', 'node_modules'].includes(entry.name)) continue;
    walk(path.join(target, entry.name));
  }
}

for (const root of roots) walk(root);
files.sort((a, b) => a.replaceAll('\\', '/').localeCompare(b.replaceAll('\\', '/')));

const aggregate = crypto.createHash('sha256');
const manifest = {};
for (const file of files) {
  const relative = path.relative(process.cwd(), file).replaceAll('\\', '/');
  const fileHash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  manifest[relative] = fileHash;
  aggregate.update(relative).update('\0').update(fileHash).update('\0');
}

console.log(JSON.stringify({
  files: files.length,
  sha256: aggregate.digest('hex'),
  ...(manifestMode ? { manifest } : {}),
}));
