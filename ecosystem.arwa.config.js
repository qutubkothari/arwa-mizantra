module.exports = {
  apps: [
    {
      name: 'arwa-mizantra-api',
      cwd: '/var/www/arwa-mizantra/apps/api',
      script: 'npm',
      args: 'run start:prod',
      env: { NODE_ENV: 'production', PORT: '4002', APP_PORT: '4002' },
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '750M',
    },
    {
      name: 'arwa-mizantra-web',
      cwd: '/var/www/arwa-mizantra/apps/web',
      script: 'npm',
      args: 'run start -- -p 3003',
      env: { NODE_ENV: 'production', PORT: '3003' },
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '1G',
    },
  ],
};
