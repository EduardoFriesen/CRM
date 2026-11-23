#!/usr/bin/env bash
set -euo pipefail

psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
  -v evo_pw="$EVOLUTION_DB_PASSWORD" <<'SQL'
CREATE ROLE evolution LOGIN PASSWORD :'evo_pw';
CREATE DATABASE evolution OWNER evolution;
REVOKE CONNECT ON DATABASE evolution FROM PUBLIC;
SQL
