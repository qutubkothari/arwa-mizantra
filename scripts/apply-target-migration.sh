#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$#" -ne 2 ]]; then
  echo "usage: $0 <live|test> <migration.sql>" >&2
  exit 64
fi

target="$1"
migration="$2"

case "$target" in
  live)
    host=72.62.192.228
    ssh_user=qutubk
    app=/var/www/sak-erp
    api_process=sak-api
    web_process=sak-web
    api_port=4000
    web_port=3000
    public_url=https://erp.saifseas.com
    ;;
  test)
    host=200.141.1.206
    ssh_user=root
    app=/var/www/sak-erp-test
    api_process=sak-api-test
    web_process=sak-web-test
    api_port=4001
    web_port=3001
    public_url=https://mizantra.saksolution.com
    ;;
  *)
    echo "deployment blocked: target must be exactly live or test" >&2
    exit 64
    ;;
esac

[[ "$(pwd -P)" == "$app" ]]
[[ -f "$migration" ]]

node scripts/assert-deployment-target.cjs \
  --target "$target" \
  --host "$host" \
  --ssh-user "$ssh_user" \
  --app-root "$app" \
  --api-process "$api_process" \
  --web-process "$web_process" \
  --api-port "$api_port" \
  --web-port "$web_port" \
  --public-url "$public_url"

database_url="$(tr -d '\r' < apps/api/.env | sed -n 's/^DATABASE_URL=//p' | head -n 1 | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")"
[[ -n "$database_url" ]]

echo "Applying migration to target=$target only."
psql "$database_url" -X -v ON_ERROR_STOP=1 -1 -f "$migration"
