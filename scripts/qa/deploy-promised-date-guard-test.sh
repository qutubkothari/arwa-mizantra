#!/usr/bin/env bash
set -euo pipefail

app=/var/www/sak-erp-test
stage=/tmp/mizantra-promised-date-guard-20260830
backup=/root/sak-deploy-backups/mizantra-promised-date-guard-$(date +%Y%m%d-%H%M%S)

test "$PWD" = "$app"
test "$(readlink -f "$app")" = "$app"
test -f "$stage/apps/api/dist/common/pipes/no-future-dates.pipe.js"

paths=(
  apps/api/src/common/pipes/no-future-dates.pipe.ts
  apps/api/src/common/pipes/no-future-dates.pipe.spec.ts
  apps/api/dist/common/pipes/no-future-dates.pipe.js
  apps/api/dist/common/pipes/no-future-dates.pipe.js.map
  apps/api/dist/common/pipes/no-future-dates.pipe.d.ts
  scripts/qa/seed-mizantra-demo-golden.cjs
  scripts/qa/deploy-promised-date-guard-test.sh
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
  code="$(curl -sS -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{"username":"__health__","password":"__health__"}' http://127.0.0.1:4001/api/v1/auth/login || true)"
  if [ "$code" = 401 ]; then
    verified=true
    break
  fi
  sleep 2
done

if [ "$verified" != true ]; then
  tar -xzf "$backup/files-before.tar.gz" -C "$app"
  pm2 restart sak-api-test
  echo 'Promised-date guard deployment failed; prior Mizantra API files restored.' >&2
  exit 1
fi

pm2 save
echo "Mizantra promised-date guard deployed and verified. Backup: $backup"
