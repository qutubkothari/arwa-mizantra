#!/usr/bin/env bash
set -euo pipefail
app=/var/www/sak-erp-test
stage=/tmp/mizantra-owner-cockpit-20260830
backup=/root/sak-deploy-backups/mizantra-owner-cockpit-$(date +%Y%m%d-%H%M%S)
test "$PWD" = "$app"
test "$(readlink -f "$app")" = "$app"
test -f "$stage/apps/web/.next/BUILD_ID"
test -f "$stage/apps/api/dist/intelligence/intelligence.service.js"
test -f "$stage/apps/api/dist/intelligence/cross-module-exception.service.js"
paths=(
  apps/api/src/intelligence/intelligence.service.ts
  apps/api/dist/intelligence/intelligence.service.js
  apps/api/dist/intelligence/intelligence.service.js.map
  apps/api/src/intelligence/cross-module-exception.service.ts
  apps/api/dist/intelligence/cross-module-exception.service.js
  apps/api/dist/intelligence/cross-module-exception.service.js.map
  apps/web/src/app/dashboard/command-center/page.tsx
  scripts/qa/deploy-owner-transformation-cockpit-test.sh
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
  api_code="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:4001/api/v1/intelligence/transformation-cockpit || true)"
  page_code="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/dashboard/command-center || true)"
  if [[ "$api_code" =~ ^(401|403)$ ]] && [ "$page_code" = 200 ]; then verified=true; break; fi
  sleep 2
done
if [ "$verified" != true ]; then
  rm -rf -- "$app/apps/web/.next"
  mv "$backup/web-next" "$app/apps/web/.next"
  tar -xzf "$backup/files-before.tar.gz" -C "$app"
  pm2 restart sak-api-test sak-web-test
  echo 'Owner cockpit deployment failed; previous Mizantra test runtime restored.' >&2
  exit 1
fi
echo "Mizantra TEST owner cockpit deployed and verified. Backup: $backup"
