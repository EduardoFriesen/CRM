# CRM Entrega 1 (Base SaaS + tablero de clientes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** App `crm` multi-negocio, sin login, donde el superadmin da de alta negocios, cada negocio conecta su WhatsApp por QR y ve a sus clientes en un tablero de tres etapas. La tarjeta abre `wa.me`.

**Architecture:** Servicio Next.js nuevo en el compose, con base `crm` en el Postgres existente. Las migraciones corren con el rol dueño `crm` en un servicio de un solo uso (`crm-migrate`) y la app usa el rol `crm_app`, sin privilegios de dueño, con RLS por `app.tenant_id`. Evolution manda los mensajes por webhook interno (`http://crm:3000`, no publicado en nginx), autenticado con un secreto por instancia en un header.

**Tech Stack:** Node 24, Next.js (última estable, App Router, `output: "standalone"`), TypeScript estricto, Drizzle ORM + drizzle-kit + `postgres` (postgres.js), Zod, Vitest, Playwright, ESLint (`eslint-config-next`).

**Spec:** `docs/superpowers/specs/2026-11-23-crm-platform-design.md`

## Global Constraints

- Versiones exactas en `package.json` (sin `^`/`~`) y en las imágenes Docker (sin `latest`), verificadas al implementar.
- TypeScript `strict: true` y sin `any`.
- Contrato de API: `{ success: true, data }` / `{ success: false, error: { code, message } }`. Los errores al cliente no llevan detalles internos.
- Zod en toda entrada externa: webhook, formularios y server actions.
- **Nunca loguear** el texto de los mensajes, los números de teléfono ni el payload del webhook. El payload de Evolution trae el campo `apikey` de la instancia.
- La app solo se publica en `127.0.0.1`. El README advierte, en negrita, que no hay login.
- Etapas: exactamente `consulta | venta | postventa`; un contacto nuevo arranca en `consulta`.
- Idioma de la UI: español rioplatense. Código y commits en inglés, Conventional Commits, con el trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Rama: `feat/crm-platform`.

## Review Focus

1. **Webhook repetido** (Evolution reintenta): el mismo `key.id` no duplica el mensaje → test en Task 6.
2. **Secreto ausente o incorrecto, o instancia inexistente**: 401 sin escribir nada y sin revelar si la instancia existe → test en Task 6.
3. **Grupos, `status@broadcast` y newsletters**: se ignoran (200 sin escribir) → test en Task 6.
4. **JID `@lid` sin `remoteJidAlt`**: el contacto se guarda con `phone = null` y la tarjeta no es un link, sino un texto "Sin número visible" → tests en Task 6 y Task 7.
5. **Cambiar la etapa de un contacto de otro negocio** (id de B usado desde `/t/A`): no actualiza nada → test en Task 7.

---

## File Structure

```
postgres/init/02-create-crm-db.sh   roles crm/crm_app + base crm (idempotente; también se corre a mano)
docker-compose.yml                  + servicios crm-migrate y crm, env de postgres
docker-compose.dev.yml              publica postgres en 127.0.0.1:55432 SOLO para desarrollo/tests
nginx/nginx.conf                    + server crm.localhost
.env.example                        + CRM_DB_PASSWORD, CRM_APP_DB_PASSWORD
tests/static.sh, tests/smoke.sh, tests/db-isolation.sh   chequeos extendidos
crm/
  Dockerfile, .dockerignore, package.json, tsconfig.json, next.config.ts,
  eslint.config.mjs, vitest.config.ts, playwright.config.ts, drizzle.config.ts
  migrate.mjs                       aplica drizzle/ con el rol dueño
  drizzle/                          migraciones generadas + 0001_rls.sql (custom)
  src/db/schema.ts                  tablas
  src/db/client.ts                  db (crm_app) + withTenant
  src/tenants/tenants.ts            createTenant, listTenants, getTenantBySlug, getCurrentTenant
  src/whatsapp/jid.ts               phoneFromJid, isIgnoredJid
  src/whatsapp/secret.ts            newWebhookSecret, hashSecret, verifySecret
  src/whatsapp/evolution.ts         cliente HTTP de Evolution
  src/whatsapp/webhook.ts           parseo + handleEvolutionEvent
  src/contacts/contacts.ts          listBoard, setContactStage
  src/contacts/wa-link.ts           waLink
  src/app/                          páginas, route handler del webhook, server actions
  src/test/db.ts                    helpers de integración (ownerSql, cleanup)
  e2e/board.spec.ts
```

Los tests unitarios van junto al archivo (`*.test.ts`). Los de integración (`*.int.test.ts`) necesitan `CRM_TEST_OWNER_URL` y `CRM_TEST_APP_URL`, que apuntan a `127.0.0.1:55432` con `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres`.

---

### Task 1: Base `crm` y roles en Postgres

**Files:**
- Create: `postgres/init/02-create-crm-db.sh`, `docker-compose.dev.yml`
- Modify: `docker-compose.yml` (env de `postgres`), `.env.example`, `tests/db-isolation.sh`

**Interfaces:**
- Produces: la base `crm` cuyo dueño es el rol `crm` (`CRM_DB_PASSWORD`, migraciones) y el rol `crm_app` (`CRM_APP_DB_PASSWORD`, solo `CONNECT`). Postgres queda en `127.0.0.1:55432` con el override dev.

- [ ] **Step 1: Extender `tests/db-isolation.sh`** con: `ok crm … crm`, `ok crm_app … crm`, `deny "permission denied" crm_app … evolution`, `deny "permission denied" evolution … crm`.
- [ ] **Step 2: Correr** `docker compose up -d postgres && bash tests/db-isolation.sh`. Esperado: FAIL en las líneas de crm (el rol no existe).
- [ ] **Step 3: Escribir `02-create-crm-db.sh`.** Es idempotente: crea los roles con `DO $$ … IF NOT EXISTS … $$`, crea la base con `SELECT 'CREATE DATABASE crm OWNER crm' WHERE NOT EXISTS (…) \gexec`, hace `REVOKE CONNECT ON DATABASE crm FROM PUBLIC` y `GRANT CONNECT ON DATABASE crm TO crm_app`, y en un volumen existente aplica `ALTER ROLE … PASSWORD` con lo que haya en el env. Las claves pasan por `psql -v`, igual que en `01-create-databases.sh`. Agregar `CRM_DB_PASSWORD` y `CRM_APP_DB_PASSWORD` (con `:?missing`) al env de `postgres` y `change-me` a `.env.example`. Crear `docker-compose.dev.yml`, que solo agrega `ports: ["127.0.0.1:55432:5432"]` a `postgres`.
- [ ] **Step 4: Aplicar al volumen existente y verificar.** `docker compose up -d postgres && docker compose exec -T postgres bash /docker-entrypoint-initdb.d/02-create-crm-db.sh && bash tests/db-isolation.sh && bash tests/static.sh`. Esperado: todo `ok`. Correr el script dos veces no da error.
- [ ] **Step 5: Commit** `feat: add crm database and least-privilege roles`

### Task 2: App `crm` servida por nginx

**Files:**
- Create: `crm/` (scaffold de Next.js con TS estricto, ESLint y Vitest), `crm/Dockerfile`, `crm/.dockerignore`, `crm/migrate.mjs`, `crm/src/app/api/health/route.ts`
- Modify: `docker-compose.yml`, `nginx/nginx.conf`, `tests/static.sh`, `tests/smoke.sh`

**Interfaces:**
- Produces: la imagen `crm` con dos comandos, `node migrate.mjs` (usa `DATABASE_OWNER_URL` y aplica `./drizzle`) y `node server.js`. El env de runtime del servicio `crm` es `DATABASE_URL` (crm_app), `EVOLUTION_URL=http://evolution-api:8080`, `EVOLUTION_API_KEY` y `CRM_INTERNAL_URL=http://crm:3000`. `GET /api/health` → `{ success: true, data: { ok: true } }`. Scripts npm: `dev`, `build`, `lint` (`eslint .`), `typecheck` (`tsc --noEmit`), `test` (`vitest run`), `test:e2e` (`playwright test`), `db:generate` (`drizzle-kit generate`).

- [ ] **Step 1: Agregar los chequeos que fallan.**
  - En `static.sh`: el servicio `crm` no publica puertos (el chequeo existente ya lo cubre); `crm-migrate` tiene `restart: "no"`; `crm` depende de `crm-migrate` con `service_completed_successfully`; `DATABASE_OWNER_URL` solo existe en `crm-migrate`.
  - En `smoke.sh`: `crm` running; `Host: crm.localhost` `/api/health` → 200; `/api/webhooks/evolution/x` vía nginx → 404; las respuestas traen `Content-Security-Policy` con `frame-ancestors 'none'`.
- [ ] **Step 2: Correr** `bash tests/static.sh`. Esperado: FAIL en los chequeos de crm.
- [ ] **Step 3: Implementar.**
  - Scaffold con `create-next-app` (TS, App Router, `src/`, ESLint, sin Tailwind salvo que lo pida la dirección visual de la Task 7). Fijar versiones exactas y `tsconfig` con `strict`.
  - `Dockerfile` multi-stage sobre `node:24.x.y-alpine` fijo, con usuario no root. Copia `.next/standalone`, `.next/static`, `drizzle/` y `migrate.mjs`.
  - `migrate.mjs` usa `migrate` de `drizzle-orm/postgres-js/migrator`.
  - En el compose: los servicios `crm-migrate` (misma imagen, `restart: "no"`, depende de que postgres esté healthy) y `crm`. Ninguno publica puertos.
  - En nginx: `upstream crm { server crm:3000; }` y un `server crm.localhost` con las mismas cabeceras que evolution, más `Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"`, `location /api/webhooks/ { return 404; }` y `location / { limit_req zone=web burst=200 nodelay; proxy_pass … }`, con los mismos headers de proxy. Agregar `crm` a `depends_on` de nginx.
  - `npm audit --audit-level=high` sin hallazgos.
- [ ] **Step 4: Verificar** `bash tests/static.sh && bash tests/smoke.sh`. Esperado: todo `ok`.
- [ ] **Step 5: Commit** `feat: add crm app service behind nginx`

### Task 3: Esquema, RLS y `withTenant`

**Files:**
- Create: `crm/src/db/schema.ts`, `crm/src/db/client.ts`, `crm/drizzle.config.ts`, `crm/drizzle/*` (generadas), `crm/drizzle/0001_rls.sql` (vía `drizzle-kit generate --custom`), `crm/src/test/db.ts`, `crm/src/db/rls.int.test.ts`

**Interfaces:**
- Produces:
  - Tablas (`uuid` con `defaultRandom()`, `timestamptz`):
    - `tenants(id, slug unique, name, admin_phone, created_at)`
    - `whatsapp_instances(id, tenant_id → tenants cascade unique, name unique, status text default 'close', secret_hash text)`
    - `contacts(id, tenant_id → tenants cascade, jid, phone null, name null, stage pgEnum('stage',['consulta','venta','postventa']) default 'consulta', last_message_at, created_at)`, unique `(tenant_id, jid)`
    - `messages(id, tenant_id, contact_id → contacts cascade, direction pgEnum('direction',['in','out']), body text, wa_message_id text, sent_at)`, unique `(tenant_id, wa_message_id)`
  - `db` (postgres.js con `DATABASE_URL`) y `withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T>`, que abre una transacción y hace `select set_config('app.tenant_id', $1, true)`. En `0001_rls.sql`:
    - `ENABLE` + `FORCE ROW LEVEL SECURITY` en `whatsapp_instances`, `contacts` y `messages`, con la política `tenant_isolation`: `USING/WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)`.
    - `tenants` sin RLS: `crm_app` solo tiene `SELECT, INSERT`.
    - `GRANT SELECT, INSERT, UPDATE` a `crm_app` en las tres tablas con RLS.
    - La función `resolve_instance(p_name text) RETURNS TABLE(tenant_id uuid, secret_hash text)` con `SECURITY DEFINER`, `SET search_path = public` y `EXECUTE` solo para `crm_app`. El webhook la usa antes de conocer el negocio.
  - `src/test/db.ts`: `ownerSql` (con `CRM_TEST_OWNER_URL`), `makeTenant(): Promise<{ id: string; slug: string }>` y `dropTenants()` en `afterAll`.

- [ ] **Step 1: Escribir `rls.int.test.ts`.** Crea los negocios A y B con un contacto cada uno. Casos:
  - `withTenant(A, tx => tx.select().from(contacts))` devuelve solo el de A;
  - sin `withTenant`, `db.select().from(contacts)` devuelve `[]`;
  - insertar un contacto con `tenant_id = B` dentro de `withTenant(A)` lanza un error de política RLS;
  - `db.execute(sql\`select * from resolve_instance(${nameA})\`)` devuelve el `tenant_id` de A;
  - `delete from contacts` con `crm_app` lanza `permission denied`.
- [ ] **Step 2: Correr** `npx vitest run src/db/rls.int.test.ts`. Esperado: FAIL (no existe el schema).
- [ ] **Step 3: Implementar** el schema, `db:generate`, la migración custom y `client.ts`. Aplicar con `DATABASE_OWNER_URL=$CRM_TEST_OWNER_URL node migrate.mjs`.
- [ ] **Step 4: Correr** los tests. Esperado: PASS.
- [ ] **Step 5: Commit** `sec: add crm schema with tenant row-level security`

### Task 4: Negocios y `getCurrentTenant`

**Files:**
- Create: `crm/src/tenants/tenants.ts`, `crm/src/tenants/tenants.int.test.ts`, `crm/src/app/page.tsx` (listado + alta), `crm/src/app/actions.ts`, `crm/src/app/t/[slug]/layout.tsx`

**Interfaces:**
- Produces:
  - `tenantInput = z.object({ slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/), name: z.string().trim().min(2).max(80), adminPhone: z.string().regex(/^\d{10,15}$/) })`
  - `createTenant(input: unknown): Promise<Result<Tenant>>`. Si el slug ya existe devuelve `error.code = 'SLUG_TAKEN'`; si el input es inválido, `'VALIDATION'`.
  - `listTenants(): Promise<Tenant[]>`
  - `getTenantBySlug(slug: string): Promise<Tenant | null>`
  - `getCurrentTenant(slug: string): Promise<Tenant>`, que llama a `notFound()` si no existe. Lleva el comentario `// Keycloak: replace with OIDC claim + membership check` y es **el único** lugar donde se resuelve el negocio desde la request.
  - `Result<T>` sigue el contrato de API; va en `src/lib/result.ts`.

- [ ] **Step 1: Escribir los tests.**
  - `createTenant({slug:'Mi Negocio',…})` → `VALIDATION`;
  - un slug válido → `success`, y repetirlo → `SLUG_TAKEN`;
  - `getCurrentTenant('no-existe')` lanza el error de `notFound` (mockear `next/navigation`).
- [ ] **Step 2: Correr y ver el FAIL.**
- [ ] **Step 3: Implementar** las funciones, la página `/` (tabla de negocios con links a `/t/<slug>` y un formulario de alta con server action, mostrando los errores por campo) y el layout `/t/[slug]` (llama a `getCurrentTenant` y muestra la navegación Clientes · WhatsApp).
- [ ] **Step 4: Correr los tests.** Esperado: PASS.
- [ ] **Step 5: Commit** `feat: add tenant registry and current tenant resolution`

### Task 5: Conectar WhatsApp

**Files:**
- Create: `crm/src/whatsapp/secret.ts` (+ `.test.ts`), `crm/src/whatsapp/evolution.ts` (+ `.test.ts`), `crm/src/app/t/[slug]/whatsapp/page.tsx`, `crm/src/app/t/[slug]/whatsapp/actions.ts`

**Interfaces:**
- Consumes: `withTenant` y `whatsapp_instances` (Task 3); `getCurrentTenant` (Task 4).
- Produces:
  - `newWebhookSecret(): string` (32 bytes, base64url); `hashSecret(s: string): string` (sha256 hex); `verifySecret(s: string, hash: string): boolean` (con `timingSafeEqual`).
  - `evolution.createInstance(name: string, secret: string): Promise<void>` hace `POST /instance/create` con `{ instanceName: name, integration: 'WHATSAPP-BAILEYS', qrcode: true, groupsIgnore: true, webhook: { enabled: true, url: \`${CRM_INTERNAL_URL}/api/webhooks/evolution/${name}\`, byEvents: false, base64: false, headers: { 'x-crm-webhook-secret': secret }, events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'] } }` y el header `apikey`.
  - `evolution.connect(name): Promise<{ qrBase64: string | null }>` (`GET /instance/connect/{name}`).
  - `evolution.connectionState(name): Promise<'open' | 'close' | 'connecting'>` (`GET /instance/connectionState/{name}`).
  - Los nombres de instancia son el slug del negocio. *Verificado en el código de 2.3.7: `webhook.headers` se manda como headers HTTP (`webhook.controller.ts`). No se usa `QRCODE_UPDATED`: la página consulta `connect`.*

- [ ] **Step 1: Escribir los tests.**
  - `verifySecret(s, hashSecret(s))` → true; con otro secreto → false; con un hash de largo distinto → false, sin lanzar error.
  - Con `fetch` stubbeado (`vi.stubGlobal`), `createInstance('pepe', 's3')` llama a `${EVOLUTION_URL}/instance/create` con el header `apikey` y un body que incluye `webhook.headers['x-crm-webhook-secret'] === 's3'` y `webhook.url` terminado en `/api/webhooks/evolution/pepe`.
  - Una respuesta no-2xx lanza `EvolutionError` sin incluir el body en el mensaje.
- [ ] **Step 2: Correr y ver el FAIL.**
- [ ] **Step 3: Implementar.** La server action `connectWhatsApp(slug)`:
  - si no existe la fila de la instancia, genera el secreto, guarda el hash con `withTenant` y llama a `createInstance`;
  - devuelve `connect(slug)`.

  La página muestra el estado. Si no está `open`, muestra el QR (`<img src="data:…">` con `alt` descriptivo) y un client component que refresca el estado cada 3 s hasta `open`. Contempla los estados loading, error (Evolution caída: "No pudimos hablar con WhatsApp, reintentá") y conectado.
- [ ] **Step 4: Correr los tests.** Esperado: PASS. Después, manual: conectar un número de prueba desde `/t/<slug>/whatsapp`.
- [ ] **Step 5: Commit** `feat: connect tenant whatsapp instance with per-instance webhook secret`

### Task 6: Webhook de Evolution

**Files:**
- Create: `crm/src/whatsapp/jid.ts` (+ `.test.ts`), `crm/src/whatsapp/webhook.ts`, `crm/src/whatsapp/webhook.int.test.ts`, `crm/src/app/api/webhooks/evolution/[instance]/route.ts`

**Interfaces:**
- Consumes: `resolve_instance`, `withTenant` (Task 3); `verifySecret` (Task 5).
- Produces:
  - `isIgnoredJid(jid: string): boolean`: true para `@g.us`, `@broadcast` y `@newsletter`.
  - `phoneFromJid(jid: string, alt?: string): string | null`: los dígitos de un `@s.whatsapp.net`. Si `jid` es `@lid`, usa `alt` cuando es `@s.whatsapp.net`; si no, devuelve `null`.
  - `handleEvolutionEvent(instance: string, secret: string | null, body: unknown): Promise<{ status: 200 | 400 | 401 }>`.
    - `MESSAGES_UPSERT`: hace upsert del contacto por `(tenant_id, jid)`. Actualiza `name` solo si `!fromMe` y viene `pushName`; `phone` solo si no es null. Inserta el mensaje con `onConflictDoNothing` sobre `(tenant_id, wa_message_id)`, con `direction = fromMe ? 'out' : 'in'`, y actualiza `last_message_at`.
    - El texto sale de `message.conversation ?? message.extendedTextMessage?.text ?? message.imageMessage?.caption ?? \`[${messageType}]\``.
    - `CONNECTION_UPDATE`: actualiza `whatsapp_instances.status` con `data.state`.
    - Cualquier otro evento → 200 sin escribir nada.
  - El route handler lee el header `x-crm-webhook-secret` y responde `{ success: … }` sin detalles. No loguea el body.

- [ ] **Step 1: Escribir los tests.**
  - Unitarios de `jid.ts`: `phoneFromJid('5491122334455@s.whatsapp.net')` → `'5491122334455'`; `phoneFromJid('123@lid')` → `null`; `phoneFromJid('123@lid', '5491122334455@s.whatsapp.net')` → `'5491122334455'`; `isIgnoredJid('1203@g.us')` → true.
  - Integración, con un negocio y una instancia sembrados:
    - un upsert válido crea un contacto en `consulta` con su mensaje `in`;
    - el **mismo payload dos veces** deja 1 mensaje;
    - un secreto incorrecto → 401, y con instancia inexistente también 401, sin escribir;
    - un body inválido (sin `data.key`) → 400;
    - un JID `@g.us` → 200 sin contacto;
    - `@lid` sin alt → contacto con `phone = null`;
    - `fromMe` con `pushName` no pisa el nombre del contacto;
    - `CONNECTION_UPDATE` `{state:'open'}` → `status = 'open'`.
- [ ] **Step 2: Correr y ver el FAIL.**
- [ ] **Step 3: Implementar** con un esquema Zod `passthrough` para el payload (solo los campos usados).
- [ ] **Step 4: Correr los tests.** Esperado: PASS. Después, manual: escribir desde otro teléfono y verificar la fila en `messages`.
- [ ] **Step 5: Commit** `feat: ingest evolution webhook messages into tenant contacts`

### Task 7: Tablero de clientes

**Files:**
- Create: `crm/src/contacts/wa-link.ts` (+ `.test.ts`), `crm/src/contacts/contacts.ts`, `crm/src/contacts/contacts.int.test.ts`, `crm/src/app/t/[slug]/page.tsx`, `crm/src/app/t/[slug]/loading.tsx`, `crm/src/app/t/[slug]/error.tsx`, `crm/src/app/t/[slug]/board.tsx`, `crm/src/app/t/[slug]/actions.ts`, `crm/playwright.config.ts`, `crm/e2e/board.spec.ts`

**Interfaces:**
- Consumes: `withTenant`, `contacts` (Task 3); `getCurrentTenant` (Task 4).
- Produces:
  - `waLink(phone: string | null): string | null`, que devuelve `https://wa.me/${phone}` o `null`.
  - `listBoard(tenantId: string): Promise<Record<Stage, BoardContact[]>>`, ordenado por `last_message_at desc`, donde `BoardContact = { id, name, phone, lastMessageAt, lastMessage: string | null }`. El último mensaje se recorta a 80 caracteres.
  - `setContactStage(tenantId: string, contactId: string, stage: unknown): Promise<Result<{ id: string; stage: Stage }>>`. Valida con Zod y devuelve `NOT_FOUND` si RLS no deja ver la fila.

- [ ] **Step 1: Dirección visual.** Invocar `ui-ux-pro-max` una sola vez para la paleta, la tipografía y el estilo del panel. Guardar los tokens en `src/app/globals.css`. No se regeneran en tareas siguientes.
- [ ] **Step 2: Escribir los tests.**
  - `waLink('5491122334455')` → `'https://wa.me/5491122334455'`; `waLink(null)` → `null`.
  - Integración: `listBoard` agrupa por etapa y no incluye contactos de otro negocio. `setContactStage(A, contactoDeB, 'venta')` → `NOT_FOUND` y B no cambia. `setContactStage(A, c, 'cerrado')` → `VALIDATION`.
  - E2E (`board.spec.ts`), sembrando con `ownerSql` un negocio con un contacto con teléfono y otro `@lid` sin teléfono:
    - en `/t/<slug>` las tres columnas tienen heading con el nombre y la cantidad;
    - la tarjeta con teléfono es un `<a>` con `href="https://wa.me/5491122334455"`, `target="_blank"` y `rel="noopener noreferrer"`;
    - la tarjeta sin teléfono no es un link y muestra "Sin número visible";
    - cambiar el `<select>` de etapa a "venta" mueve la tarjeta a esa columna;
    - con un negocio sin contactos se ve el estado vacío ("Todavía no te escribió nadie…" + link a conectar WhatsApp);
    - todo es navegable con Tab.
- [ ] **Step 3: Correr y ver el FAIL.**
- [ ] **Step 4: Implementar.**
  - Página server que llama a `listBoard`.
  - `board.tsx` (client): tres columnas como `<section aria-labelledby>`, tarjeta como `<article>` con el link a `wa.me` envolviendo nombre, teléfono y último mensaje. El `<select>` de etapa va **fuera** del link, con su `<label>` y la server action. Refresca con `router.refresh()` cada 15 s.
  - `loading.tsx`: skeleton de tres columnas. `error.tsx`: mensaje sin detalles y botón "Reintentar".
  - Construir y pulir con `impeccable`.
- [ ] **Step 5: Correr** `npm test && npm run test:e2e`. Esperado: PASS.
- [ ] **Step 6: Commit** `feat: add customer board by conversation stage`

### Task 8: Documentación y cierre

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README.** Agregar una sección CRM:
  - URL `http://crm.localhost:8080`;
  - el aviso en **negrita** de que no hay login y que no se debe exponer hasta Keycloak;
  - cómo crear la base en un volumen existente (`docker compose exec -T postgres bash /docker-entrypoint-initdb.d/02-create-crm-db.sh`);
  - dev y tests con `docker-compose.dev.yml` y las variables `CRM_TEST_*`;
  - mientras dure la entrega 1, cada instancia nueva necesita registrar el bot de Flowise a mano (`POST /flowise/create/<slug>`, sección 3).
- [ ] **Step 2: Verificación final.** En `crm/`: `npm run lint && npm run typecheck && npm test && npm run test:e2e && npm audit --audit-level=high`. En la raíz: `bash tests/static.sh && bash tests/smoke.sh && bash tests/db-isolation.sh && gitleaks detect`. Esperado: todo en verde, sin hallazgos.
- [ ] **Step 3: Manual end to end.** Crear un negocio, conectar el número por QR, escribir desde otro teléfono, ver la tarjeta en "consulta", abrir `wa.me` y moverla a "venta".
- [ ] **Step 4: Commit** `docs: document crm setup and no-auth warning`
