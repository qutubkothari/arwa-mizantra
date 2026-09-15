#!/usr/bin/env bash
set -euo pipefail
app=/var/www/sak-erp-test
stage=/tmp/mizantra-production-valuation-20260830
backup=/root/sak-deploy-backups/mizantra-production-valuation-$(date +%Y%m%d-%H%M%S)
test "$PWD" = "$app"
test "$(readlink -f "$app")" = "$app"
test -f "$stage/apps/web/.next/BUILD_ID"
test -f "$stage/apps/api/dist/production/services/job-order.service.js"
test -f "$stage/apps/api/dist/costing/costing.service.js"
paths=(
  apps/api/src/production/services/job-order.service.ts
  apps/api/dist/production/services/job-order.service.js
  apps/api/dist/production/services/job-order.service.js.map
  apps/api/src/costing/costing.service.ts
  apps/api/dist/costing/costing.service.js
  apps/api/dist/costing/costing.service.js.map
  apps/web/src/app/dashboard/accounts/costing/page.tsx
  scripts/qa/deploy-production-valuation-events-test.sh
)
mkdir -p "$backup"
existing=()
for path in "${paths[@]}"; do if [ -e "$path" ]; then existing+=("$path"); fi; done
tar -czf "$backup/files-before.tar.gz" "${existing[@]}"
for path in "${paths[@]}"; do mkdir -p "$(dirname "$path")"; cp "$stage/$path" "$path"; done
mv apps/web/.next "$backup/web-next"
mv "$stage/apps/web/.next" apps/web/.next
pm2 restart sak-api-test sak-web-test
pm2 save
verified=false
for _ in 1 2 3 4 5 6 7 8 9 10; do
  api_code="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:4001/api/v1/costing/production-variance || true)"
  page_code="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/dashboard/accounts/costing || true)"
  if [[ "$api_code" =~ ^(401|403)$ ]] && [ "$page_code" = 200 ]; then verified=true; break; fi
  sleep 2
done
if [ "$verified" != true ]; then
  rm -rf -- "$app/apps/web/.next"
  mv "$backup/web-next" "$app/apps/web/.next"
  tar -xzf "$backup/files-before.tar.gz" -C "$app"
  pm2 restart sak-api-test sak-web-test
  echo 'Production valuation deployment failed; previous Mizantra test runtime restored.' >&2
  exit 1
fi
echo "Mizantra TEST production valuation deployed and verified. Backup: $backup"
