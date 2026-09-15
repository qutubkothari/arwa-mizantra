// PM2 Ecosystem Configuration for SAK ERP
//
// Portable config: it uses the folder containing this file as the base directory.
// Override with:
//   SAK_ERP_DIR=/var/www/sak-erp pm2 start ecosystem.config.js
//
// Web mode (default dev):
//   SAK_WEB_MODE=dev   -> pnpm run dev (NODE_ENV=development)
//   SAK_WEB_MODE=start -> pnpm run start (NODE_ENV=production; requires `pnpm -C apps/web build`)
//
// Usage:
//   pm2 startOrReload ecosystem.config.js --update-env
//   pm2 save

const path = require('path');

const baseDir = process.env.SAK_ERP_DIR || __dirname;
const webMode = (process.env.SAK_WEB_MODE || 'dev').toLowerCase();
const webScript = webMode === 'start' ? 'start' : 'dev';
const webNodeEnv = webMode === 'start' ? 'production' : 'development';

module.exports = {
  apps: [
    {
      name: 'sak-api',
      script: 'pnpm',
      args: 'start:prod',
      cwd: path.join(baseDir, 'apps', 'api'),
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 4000
      },
      error_file: path.join(process.env.HOME || '/tmp', '.pm2', 'logs', 'sak-api-error.log'),
      out_file: path.join(process.env.HOME || '/tmp', '.pm2', 'logs', 'sak-api-out.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true
    },
    {
      name: 'sak-web',
      script: 'pnpm',
      args: webScript,
      cwd: path.join(baseDir, 'apps', 'web'),
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '800M',
      env: {
        NODE_ENV: webNodeEnv,
        PORT: 3000
      },
      error_file: path.join(process.env.HOME || '/tmp', '.pm2', 'logs', 'sak-web-error.log'),
      out_file: path.join(process.env.HOME || '/tmp', '.pm2', 'logs', 'sak-web-out.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true
    }
  ]
};
