#!/usr/bin/env bash
set -euo pipefail

test "${1:-}" != ""
test "$(pwd -P)" = "/var/www/sak-erp-test"

# The test environment file is CRLF-formatted on the VPS. Load it without
# printing credentials, then execute exactly the supplied SQL migration.
eval "$(tr -d '\r' < apps/api/.env)"
test -n "${DATABASE_URL:-}"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$1"
