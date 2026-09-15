#!/usr/bin/env bash
set -Eeuo pipefail

app=/var/www/sak-erp-test
archive=/tmp/mizantra-production-copilot-20260909.tgz
stage="$(mktemp -d /tmp/mizantra-production-copilot.XXXXXX)"
backup="$app/backups/production-copilot-$(date +%Y%m%d-%H%M%S)"
files=(
  apps/api/src/intelligence/active-planner.capabilities.ts
  apps/api/src/intelligence/active-planner.service.ts
  apps/api/src/intelligence/active-planner.service.spec.ts
  apps/api/dist/intelligence/active-planner.capabilities.js
  apps/api/dist/intelligence/active-planner.capabilities.js.map
  apps/api/dist/intelligence/active-planner.service.js
  apps/api/dist/intelligence/active-planner.service.js.map
  apps/web/src/app/dashboard/active-planner/page.tsx
  scripts/qa/deploy-production-copilot-mizantra.sh
)

[[ "$PWD" == "$app" ]]
[[ "$(readlink -f "$app")" == "$app" ]]
[[ -s "$archive" ]]
[[ -f apps/api/.env ]]
grep -q 'db.nwkaruzvzwwuftjquypk.supabase.co' apps/api/.env

tar -xzf "$archive" -C "$stage"
for file in "${files[@]}"; do [[ -f "$stage/$file" ]]; done
[[ -f "$stage/apps/web/.next/BUILD_ID" ]]
grep -q 'FACTORY_READINESS' "$stage/apps/api/dist/intelligence/active-planner.service.js"
grep -q 'SUBMIT_MRP_RELEASE_PACKETS' "$stage/apps/api/dist/intelligence/active-planner.service.js"
grep -q 'CREATE_WIP_PREDECESSOR_OVERRIDE' "$stage/apps/api/dist/intelligence/active-planner.service.js"

mkdir -p "$backup/files"
for file in "${files[@]}"; do
  if [[ -f "$file" ]]; then
    mkdir -p "$backup/files/$(dirname "$file")"
    cp -a "$file" "$backup/files/$file"
  fi
done
tar -czf "$backup/web-next.tgz" -C apps/web .next

rollback() {
  code=$?
  trap - ERR
  for file in "${files[@]}"; do
    if [[ -f "$backup/files/$file" ]]; then
      cp -a "$backup/files/$file" "$file"
    fi
  done
  rm -rf -- "$app/apps/web/.next"
  tar -xzf "$backup/web-next.tgz" -C "$app/apps/web"
  pm2 restart sak-api-test sak-web-test --update-env >/dev/null 2>&1 || true
  echo "Production-copilot deployment failed; Mizantra runtime restored from $backup" >&2
  exit "$code"
}
trap rollback ERR

for file in "${files[@]}"; do
  mkdir -p "$(dirname "$file")"
  cp -a "$stage/$file" "$file"
done
rm -rf -- "$app/apps/web/.next"
cp -a "$stage/apps/web/.next" "$app/apps/web/.next"

pm2 restart sak-api-test sak-web-test --update-env >/dev/null
pm2 save >/dev/null

api_code=000
web_code=000
for _ in $(seq 1 40); do
  api_code="$(curl -sS -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{}' http://127.0.0.1:4001/api/v1/active-planner/capabilities || true)"
  web_code="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/dashboard/active-planner || true)"
  if [[ "$api_code" =~ ^(401|403)$ && "$web_code" == 200 ]]; then break; fi
  sleep 2
done

[[ "$api_code" =~ ^(401|403)$ ]]
[[ "$web_code" == 200 ]]
pm2 describe sak-api-test | grep -q online
pm2 describe sak-web-test | grep -q online
grep -q 'FACTORY_READINESS' apps/api/dist/intelligence/active-planner.service.js
grep -q 'Prepare the approved MRP recommendations for release' apps/web/src/app/dashboard/active-planner/page.tsx

trap - ERR
rm -rf -- "$stage"
rm -f -- "$archive"
printf '{"deployed":true,"target":"mizantra-only","api_http":%s,"web_http":%s,"backup":"%s"}\n' "$api_code" "$web_code" "$backup"
