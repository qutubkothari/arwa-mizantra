const path = require('path');

const cwd = path.resolve(process.cwd()).replace(/\\/g, '/');
const liveRoot = '/var/www/sak-erp';
const isLiveBuild = cwd === liveRoot || cwd.startsWith(`${liveRoot}/`);
const isTestBuild = cwd === `${liveRoot}-test` || cwd.startsWith(`${liveRoot}-test/`);

if (isLiveBuild && !isTestBuild) {
  const approved = process.env.SAK_LIVE_RELEASE_APPROVED === 'YES';
  const releaseTicket = String(process.env.SAK_LIVE_RELEASE_TICKET || '').trim();

  if (!approved || !releaseTicket) {
    console.error(
      'LIVE BUILD BLOCKED: an explicit production release approval and release ticket are required.',
    );
    console.error(
      'Set SAK_LIVE_RELEASE_APPROVED=YES and SAK_LIVE_RELEASE_TICKET=<approved-release-reference> only for an authorised live release.',
    );
    process.exit(2);
  }
}

console.log(isLiveBuild && !isTestBuild ? 'Authorised live build gate passed.' : 'Non-live build gate passed.');
