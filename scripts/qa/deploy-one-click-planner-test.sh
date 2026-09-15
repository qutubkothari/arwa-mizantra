#!/usr/bin/env bash
set -euo pipefail

app=/var/www/sak-erp-test
stage=/tmp/mizantra-one-click-planner-20260830
backup=/root/sak-deploy-backups/mizantra-one-click-planner-$(date +%Y%m%d-%H%M%S)

test "$PWD" = "$app"
test "$(readlink -f "$app")" = "$app"
test -f "$stage/apps/web/.next/BUILD_ID"
test -f "$stage/apps/web/src/components/Sidebar.tsx"

mkdir -p "$backup"
tar -czf "$backup/files-before.tar.gz" \
  apps/web/src/components/Sidebar.tsx \
  scripts/qa/deploy-one-click-planner-test.sh 2>/dev/null || \
  tar -czf "$backup/files-before.tar.gz" apps/web/src/components/Sidebar.tsx

cp "$stage/apps/web/src/components/Sidebar.tsx" apps/web/src/components/Sidebar.tsx
cp "$stage/scripts/qa/deploy-one-click-planner-test.sh" scripts/qa/deploy-one-click-planner-test.sh
mv apps/web/.next "$backup/web-next"
mv "$stage/apps/web/.next" apps/web/.next
pm2 restart sak-web-test

verified=false
for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
  dashboard_code="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/dashboard || true)"
  planner_code="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/dashboard/active-planner || true)"
  if [ "$dashboard_code" = 200 ] && [ "$planner_code" = 200 ]; then
    verified=true
    break
  fi
  sleep 2
done

if [ "$verified" != true ]; then
  rm -rf -- "$app/apps/web/.next"
  mv "$backup/web-next" "$app/apps/web/.next"
  tar -xzf "$backup/files-before.tar.gz" -C "$app"
  pm2 restart sak-web-test
  echo 'One-click planner deployment failed; prior Mizantra web runtime restored.' >&2
  exit 1
fi

pm2 save
echo "Mizantra TEST one-click planner shortcut deployed. Backup: $backup"
