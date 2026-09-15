#!/usr/bin/env bash
set -euo pipefail
app=/var/www/sak-erp-test
stage=/tmp/mizantra-sales-atp-reservation-20260830
backup=/root/sak-deploy-backups/mizantra-sales-atp-reservation-$(date +%Y%m%d-%H%M%S)
test "$PWD" = "$app"
test "$(readlink -f "$app")" = "$app"
test -f "$stage/apps/api/dist/sales/services/sales.service.js"
paths=(apps/api/src/sales/services/sales.service.ts apps/api/src/sales/services/sales.service.spec.ts apps/api/dist/sales/services/sales.service.js apps/api/dist/sales/services/sales.service.js.map migrations/add-sales-atp-reservation-control.sql scripts/qa/apply-sales-atp-reservation-test.cjs scripts/qa/deploy-sales-atp-reservation-test.sh)
mkdir -p "$backup"
existing=()
for path in "${paths[@]}"; do if [ -e "$path" ]; then existing+=("$path"); fi; done
tar -czf "$backup/files-before.tar.gz" "${existing[@]}"
for path in "${paths[@]}"; do mkdir -p "$(dirname "$path")"; cp "$stage/$path" "$path"; done
pm2 restart sak-api-test
pm2 save
for _ in 1 2 3 4 5 6 7 8 9 10; do
  code="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:4001/api/v1/sales/orders || true)"
  if [[ "$code" =~ ^(401|403)$ ]]; then echo "Mizantra TEST sales ATP reservation deployed. Backup: $backup"; exit 0; fi
  sleep 2
done
tar -xzf "$backup/files-before.tar.gz" -C "$app"
pm2 restart sak-api-test
echo 'Sales ATP deployment failed; previous Mizantra test API restored.' >&2
exit 1
