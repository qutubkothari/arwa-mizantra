# Manufacturing ERP - EC2 Deployment Guide

## Mandatory environment target gate

All VPS deployments and SQL migrations must declare exactly one target. The
preflight is fail-closed and validates the application root, public URL, PM2
processes, ports, `SUPABASE_URL`, `DATABASE_URL`, and Supabase service key before
any build or supported migration runner proceeds.

| Target | Application | Database project | API / Web |
| --- | --- | --- | --- |
| `live` | `/var/www/sak-erp` / `https://erp.saifseas.com` | `xjiyiywzmklljrpblcqj` | `sak-api:4000` / `sak-web:3000` |
| `test` | `/var/www/sak-erp-test` / `https://mizantra.saksolution.com` | `nwkaruzvzwwuftjquypk` | `sak-api-test:4001` / `sak-web-test:3001` |

Before a build, set `SAK_DEPLOY_TARGET=live` or `SAK_DEPLOY_TARGET=test`. Live
builds additionally require `SAK_LIVE_RELEASE_APPROVED=YES` and a non-empty
`SAK_LIVE_RELEASE_TICKET`. A missing or mismatched declaration stops the build.

Run SQL only through the target-aware migration runner from the selected
application root:

```bash
scripts/apply-target-migration.sh test migrations/example.sql
scripts/apply-target-migration.sh live migrations/example.sql
```

Verify both deployed environments from a workstation with:

```powershell
.\scripts\assert-environment-isolation.ps1
```

## Prerequisites

1. **EC2 Instance Setup**
   - Ubuntu 22.04 LTS or higher
   - Minimum: t3.medium (2 vCPU, 4GB RAM)
   - Recommended: t3.large (2 vCPU, 8GB RAM)
   - Security Group: Allow ports 22 (SSH), 3000 (Web), 4000 (API), 5432 (PostgreSQL)

2. **Required Software on EC2**
   ```bash
   # Connect to EC2
   ssh -i your-key.pem ubuntu@your-ec2-ip
   
   # Update system
   sudo apt update && sudo apt upgrade -y
   
   # Install Node.js 20.x
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt install -y nodejs
   
   # Install pnpm
   npm install -g pnpm
   
   # Install PM2 (Process Manager)
   npm install -g pm2
   
   # Install PostgreSQL
   sudo apt install -y postgresql postgresql-contrib
   sudo systemctl start postgresql
   sudo systemctl enable postgresql
   ```

3. **Database Setup on EC2**
   ```bash
   # Create database and user
   sudo -u postgres psql
   ```
   ```sql
   CREATE DATABASE manufacturing_erp;
   CREATE USER erp_user WITH PASSWORD 'your_secure_password';
   GRANT ALL PRIVILEGES ON DATABASE manufacturing_erp TO erp_user;
   \q
   ```

4. **Environment Variables**
   Create `/home/ubuntu/sak-erp/.env` on EC2:
   ```bash
   # Database
   DATABASE_URL=postgresql://erp_user:your_secure_password@localhost:5432/manufacturing_erp
   
   # API
   API_URL=http://localhost:4000
   NODE_ENV=production
   PORT=4000
   
   # JWT
   JWT_SECRET=your_super_secure_jwt_secret_here
   
   # Web
   NEXT_PUBLIC_API_URL=http://your-ec2-public-ip:4000/api/v1
   ```

## Deployment Steps

### Option 1: Automated Deployment (Recommended)

1. **Update Configuration**
   Edit `deploy-ec2.sh`:
   ```bash
   EC2_HOST="your-ec2-instance.compute.amazonaws.com"
   EC2_USER="ubuntu"
   EC2_KEY_PATH="./your-key.pem"
   ```

2. **Run Deployment Script**
   ```bash
   chmod +x deploy-ec2.sh
   ./deploy-ec2.sh
   ```

### Option 2: Manual Deployment

1. **Build Locally**
   ```bash
   pnpm install
   pnpm -C apps/api build
   pnpm -C apps/web build
   ```

2. **Create Package**
   ```bash
   tar -czf deploy.tar.gz \
     apps/web/.next \
     apps/web/package.json \
     apps/web/next.config.js \
     apps/api/dist \
     apps/api/package.json \
     packages/hr-module/dist \
     packages/hr-module/package.json \
     package.json \
     pnpm-workspace.yaml \
     pnpm-lock.yaml
   ```

3. **Upload to EC2**
   ```bash
   scp -i your-key.pem deploy.tar.gz ubuntu@your-ec2-ip:/home/ubuntu/
   ```

4. **Deploy on EC2**
   ```bash
   ssh -i your-key.pem ubuntu@your-ec2-ip
   
   # Extract and setup
   mkdir -p sak-erp
   cd sak-erp
   tar -xzf ../deploy.tar.gz
   
   # Install dependencies
   pnpm install --prod
   
   # Start with PM2
   cd apps/api
   pm2 start npm --name "sak-api" -- run start:prod
   
   cd ../web
   pm2 start npm --name "sak-web" -- start
   
   # Save PM2 config
   pm2 save
   pm2 startup
   ```

5. **Run Database Migrations**
   ```bash
   cd /home/ubuntu/sak-erp/apps/api
   # Run your SQL migrations
   psql -U erp_user -d manufacturing_erp -f migrations/*.sql
   ```

## Post-Deployment

### Setup Nginx Reverse Proxy (Recommended)

```bash
# Install Nginx
sudo apt install -y nginx

# Create config
sudo nano /etc/nginx/sites-available/sak-erp
```

```nginx
# Frontend
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}

# API
server {
    listen 80;
    server_name api.your-domain.com;

    location / {
      proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/sak-erp /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Setup SSL with Let's Encrypt

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com -d api.your-domain.com
```

## Management Commands

```bash
# View running processes
pm2 list

# View logs
pm2 logs
pm2 logs sak-api
pm2 logs sak-web

# Restart services
pm2 restart all
pm2 restart sak-api
pm2 restart sak-web

# Stop services
pm2 stop all

# Monitor resources
pm2 monit

# View detailed info
pm2 info sak-api
```

## Troubleshooting

### Check Application Status
```bash
pm2 list
pm2 logs --err  # Error logs only
```

### Check Database Connection
```bash
psql -U erp_user -d manufacturing_erp -c "SELECT version();"
```

### Check Network/Ports
```bash
sudo netstat -tulpn | grep -E ':(3000|4000|5432)'
```

### Restart Everything
```bash
pm2 restart all
sudo systemctl restart postgresql
sudo systemctl restart nginx
```

## Updating Deployed Application

```bash
# Run deployment script again
./deploy-ec2.sh

# Or manually:
# 1. Build locally
# 2. Upload new deploy.tar.gz
# 3. SSH to EC2 and extract
# 4. pm2 restart all
```

## Security Checklist

- [ ] Change default PostgreSQL password
- [ ] Update JWT_SECRET in .env
- [ ] Configure firewall (ufw)
- [ ] Setup SSL certificates
- [ ] Enable automatic security updates
- [ ] Setup monitoring (CloudWatch, Datadog, etc.)
- [ ] Configure backups for database
- [ ] Restrict SSH access to specific IPs
- [ ] Use environment-specific credentials

## Monitoring Setup (Optional)

```bash
# Install monitoring tools
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7

# Setup CloudWatch (if using AWS)
# Or setup Datadog, New Relic, etc.
```

## Access Your Application

- **Web**: http://your-ec2-ip:3000 (or http://your-domain.com with Nginx)
- **API**: http://your-ec2-ip:4000/api/v1 (or http://api.your-domain.com with Nginx)
- **HR Module**: http://your-domain.com/dashboard/hr

## Need Help?

Common issues:
1. **Port already in use**: `pm2 delete all && pm2 start ...`
2. **Database connection**: Check DATABASE_URL in .env
3. **Permission denied**: `sudo chown -R ubuntu:ubuntu /home/ubuntu/sak-erp`
4. **Build errors**: Ensure Node.js 20+ and pnpm are installed
