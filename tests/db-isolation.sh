#!/usr/bin/env bash
# Needs: docker compose up -d postgres (healthy) and .env with DB passwords.
set -uo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
fail=0
# Connect via the container's network IP: the image's pg_hba trusts 127.0.0.1,
# so loopback would skip password checks. Other containers hit the scram rule.
host=$(docker compose exec -T postgres hostname -i | awk '{print $1}')
# Args: user password db. Prints stderr so deny cases can inspect it.
q() { docker compose exec -T -e PGPASSWORD="$2" postgres psql -h "$host" -U "$1" -d "$3" -tAc "SELECT 1" 2>&1; }
ok()   { if q "$@" >/dev/null; then echo "ok   $1 -> $3"; else echo "FAIL $1 -> $3 should connect"; fail=1; fi; }
deny() { # extra pattern must appear in the error so a deny can't pass vacuously
  local pat=$1; shift; local out
  if out=$(q "$@"); then echo "FAIL $1 -> $3 should be denied"; fail=1
  elif grep -q "$pat" <<<"$out"; then echo "ok   $1 -x $3 denied ($pat)"
  else echo "FAIL $1 -> $3 denied for wrong reason: $out"; fail=1; fi; }

[ -n "$host" ] || { echo "FAIL no container IP"; exit 1; }
ok   evolution "$EVOLUTION_DB_PASSWORD" evolution
ok   crm       "$CRM_DB_PASSWORD"       crm
ok   crm_app   "$CRM_APP_DB_PASSWORD"   crm
deny "permission denied" crm_app   "$CRM_APP_DB_PASSWORD"   evolution
deny "permission denied" evolution "$EVOLUTION_DB_PASSWORD" crm
deny "password authentication failed" evolution wrong-password evolution
exit $fail
