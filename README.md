# Arwa Mizantra

Dedicated Mizantra Manufacturing ERP deployment for Arwa, Egypt.

## Deployment

- Application: https://arwa.mizantra.ae
- Server root: `/var/www/arwa-mizantra`
- API: PM2 `arwa-mizantra-api`, port `4002`
- Web: PM2 `arwa-mizantra-web`, port `3004`
- Database: dedicated Arwa Supabase project

The repository contains no production credentials. Use `apps/api/.env.arwa.example` as the server-side environment template and keep the populated `.env` outside Git.

## Build

```bash
pnpm install --frozen-lockfile
pnpm exec prisma generate --schema packages/database/prisma/schema.prisma
pnpm --filter @sak-erp/hr-module build
pnpm --filter @sak-erp/api build
pnpm --filter @sak-erp/web build
```

See [Arwa project handover](docs/ARWA_PROJECT_HANDOVER.md) for isolation, onboarding, release and acceptance details.
