#!/usr/bin/env bash
set -euo pipefail

app=/var/www/sak-erp-test
stage=/tmp/mizantra-active-planner-semantic-router
backup=/root/sak-deploy-backups/mizantra-active-planner-semantic-router-$(date +%Y%m%d-%H%M%S)

[[ "$PWD" == "$app" ]]
[[ "$(readlink -f "$app")" == "$app" ]]
[[ -f "$stage/active-planner.service.ts" ]]
[[ -f "$stage/active-planner.service.js" ]]

mkdir -p "$backup/src" "$backup/dist"
cp -a apps/api/src/intelligence/active-planner.service.ts "$backup/src/"
cp -a apps/api/dist/intelligence/active-planner.service.js* "$backup/dist/"

rollback() {
  echo "Semantic router deployment failed; restoring Mizantra API." >&2
  cp -a "$backup/src/active-planner.service.ts" apps/api/src/intelligence/
  cp -a "$backup/dist/active-planner.service.js"* apps/api/dist/intelligence/
  pm2 restart sak-api-test >/dev/null || true
}
trap rollback ERR

cp -a "$stage/active-planner.service.ts" apps/api/src/intelligence/
cp -a "$stage/active-planner.service.js" apps/api/dist/intelligence/
if [[ -f "$stage/active-planner.service.js.map" ]]; then
  cp -a "$stage/active-planner.service.js.map" apps/api/dist/intelligence/
fi

pm2 restart sak-api-test >/dev/null
for attempt in {1..20}; do
  sleep 2
  status="$(pm2 jlist | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const p=JSON.parse(s).find(x=>x.name==='sak-api-test');process.stdout.write(p?.pm2_env?.status||'missing')})")"
  http="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:4001/api/v1/active-planner/conversations || true)"
  if [[ "$status" == online && "$http" =~ ^(401|403)$ ]]; then
    trap - ERR
    printf '{"deployed":true,"target":"mizantra-test-api","status":"%s","auth_guard_http":%s,"backup":"%s"}\n' "$status" "$http" "$backup"
    exit 0
  fi
done
false
