#!/usr/bin/env bash
set -euo pipefail

app=/var/www/sak-erp-test
stage=/tmp/mizantra-active-planner-durable-context
backup=/root/sak-deploy-backups/mizantra-active-planner-durable-context-$(date +%Y%m%d-%H%M%S)

[[ "$PWD" == "$app" ]]
[[ "$(readlink -f "$app")" == "$app" ]]
for name in active-planner.service active-planner-memory.service; do
  [[ -f "$stage/src/$name.ts" ]]
  [[ -f "$stage/dist/$name.js" ]]
done

mkdir -p "$backup/src" "$backup/dist"
for name in active-planner.service active-planner-memory.service; do
  cp -a "apps/api/src/intelligence/$name.ts" "$backup/src/"
  cp -a "apps/api/dist/intelligence/$name.js"* "$backup/dist/"
done

rollback() {
  echo "Active Planner intelligence deployment failed; restoring Mizantra API." >&2
  cp -a "$backup/src/"*.ts apps/api/src/intelligence/
  cp -a "$backup/dist/"*.js* apps/api/dist/intelligence/
  pm2 restart sak-api-test >/dev/null || true
}
trap rollback ERR

for name in active-planner.service active-planner-memory.service; do
  cp -a "$stage/src/$name.ts" apps/api/src/intelligence/
  cp -a "$stage/dist/$name.js" apps/api/dist/intelligence/
  [[ ! -f "$stage/dist/$name.js.map" ]] || cp -a "$stage/dist/$name.js.map" apps/api/dist/intelligence/
done

pm2 restart sak-api-test >/dev/null
for attempt in {1..25}; do
  sleep 2
  status="$(pm2 jlist | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const p=JSON.parse(s).find(x=>x.name==='sak-api-test');process.stdout.write(p?.pm2_env?.status||'missing')})")"
  auth_http="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:4001/api/v1/active-planner/conversations || true)"
  if [[ "$status" == online && "$auth_http" =~ ^(401|403)$ ]]; then
    trap - ERR
    printf '{"deployed":true,"target":"mizantra-test-api","status":"%s","auth_guard_http":%s,"backup":"%s"}\n' "$status" "$auth_http" "$backup"
    exit 0
  fi
done

false
