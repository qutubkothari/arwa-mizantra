#!/usr/bin/env bash
set -Eeuo pipefail

app=/var/www/sak-erp-test
stage=/tmp/mizantra-query-tab-sync
backup="$app/backups/query-tab-sync-$(date +%Y%m%d-%H%M%S)"
pages=(sales quality service settings)

[[ "$PWD" == "$app" ]]
[[ "$(readlink -f "$app")" == "$app" ]]
for page in "${pages[@]}"; do
  [[ -f "$stage/$page-page.tsx" ]]
done

mkdir -p "$backup/src"
for page in "${pages[@]}"; do
  cp -a "apps/web/src/app/dashboard/$page/page.tsx" "$backup/src/$page-page.tsx"
done
tar -czf "$backup/web-next.tgz" -C apps/web .next

rollback() {
  local code=$?
  if (( code != 0 )); then
    echo "Query-tab deployment failed; restoring Mizantra web." >&2
    for page in "${pages[@]}"; do
      cp -a "$backup/src/$page-page.tsx" "apps/web/src/app/dashboard/$page/page.tsx"
    done
    rm -rf -- apps/web/.next
    tar -xzf "$backup/web-next.tgz" -C apps/web
    pm2 restart sak-web-test --update-env >/dev/null || true
  fi
  exit "$code"
}
trap rollback EXIT

for page in "${pages[@]}"; do
  cp -a "$stage/$page-page.tsx" "apps/web/src/app/dashboard/$page/page.tsx"
done

pnpm --filter @sak-erp/web build
pm2 restart sak-web-test --update-env >/dev/null

for attempt in {1..30}; do
  sleep 2
  status="$(pm2 jlist | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const p=JSON.parse(s).find(x=>x.name==='sak-web-test');process.stdout.write(p?.pm2_env?.status||'missing')})")"
  sales="$(curl -sS -o /dev/null -w '%{http_code}' 'http://127.0.0.1:3001/dashboard/sales?tab=customers' || true)"
  quality="$(curl -sS -o /dev/null -w '%{http_code}' 'http://127.0.0.1:3001/dashboard/quality?tab=ncr' || true)"
  service="$(curl -sS -o /dev/null -w '%{http_code}' 'http://127.0.0.1:3001/dashboard/service?tab=contracts' || true)"
  settings="$(curl -sS -o /dev/null -w '%{http_code}' 'http://127.0.0.1:3001/dashboard/settings?tab=roles' || true)"
  if [[ "$status" == online && "$sales" == 200 && "$quality" == 200 && "$service" == 200 && "$settings" == 200 ]]; then
    trap - EXIT
    printf '{"deployed":true,"target":"mizantra-test-web","status":"%s","sales":%s,"quality":%s,"service":%s,"settings":%s,"backup":"%s"}\n' "$status" "$sales" "$quality" "$service" "$settings" "$backup"
    exit 0
  fi
done
false
