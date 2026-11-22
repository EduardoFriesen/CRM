#!/usr/bin/env bash
set -euo pipefail

psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
  -v evo_pw="$EVOLUTION_DB_PASSWORD" -v flow_pw="$FLOWISE_DB_PASSWORD" <<'SQL'
CREATE ROLE evolution LOGIN PASSWORD :'evo_pw';
CREATE ROLE flowise LOGIN PASSWORD :'flow_pw';
CREATE DATABASE evolution OWNER evolution;
CREATE DATABASE flowise OWNER flowise;
REVOKE CONNECT ON DATABASE evolution FROM PUBLIC;
REVOKE CONNECT ON DATABASE flowise FROM PUBLIC;
SQL
