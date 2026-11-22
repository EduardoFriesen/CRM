#!/usr/bin/env bash
# Needs: docker compose up -d postgres (healthy) and .env with DB passwords.
set -uo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
fail=0
# psql over TCP so password auth applies. Args: user password db
q() { docker compose exec -T -e PGPASSWORD="$2" postgres psql -h 127.0.0.1 -U "$1" -d "$3" -tAc "SELECT 1"; }
ok()   { if q "$@" >/dev/null 2>&1; then echo "ok   $1 -> $3"; else echo "FAIL $1 -> $3 should connect"; fail=1; fi; }
deny() { if q "$@" >/dev/null 2>&1; then echo "FAIL $1 -> $3 should be denied"; fail=1; else echo "ok   $1 -x $3 denied"; fi; }

ok   evolution "$EVOLUTION_DB_PASSWORD" evolution
ok   flowise   "$FLOWISE_DB_PASSWORD"   flowise
deny evolution "$EVOLUTION_DB_PASSWORD" flowise
deny flowise   "$FLOWISE_DB_PASSWORD"   evolution
exit $fail
