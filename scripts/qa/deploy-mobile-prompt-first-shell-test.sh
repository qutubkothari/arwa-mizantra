#!/usr/bin/env bash
set -euo pipefail

app=/var/www/sak-erp-test
stage=/tmp/mizantra-mobile-prompt-first-shell-20260830
backup=/root/sak-deploy-backups/mizantra-mobile-prompt-first-shell-$(date +%Y%m%d-%H%M%S)

test "$PWD" = "$app"
test "$(readlink -f "$app")" = "$app"
test -f "$stage/apps/web/.next/BUILD_ID"

paths=(
  apps/web/src/components/Sidebar.tsx
  apps/web/src/components/DashboardReminders.tsx
  apps/web/src/app/dashboard/active-planner/page.tsx
  apps/web/src/app/dashboard/command-center/actions/page.tsx
  apps/web/src/app/dashboard/hr/page.tsx
  scripts/qa/deploy-mobile-prompt-first-shell-test.sh
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

mv apps/web/.next "$backup/web-next"
mv "$stage/apps/web/.next" apps/web/.next
pm2 restart sak-web-test

verified=false
for _ in 1 2 3 4 5 6 7 8 9 10; do
  planner_code="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/dashboard/active-planner || true)"
  work_code="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/dashboard/command-center/actions || true)"
  attendance_code="$(curl -sS -o /dev/null -w '%{http_code}' 'http://127.0.0.1:3001/dashboard/hr/employees?tab=attendance' || true)"
  if [ "$planner_code" = 200 ] && [ "$work_code" = 200 ] && [ "$attendance_code" = 200 ]; then
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
  echo 'Prompt-first mobile shell deployment failed; previous Mizantra test runtime restored.' >&2
  exit 1
fi

pm2 save
echo "Mizantra TEST prompt-first mobile shell deployed and verified. Backup: $backup"
