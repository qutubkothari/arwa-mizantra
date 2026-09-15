#!/usr/bin/env bash
set -euo pipefail
app=/var/www/sak-erp-test
stage=/tmp/mizantra-business-transformation-20260830
backup=/root/sak-deploy-backups/mizantra-business-transformation-$(date +%Y%m%d-%H%M%S)
test "$PWD" = "$app"
test "$(readlink -f "$app")" = "$app"
test -f "$stage/apps/web/.next/BUILD_ID"
test -f "$stage/apps/api/dist/enterprise-edge/business-transformation.service.js"
test -f "$stage/apps/api/dist/enterprise-edge/business-transformation.controller.js"

paths=(
  apps/api/src/enterprise-edge/business-transformation.service.ts
  apps/api/src/enterprise-edge/business-transformation.controller.ts
  apps/api/src/enterprise-edge/enterprise-edge.module.ts
  apps/api/dist/enterprise-edge/business-transformation.service.js
  apps/api/dist/enterprise-edge/business-transformation.service.js.map
  apps/api/dist/enterprise-edge/business-transformation.controller.js
  apps/api/dist/enterprise-edge/business-transformation.controller.js.map
  apps/api/dist/enterprise-edge/enterprise-edge.module.js
  apps/api/dist/enterprise-edge/enterprise-edge.module.js.map
  apps/api/src/auth/guards/permissions.guard.ts
  apps/api/dist/auth/guards/permissions.guard.js
  apps/api/dist/auth/guards/permissions.guard.js.map
  apps/api/src/auth/utils/permission-utils.ts
  apps/api/dist/auth/utils/permission-utils.js
  apps/api/dist/auth/utils/permission-utils.js.map
  apps/web/src/app/dashboard/transformation/page.tsx
  apps/web/src/components/Sidebar.tsx
  apps/web/src/lib/permission-config.ts
  migrations/add-business-transformation-control.sql
  scripts/qa/apply-business-transformation-control-test.cjs
  scripts/qa/deploy-business-transformation-control-test.sh
)

mkdir -p "$backup"
existing=()
for path in "${paths[@]}"; do
  if [ -e "$path" ]; then existing+=("$path"); fi
done
tar -czf "$backup/files-before.tar.gz" "${existing[@]}"
for path in "${paths[@]}"; do
  mkdir -p "$(dirname "$path")"
  cp "$stage/$path" "$path"
done
mv apps/web/.next "$backup/web-next"
mv "$stage/apps/web/.next" apps/web/.next
pm2 restart sak-api-test sak-web-test
pm2 save

verified=false
for _ in 1 2 3 4 5 6 7 8 9 10; do
  api_code="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:4001/api/v1/transformation/dashboard || true)"
  page_code="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/dashboard/transformation || true)"
  if [[ "$api_code" =~ ^(401|403)$ ]] && [ "$page_code" = 200 ]; then verified=true; break; fi
  sleep 2
done

if [ "$verified" != true ]; then
  rm -rf -- "$app/apps/web/.next"
  mv "$backup/web-next" "$app/apps/web/.next"
  tar -xzf "$backup/files-before.tar.gz" -C "$app"
  pm2 restart sak-api-test sak-web-test
  echo 'Business Transformation deployment failed; previous Mizantra test runtime restored.' >&2
  exit 1
fi
echo "Mizantra TEST Business Transformation control deployed and verified. Backup: $backup"
