#!/usr/bin/env bash
set -euo pipefail

app=/var/www/sak-erp-test
web=/var/www/sak-erp-test/apps/web/.next
archive=/tmp/smart-production-web-test.tar.gz

test "$PWD" = "$app"
test "$(readlink -f "$web")" = "$web"
test -f "$archive"

pm2 stop sak-web-test
rm -rf -- "$web"
tar -xzf "$archive" -C /var/www/sak-erp-test/apps/web
pm2 restart sak-web-test
pm2 save
rm -f -- "$archive"

for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS http://127.0.0.1:3001/dashboard/production/smart-planning >/dev/null; then
    echo 'Mizantra TEST web verified.'
    exit 0
  fi
  sleep 2
done

exit 1
