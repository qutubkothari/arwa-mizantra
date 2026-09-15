#!/usr/bin/env bash
set -euo pipefail

app=/var/www/sak-erp-test
stage=/tmp/mizantra-active-planner-manual-siv-20260830
backup=/root/sak-deploy-backups/mizantra-active-planner-manual-siv-$(date +%Y%m%d-%H%M%S)

test "$PWD" = "$app"
test "$(readlink -f "$app")" = "$app"
test -f "$stage/apps/api/dist/intelligence/active-planner.service.js"

paths=(
  apps/api/src/intelligence/active-planner.capabilities.ts
  apps/api/src/intelligence/active-planner.service.ts
  apps/api/src/intelligence/governed-action.service.ts
  apps/api/src/intelligence/governed-tool-registry.service.ts
  apps/api/dist/intelligence/active-planner.capabilities.js
  apps/api/dist/intelligence/active-planner.capabilities.js.map
  apps/api/dist/intelligence/active-planner.service.js
  apps/api/dist/intelligence/active-planner.service.js.map
  apps/api/dist/intelligence/governed-action.service.js
  apps/api/dist/intelligence/governed-action.service.js.map
  apps/api/dist/intelligence/governed-tool-registry.service.js
  apps/api/dist/intelligence/governed-tool-registry.service.js.map
  scripts/qa/deploy-active-planner-manual-siv-test.sh
  scripts/qa/active-planner-manual-siv-preview.cjs
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

pm2 restart sak-api-test
verified=false
for _ in 1 2 3 4 5 6 7 8 9 10; do
  code="$(curl -sS -X POST -H 'content-type: application/json' -d '{}' -o /dev/null -w '%{http_code}' http://127.0.0.1:4001/api/v1/active-planner/capabilities || true)"
  if [[ "$code" =~ ^(401|403)$ ]]; then verified=true; break; fi
  sleep 2
done

if [ "$verified" != true ]; then
  tar -xzf "$backup/files-before.tar.gz" -C "$app"
  pm2 restart sak-api-test
  echo 'Governed manual SIV deployment failed; previous Mizantra test API restored.' >&2
  exit 1
fi

pm2 save
echo "Mizantra TEST governed manual SIV prompt deployed and verified. Backup: $backup"
