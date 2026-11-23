#!/usr/bin/env bash
# Creates the crm database (owner: crm, used for migrations) and the crm_app
# login role (runtime, no ownership so RLS applies). Idempotent: also run it by
# hand on an existing volume:
#   docker compose exec -T postgres bash /docker-entrypoint-initdb.d/02-create-crm-db.sh
set -euo pipefail

psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-postgres}" -d postgres \
  -v crm_pw="$CRM_DB_PASSWORD" -v app_pw="$CRM_APP_DB_PASSWORD" <<'SQL'
SELECT 'CREATE ROLE crm LOGIN' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm') \gexec
SELECT 'CREATE ROLE crm_app LOGIN' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app') \gexec
ALTER ROLE crm PASSWORD :'crm_pw';
ALTER ROLE crm_app PASSWORD :'app_pw';
SELECT 'CREATE DATABASE crm OWNER crm' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'crm') \gexec
REVOKE CONNECT ON DATABASE crm FROM PUBLIC;
GRANT CONNECT ON DATABASE crm TO crm_app;
SQL
