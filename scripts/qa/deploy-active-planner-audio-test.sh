#!/usr/bin/env bash
set -euo pipefail

app=/var/www/sak-erp-test
stage=/tmp/mizantra-active-planner-audio-20260830
backup=/root/sak-deploy-backups/mizantra-active-planner-audio-$(date +%Y%m%d-%H%M%S)

test "$PWD" = "$app"
test "$(readlink -f "$app")" = "$app"
test -f "$stage/apps/api/dist/intelligence/active-planner-audio.service.js"
test -f "$stage/apps/web/.next/BUILD_ID"

paths=(
  apps/api/src/ai/ai-provider.service.ts
  apps/api/src/intelligence/active-planner-audio.service.ts
  apps/api/src/intelligence/active-planner-audio.service.spec.ts
  apps/api/src/intelligence/active-planner.controller.ts
  apps/api/src/intelligence/intelligence.module.ts
  apps/api/dist/ai/ai-provider.service.js
  apps/api/dist/ai/ai-provider.service.js.map
  apps/api/dist/intelligence/active-planner-audio.service.js
  apps/api/dist/intelligence/active-planner-audio.service.js.map
  apps/api/dist/intelligence/active-planner.controller.js
  apps/api/dist/intelligence/active-planner.controller.js.map
  apps/api/dist/intelligence/intelligence.module.js
  apps/api/dist/intelligence/intelligence.module.js.map
  apps/web/lib/api-client.ts
  apps/web/src/app/dashboard/active-planner/page.tsx
  scripts/qa/active-planner-audio-acceptance.cjs
  scripts/qa/deploy-active-planner-audio-test.sh
)

mkdir -p "$backup"
existing=()
for path in "${paths[@]}"; do
  if [ -e "$path" ]; then
    existing+=("$path")
    printf '%s\n' "$path" >>"$backup/preexisting.txt"
  fi
done
tar -czf "$backup/files-before.tar.gz" "${existing[@]}"

for path in "${paths[@]}"; do
  mkdir -p "$(dirname "$path")"
  cp "$stage/$path" "$path"
done

mv apps/web/.next "$backup/web-next"
mv "$stage/apps/web/.next" apps/web/.next
pm2 restart sak-api-test sak-web-test

verified=false
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  api_code="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:4001/api/v1/active-planner/audio/languages || true)"
  web_code="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/dashboard/active-planner || true)"
  if [[ "$api_code" =~ ^(401|403)$ ]] && [ "$web_code" = 200 ]; then
    verified=true
    break
  fi
  sleep 2
done

if [ "$verified" != true ]; then
  rm -rf -- "$app/apps/web/.next"
  mv "$backup/web-next" "$app/apps/web/.next"
  for path in "${paths[@]}"; do rm -f -- "$app/$path"; done
  tar -xzf "$backup/files-before.tar.gz" -C "$app"
  pm2 restart sak-api-test sak-web-test
  echo 'Active Planner audio deployment failed; prior Mizantra runtime restored.' >&2
  exit 1
fi

pm2 save
echo "Mizantra TEST multilingual audio deployed and verified. Backup: $backup"
