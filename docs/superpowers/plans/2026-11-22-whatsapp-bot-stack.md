# WhatsApp AI Bot Stack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `docker compose up -d` brings up Evolution API + Flowise + PostgreSQL + Redis behind nginx, so a WhatsApp message gets an AI reply.

**Architecture:** One compose file, one internal network `backend`. Only nginx publishes a port (`127.0.0.1:80`) and routes by subdomain (`evolution.localhost`, `flowise.localhost`). Evolution calls Flowise directly at `http://flowise:3000`. One Postgres with two isolated databases.

**Tech Stack:** Docker Compose 2.40, `evoapicloud/evolution-api:v2.3.7`, `flowiseai/flowise:3.1.4`, `postgres:17.12-alpine`, `redis:8.8.4-alpine`, `nginx:1.30.7-alpine`. Tests are bash scripts (`set -euo pipefail`, `curl`, `docker compose`), no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-22-whatsapp-bot-stack-design.md`

## Global Constraints

- Image tags exact as listed above; never `latest` or a major-only tag.
- Only `nginx` has `ports:`, and exactly `127.0.0.1:80:80`.
- Secrets only in `.env` (git-ignored); `.env.example` committed with placeholder values `change-me`.
- `DATABASE_SAVE_DATA_NEW_MESSAGE=false` in Evolution.
- Evolution `LOG_LEVEL=ERROR,WARN,INFO`.
- Code, file names, commit messages in English; Conventional Commits; commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Fresh clone, `.env` missing** → `docker compose up` must fail loudly, not start with empty passwords. Use `${VAR:?missing VAR}` for every secret (tested in Task 1).
2. **Postgres init runs only on an empty volume** → README must say how to reset (`docker compose down -v`), and the DB isolation test must pass on first boot (Task 2).
3. **Flowise login over plain HTTP** → Flowise 3 secure cookies break login on `http://`; set `SECURE_COOKIES=false` while local (verified in Task 3 smoke: login page loads, manual login in Task 4).
4. **Flowise streaming responses through nginx** → `proxy_buffering off` plus WebSocket upgrade headers on the flowise server block, or the chat UI hangs (Task 3).
5. **Evolution `SERVER_URL` mismatch** → QR/media URLs point to the wrong host; must be `http://evolution.localhost` (Task 3 smoke checks the root response).

---

### Task 1: Compose skeleton, secrets hygiene, static checks

**Files:**
- Create: `.gitignore`, `.env.example`, `docker-compose.yml`, `tests/static.sh`

**Interfaces:**
- Produces: service names `nginx`, `evolution-api`, `flowise`, `postgres`, `redis`; network `backend`; volumes `postgres_data`, `redis_data`, `evolution_instances`, `flowise_data`.
- Produces `.env` keys: `POSTGRES_PASSWORD`, `EVOLUTION_DB_PASSWORD`, `FLOWISE_DB_PASSWORD`, `EVOLUTION_API_KEY`, `FLOWISE_SECRETKEY_OVERWRITE`, `FLOWISE_JWT_AUTH_TOKEN_SECRET`, `FLOWISE_JWT_REFRESH_TOKEN_SECRET`, `FLOWISE_EXPRESS_SESSION_SECRET`, `FLOWISE_TOKEN_HASH_SECRET`.

- [ ] **Step 1: Write `tests/static.sh`** asserting:
  - `docker compose config -q` exits 0 (with `.env.example` copied to a temp `--env-file`).
  - `docker compose --env-file /dev/null config` exits non-zero (missing secrets fail).
  - every `image:` matches `:[v]?[0-9]+\.[0-9]+\.[0-9]+` (no `latest`).
  - `docker compose config --format json | jq` shows `ports` only on `nginx`, equal to host_ip `127.0.0.1`, published `80`. (Use `python3 -c` instead of `jq` if `jq` is absent.)
  - `git check-ignore -q .env` succeeds.
  - `.env.example` contains no value other than `change-me` for secret keys.
- [ ] **Step 2: Run `bash tests/static.sh`** → FAIL (no compose file).
- [ ] **Step 3: Write `.gitignore`** (`.env`), **`.env.example`**, **`docker-compose.yml`**:
  - `postgres`: healthcheck `pg_isready -U postgres`; volume `postgres_data`; mounts `./postgres/init` (created in Task 2) to `/docker-entrypoint-initdb.d:ro`.
  - `redis`: `redis-server --appendonly yes`; healthcheck `redis-cli ping`; volume `redis_data`.
  - `evolution-api`: `depends_on` postgres+redis `service_healthy`; env `SERVER_URL=http://evolution.localhost`, `AUTHENTICATION_API_KEY`, `DATABASE_PROVIDER=postgresql`, `DATABASE_CONNECTION_URI=postgresql://evolution:${EVOLUTION_DB_PASSWORD}@postgres:5432/evolution?schema=public`, `DATABASE_SAVE_DATA_NEW_MESSAGE=false`, `CACHE_REDIS_ENABLED=true`, `CACHE_REDIS_URI=redis://redis:6379/1`, `CACHE_LOCAL_ENABLED=false`, `FLOWISE_ENABLED=true`, `LOG_LEVEL=ERROR,WARN,INFO`; volume `evolution_instances:/evolution/instances`.
  - `flowise`: `depends_on` postgres healthy; env `DATABASE_TYPE=postgres`, host/port/name `flowise`/user `flowise`/password, `FLOWISE_SECRETKEY_OVERWRITE`, JWT/session/token secrets, `APP_URL=http://flowise.localhost`, `SECURE_COOKIES=false`; volume `flowise_data:/root/.flowise`. Verify env names against the Flowise 3.1.4 docs/`packages/server/.env.example` before writing.
  - `nginx`: `ports: ["127.0.0.1:80:80"]`, mounts `./nginx/nginx.conf` (Task 3).
  - all services `restart: unless-stopped`, network `backend`.
- [ ] **Step 4: Run `bash tests/static.sh`** → PASS.
- [ ] **Step 5: Commit** `feat: add docker compose stack with secret checks`.

### Task 2: Postgres with two isolated databases

**Files:**
- Create: `postgres/init/01-create-databases.sh`, `tests/db-isolation.sh`

**Interfaces:**
- Consumes: `postgres` service, `.env` keys from Task 1.
- Produces: DBs `evolution` (owner `evolution`) and `flowise` (owner `flowise`).

- [ ] **Step 1: Write `tests/db-isolation.sh`** (stack up with `docker compose up -d postgres`):
  - `evolution` user can `SELECT 1` on db `evolution`.
  - `flowise` user can `SELECT 1` on db `flowise`.
  - `evolution` user connecting to db `flowise` fails, and vice versa.
  - Run `psql` via `docker compose exec -T -e PGPASSWORD=... postgres psql -h 127.0.0.1 ...` (force TCP so password auth applies).
- [ ] **Step 2: Run on a fresh volume** (`docker compose down -v && docker compose up -d postgres`, wait healthy) → FAIL.
- [ ] **Step 3: Write `01-create-databases.sh`**: `CREATE ROLE ... LOGIN PASSWORD`, `CREATE DATABASE ... OWNER`, `REVOKE CONNECT ON DATABASE <db> FROM PUBLIC` for both; passwords passed as env to the `postgres` service (`EVOLUTION_DB_PASSWORD`, `FLOWISE_DB_PASSWORD`). Use `psql -v ON_ERROR_STOP=1` and `:'var'` quoting, not string interpolation.
- [ ] **Step 4: `docker compose down -v`, up postgres, run test** → PASS.
- [ ] **Step 5: Commit** `feat: create isolated evolution and flowise databases`.

### Task 3: nginx reverse proxy and runtime smoke test

**Files:**
- Create: `nginx/nginx.conf`, `tests/smoke.sh`

**Interfaces:**
- Consumes: all services from Task 1.

- [ ] **Step 1: Write `tests/smoke.sh`** (full stack up, poll up to 120 s):
  - all 5 containers `running`, postgres/redis `healthy`.
  - `curl -s -o /dev/null -w '%{http_code}' -H 'Host: evolution.localhost' http://127.0.0.1/instance/fetchInstances` → `401`; with `apikey: $EVOLUTION_API_KEY` → `200`.
  - `curl -H 'Host: flowise.localhost' http://127.0.0.1/` → `200`.
  - response headers include `X-Content-Type-Options: nosniff`, `X-Frame-Options`, `Referrer-Policy`; `Server` header has no version.
  - unknown host (`Host: foo.localhost`) → `444` or connection closed (default server drops it).
  - `nc -z 127.0.0.1 5432` and `6379` fail (DB ports not exposed).
- [ ] **Step 2: Run `bash tests/smoke.sh`** → FAIL.
- [ ] **Step 3: Write `nginx/nginx.conf`**: `server_tokens off`; `limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s` applied with `burst=20 nodelay` on both hosts; default server `return 444`; security headers above with `always`; `client_max_body_size 50m`; flowise block: `proxy_http_version 1.1`, `Upgrade`/`Connection` headers, `proxy_buffering off`, `proxy_read_timeout 300s`; both blocks forward `Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`. Upstreams `evolution-api:8080`, `flowise:3000`.
- [ ] **Step 4: Run `bash tests/smoke.sh`** → PASS. Also `docker compose logs evolution-api | grep -i error` shows nothing unexpected.
- [ ] **Step 5: Commit** `feat: add nginx reverse proxy with security headers`.

### Task 4: README and end-to-end manual check

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Write README** (Spanish, user-facing): requirements; `cp .env.example .env` + generating each secret with `openssl rand -hex 32`; `docker compose up -d`; running `tests/*.sh`; creating the instance and getting the QR (`curl` examples with `apikey`); creating the Flowise chatflow (chat model + Buffer Memory) and its API key; registering the bot via `POST /flowise/create/{instance}` with `apiUrl=http://flowise:3000/api/v1/prediction/<chatflowId>`, `triggerType: all`, `ignoreJids: ["@g.us"]`; reset with `docker compose down -v` (warning: deletes data); dedicated-number warning; note that message history is not stored in Evolution.
- [ ] **Step 2: Manual E2E** (human): scan QR, send message from another phone, receive AI reply; send in a group → no reply. Record result in the PR description.
- [ ] **Step 3: Run `gitleaks detect` (if installed) and `bash tests/static.sh`** → clean.
- [ ] **Step 4: Commit** `docs: add setup and bot configuration guide`.
