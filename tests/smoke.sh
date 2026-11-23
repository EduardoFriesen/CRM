#!/usr/bin/env bash
# Runtime smoke test: brings the full stack up and checks the proxy. Leaves it running.
set -uo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
B="http://127.0.0.1:${HTTP_PORT:-8080}"
fail=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1 ($2)"; fail=1; }
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$@"; }
# poll <desc> <timeout_s> <cmd...>
poll() { local d=$1 t=$2; shift 2; local e=$((SECONDS+t)); until "$@" >/dev/null 2>&1; do [ $SECONDS -ge $e ] && { bad "$d" timeout; return 1; }; sleep 3; done; ok "$d"; }

docker compose up -d >/dev/null 2>&1 || { echo "FAIL compose up"; exit 1; }

for s in nginx evolution-api crm postgres redis; do
  poll "$s running" 60 bash -c "[ \"\$(docker compose ps --format '{{.State}}' $s)\" = running ]"
done
for s in postgres redis; do
  poll "$s healthy" 60 bash -c "docker compose ps --format '{{.Health}}' $s | grep -q healthy"
done

poll "evolution 401 without apikey" 180 bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: evolution.localhost' $B/instance/fetchInstances)\" = 401 ]"
c=$(code -H 'Host: evolution.localhost' -H "apikey: $EVOLUTION_API_KEY" $B/instance/fetchInstances)
[ "$c" = 200 ] && ok "evolution 200 with apikey" || bad "evolution 200 with apikey" "$c"

h=$(curl -si --max-time 5 -H 'Host: evolution.localhost' $B/)
for k in X-Content-Type-Options:\ nosniff X-Frame-Options Referrer-Policy; do
  echo "$h" | grep -qi "^$k" && ok "header $k" || bad "header $k" missing
done
echo "$h" | grep -i '^server:' | grep -qE '[0-9]' && bad "Server header has no version" "$(echo "$h" | grep -i '^server:')" || ok "Server header has no version"

c=$(code -H 'Host: flowise.localhost' $B/)
{ [ "$c" = 444 ] || [ "$c" = 000 ]; } && ok "flowise host gone ($c)" || bad "flowise host gone" "$c"

poll "crm health 200" 120 bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: crm.localhost' $B/api/health)\" = 200 ]"
c=$(code -X POST -H 'Host: crm.localhost' $B/api/webhooks/evolution/x)
[ "$c" = 404 ] && ok "crm webhook not public" || bad "crm webhook not public" "$c"
curl -si --max-time 5 -H 'Host: crm.localhost' $B/api/health | grep -i '^content-security-policy:' | grep -q "frame-ancestors 'none'" \
  && ok "crm CSP frame-ancestors none" || bad "crm CSP frame-ancestors none" missing

c=$(code -H 'Host: foo.localhost' $B/)
{ [ "$c" = 444 ] || [ "$c" = 000 ]; } && ok "unknown host dropped ($c)" || bad "unknown host dropped" "$c"

for p in 5432 6379; do
  nc -z 127.0.0.1 $p 2>/dev/null && bad "port $p closed" open || ok "port $p closed"
done
exit $fail
