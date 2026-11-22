#!/usr/bin/env bash
# Static checks for the compose stack. No containers are started.
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0
check() { if "${@:2}" >/dev/null 2>&1; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi; }

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
cp .env.example "$tmp/env"

check "compose config valid with .env.example" docker compose --env-file "$tmp/env" config -q
check "compose config fails without secrets" bash -c '! docker compose --env-file /dev/null config -q'
check "images pinned (no latest)" bash -c '
  imgs=$(grep -E "^\s+image:" docker-compose.yml); [ -n "$imgs" ] &&
  ! echo "$imgs" | grep -qvE ":v?[0-9]+\.[0-9]+(\.[0-9]+)?(-|$)"'
check "ports only on nginx = 127.0.0.1:80" bash -c '
  docker compose --env-file "$1" config --format json | jq -e "
   [.services|to_entries[]|select(.value.ports)|{k:.key,p:.value.ports}] as \$s
   | (\$s|length)==1 and \$s[0].k==\"nginx\" and (\$s[0].p|length)==1
     and \$s[0].p[0].host_ip==\"127.0.0.1\" and (\$s[0].p[0].published|tostring)==\"80\""' _ "$tmp/env"
check ".env is git-ignored" git check-ignore -q .env
check ".env.example secrets are change-me" bash -c '
  s=$(grep -E "^[A-Z_]*(PASSWORD|KEY|SECRET)[A-Z_]*=" .env.example); [ -n "$s" ] && ! echo "$s" | grep -qvE "=change-me$"'
exit $fail
