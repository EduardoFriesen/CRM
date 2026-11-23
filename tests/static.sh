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
check "ports only on nginx = 127.0.0.1:HTTP_PORT->80" bash -c '
  docker compose --env-file "$1" config --format json | jq -e "
   [.services|to_entries[]|select(.value.ports)|{k:.key,p:.value.ports}] as \$s
   | (\$s|length)==1 and \$s[0].k==\"nginx\" and (\$s[0].p|length)==1
     and \$s[0].p[0].host_ip==\"127.0.0.1\" and (\$s[0].p[0].target|tostring)==\"80\""' _ "$tmp/env"
check ".env is git-ignored" git check-ignore -q .env
check ".env.example secrets are change-me" bash -c '
  s=$(grep -E "^[A-Z_]*(PASSWORD|KEY|SECRET)[A-Z_]*=" .env.example); [ -n "$s" ] && ! echo "$s" | grep -qvE "=change-me$"'
check "evolution history/telemetry env forced to false" bash -c '
  docker compose --env-file "$1" config --format json | jq -e "
   .services[\"evolution-api\"].environment
   | .DATABASE_SAVE_DATA_HISTORIC==\"false\" and .DATABASE_SAVE_MESSAGE_UPDATE==\"false\" and .TELEMETRY_ENABLED==\"false\""' _ "$tmp/env"
check "no FLOWISE_ vars left" bash -c '! grep -q FLOWISE_ .env.example docker-compose.yml'
check "crm-migrate runs once and crm waits for it" bash -c '
  docker compose --env-file "$1" config --format json | jq -e "
   .services[\"crm-migrate\"].restart==\"no\"
   and .services.crm.depends_on[\"crm-migrate\"].condition==\"service_completed_successfully\""' _ "$tmp/env"
check "owner db url only in crm-migrate" bash -c '
  docker compose --env-file "$1" config --format json | jq -e "
   [.services|to_entries[]|select(.value.environment.DATABASE_OWNER_URL)|.key]==[\"crm-migrate\"]"' _ "$tmp/env"
check "nginx starts without waiting for app upstreams" bash -c '
  docker compose --env-file "$1" config --format json | jq -e "(.services.nginx.depends_on // {}) | has(\"crm\") or has(\"evolution-api\") | not"' _ "$tmp/env"
check "crm-worker: no ports, owner url absent, encryption key and redis db 2" bash -c '
  docker compose --env-file "$1" config --format json | jq -e "
   .services[\"crm-worker\"] as \$w
   | (\$w.ports // [] | length)==0
   and (\$w.environment.DATABASE_OWNER_URL == null)
   and (\$w.environment.CRM_ENCRYPTION_KEY | length > 0)
   and (\$w.environment.REDIS_URL | endswith(\"/2\"))
   and \$w.depends_on[\"crm-migrate\"].condition==\"service_completed_successfully\"
   and \$w.depends_on.redis.condition==\"service_healthy\""' _ "$tmp/env"
check "crm app has redis db 2 and the encryption key" bash -c '
  docker compose --env-file "$1" config --format json | jq -e "
   .services.crm.environment | (.REDIS_URL | endswith(\"/2\")) and (.CRM_ENCRYPTION_KEY | length > 0)"' _ "$tmp/env"
check "OLLAMA_URL only in the dev override" bash -c '
  ! grep -q OLLAMA_URL .env.example docker-compose.yml &&
  docker compose --env-file "$1" config --format json | jq -e "[.services[]] | all((.environment // {}).OLLAMA_URL == null)" &&
  docker compose --env-file "$1" -f docker-compose.yml -f docker-compose.dev.yml config --format json |
    jq -e "[.services.crm, .services[\"crm-worker\"]] | all(.environment.OLLAMA_URL | startswith(\"http://10.0.2.2:\"))"' _ "$tmp/env"
exit $fail
