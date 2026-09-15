#!/usr/bin/env bash
set -euo pipefail

app=/var/www/sak-erp-test
api=/var/www/sak-erp-test/apps/api/dist
archive=/tmp/smart-production-api-test.tar.gz

test "$PWD" = "$app"
test "$(readlink -f "$api")" = "$api"
test -f "$archive"

pm2 stop sak-api-test
rm -rf -- "$api"
tar -xzf "$archive" -C /var/www/sak-erp-test/apps/api
pm2 restart sak-api-test
pm2 save
rm -f -- "$archive"

for _ in 1 2 3 4 5 6 7 8 9 10; do
  code="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:4001/api/v1/production-planning/dashboard || true)"
  if [[ "$code" =~ ^(401|403)$ ]]; then
    echo 'Mizantra TEST API verified.'
    exit 0
  fi
  sleep 2
done

exit 1
