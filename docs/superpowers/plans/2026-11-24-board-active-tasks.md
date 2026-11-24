# Tablero como panel de tareas actuales — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sacar del tablero lo terminado ("Cerrar venta", "×" y Consultas inactivas), reabrir como conversación nueva cuando el cliente vuelve a escribir, y que un traspaso anterior en el historial no impida el siguiente.

**Architecture:** Columnas nuevas en `contacts` (`closed_at`, `reopened_at`, `reached_venta_at`), `messages.handoff` y `tenants.consulta_idle_days`. El tablero filtra en SQL (sin jobs). Un helper puro arma el historial del modelo y reconstruye los traspasos como llamada a herramienta.

**Tech Stack:** Next.js 16 (server actions), Drizzle + Postgres con RLS, Vercel AI SDK v6, Vitest (integración contra Postgres de `docker-compose.dev.yml`), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-24-close-sale-design.md`

## Global Constraints

- Código, nombres y commits en inglés; textos de UI en español rioplatense.
- Resultados con `ok`/`fail` de `@/lib/result`; errores al cliente sin detalles internos.
- Toda entrada de server action validada con Zod en el servidor; el tenant sale de `getCurrentTenant(slug)`.
- Mínimo privilegio: `crm_app` recibe solo `GRANT UPDATE (<columna>)` de las columnas que escribe.
- `consulta_idle_days`: entero 1–30, por defecto 1.
- Copy fijo: botón "Cerrar venta"; "×" con `aria-label="Quitar a <nombre> del tablero"`; pestaña "Configuración"; campo "Quitar consultas sin actividad después de N días".
- Comandos (desde `crm/`): tests `npx vitest run <archivo>`, todo `npm test`, `npm run lint`, `npm run typecheck`, E2E `npx playwright test <archivo>`. Requiere `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d` en la raíz.

## Review Focus

1. Un mensaje del número del negocio (`fromMe`) sobre un cliente cerrado no lo reabre → test en Task 2.
2. Un cliente en **Venta** sin actividad hace días que escribe no se "reabre" ni pierde la etapa (solo Consulta caduca) → test en Task 2.
3. Subir N vuelve a mostrar Consultas que estaban ocultas (es un filtro, no un cierre) → test en Task 1.
4. El relay corre sin herramientas: su historial no lleva partes `tool-call` aunque haya un traspaso previo → test en Task 4.
5. Doble clic en "Cerrar venta": la segunda llamada devuelve `NOT_CLOSABLE` y la UI no rompe → test en Task 1.

---

### Task 1: Migración + cerrar contacto + filtros del tablero

**Files:**
- Modify: `crm/src/db/schema.ts` (contacts, messages, tenants)
- Create: `crm/drizzle/0018_board_active_tasks.sql` (generada), `crm/drizzle/0019_board_active_tasks_grants.sql` (custom)
- Modify: `crm/src/contacts/contacts.ts`
- Test: `crm/src/contacts/contacts.int.test.ts`

**Interfaces:**
- Produces: columnas `contacts.closedAt`, `contacts.reopenedAt`, `contacts.reachedVentaAt` (timestamptz null), `messages.handoff` (boolean not null default false), `tenants.consultaIdleDays` (smallint not null default 1, check `between 1 and 30`).
- Produces: `closeContact(tenantId: string, contactId: string): Promise<Result<{ id: string }>>` — errores `NOT_FOUND` (id inválido/ajeno) y `NOT_CLOSABLE` (Venta o ya cerrado).

- [ ] **Step 1: Tests que fallan** en `contacts.int.test.ts`:
  - `describe("closeContact")`:
    - `"closes a postventa contact and hides it from the board"`: contacto en postventa → `closeContact` devuelve `{ success: true, data: { id } }`; `listBoard(t.id).postventa` no lo incluye; `closed_at` no es null en la base.
    - `"closes a consulta contact"`: ídem para consulta.
    - `"refuses a venta contact with NOT_CLOSABLE"` y queda `closed_at` null.
    - `"returns NOT_CLOSABLE when already closed"` (segundo llamado).
    - `"returns NOT_FOUND for another tenant's contact or a malformed id"`.
  - `describe("listBoard")`:
    - `"hides consulta contacts idle longer than the tenant's consulta_idle_days"`: consulta con `last_message_at = now() - 2 days` no aparece; con `now() - 1 hour` sí; un contacto en venta con `now() - 5 days` sí aparece.
    - `"shows them again when consulta_idle_days grows"`: `update tenants set consulta_idle_days = 3` → el de 2 días vuelve a aparecer.
- [ ] **Step 2:** `npx vitest run src/contacts/contacts.int.test.ts` → FAIL (`closeContact` no existe).
- [ ] **Step 3: Schema + migraciones.** Agregar las columnas en `schema.ts` (check con `check("tenants_consulta_idle_days_range", sql\`...\`)`). `npm run db:generate -- --name board_active_tasks`. Después `npx drizzle-kit generate --custom --name board_active_tasks_grants` y escribir:
  ```sql
  GRANT UPDATE ("closed_at", "reopened_at", "reached_venta_at") ON "contacts" TO crm_app;--> statement-breakpoint
  GRANT UPDATE ("handoff") ON "messages" TO crm_app;--> statement-breakpoint
  GRANT UPDATE ("consulta_idle_days") ON "tenants" TO crm_app;
  ```
  (`contacts` ya tiene UPDATE completo; la línea queda explícita por si se angosta.)
- [ ] **Step 4: Implementar** `closeContact` (Zod uuid; `update ... set closed_at = now() where id, tenant, stage in ('consulta','postventa') and closed_at is null returning id`; si no actualizó, distinguir `NOT_FOUND` vs `NOT_CLOSABLE` con un select). En `listBoard`, `where closed_at is null and not (stage = 'consulta' and last_message_at < now() - make_interval(days => (select consulta_idle_days from tenants where id = contacts.tenant_id)))`. Un contacto sin mensajes (`last_message_at` null) se muestra. La condición de "Consulta inactiva" va en una sola constante `idleConsulta` (fragmento `sql`) en `contacts.ts`, que Task 2 reutiliza.
- [ ] **Step 5:** `npx vitest run src/contacts/contacts.int.test.ts` → PASS; `npm test` sin regresiones.
- [ ] **Step 6: Commit** `feat: close contacts and hide idle consultas from the board`.

### Task 2: Reapertura desde el webhook

**Files:**
- Modify: `crm/src/contacts/contacts.ts`, `crm/src/whatsapp/webhook.ts:140-158`
- Test: `crm/src/whatsapp/webhook.int.test.ts`

**Interfaces:**
- Consumes: columnas de Task 1.
- Produces: `reopenContact(tx: Tx, tenantId: string, jid: string): Promise<void>` en `contacts.ts`.

- [ ] **Step 1: Tests que fallan** en `webhook.int.test.ts` (seguir el armado de eventos del archivo):
  - `"a customer message reopens a closed contact as a new consulta"`: contacto postventa con `closed_at` y `bot_paused_until` futuro → evento del cliente → `closed_at` null, `stage = 'consulta'`, `reopened_at` no null, `bot_paused_until` null.
  - `"a customer message reopens an idle consulta"`: consulta con `last_message_at = now() - 2 days` → `reopened_at` no null.
  - `"a message from the business number does not reopen"`: `fromMe: true` sobre cerrado → `closed_at` sigue igual.
  - `"an idle venta contact keeps its stage"`: venta con `last_message_at = now() - 5 days` → `stage = 'venta'`, `reopened_at` null.
- [ ] **Step 2:** `npx vitest run src/whatsapp/webhook.int.test.ts` → FAIL.
- [ ] **Step 3: Implementar** `reopenContact`: un `update contacts set closed_at = null, reopened_at = now(), stage = 'consulta', bot_paused_until = null where tenant_id and jid and (closed_at is not null or (stage = 'consulta' and last_message_at < now() - make_interval(days => <idle days del tenant>)))`. En `webhook.ts`, dentro del mismo `withTenant`, llamarlo **antes** del upsert y solo si `!fromMe` (el upsert pisa `last_message_at`).
- [ ] **Step 4:** test → PASS; `npm test`.
- [ ] **Step 5: Commit** `feat: reopen a closed or idle contact when the customer writes again`.

### Task 3: Registrar hasta dónde llegó (`reached_venta_at`)

**Files:**
- Modify: `crm/src/bot/tools.ts:122-129`, `crm/src/contacts/contacts.ts` (`setContactStage`)
- Test: `crm/src/contacts/contacts.int.test.ts`, `crm/src/bot/reply.int.test.ts` (bloque "2b")

- [ ] **Step 1: Tests que fallan:**
  - `setContactStage`: `"stamps reached_venta_at once when moved to venta"`: pasar a venta → no null; volver a consulta y otra vez a venta → conserva la primera fecha.
  - `reply.int.test.ts`: en el test de handoff existente del bloque 2b, agregar `expect(reached_venta_at).not.toBeNull()`.
- [ ] **Step 2:** correr ambos archivos → FAIL.
- [ ] **Step 3: Implementar** `reachedVentaAt: sql\`coalesce(${contacts.reachedVentaAt}, now())\`` en el `set` de `handoff_to_admin` y en `setContactStage` cuando `stage === "venta"`.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat: record when a contact first reaches venta`.

### Task 4: Historial con traspasos como llamada a herramienta

**Files:**
- Create: `crm/src/bot/history.ts`, `crm/src/bot/history.test.ts`
- Modify: `crm/src/bot/tools.ts` (`ToolOptions.onHandoff`), `crm/src/bot/reply.ts` (`loadConversation`, `deliver`, `runConversation`, `relayToCustomer`), `crm/src/bot/try-agent.ts`, `crm/src/app/t/[slug]/agente/test-chat.tsx`
- Test: `crm/src/bot/reply.int.test.ts`, `crm/src/bot/try-agent.int.test.ts`

**Interfaces:**
- Produces: `type HistoryTurn = { role: "user" | "assistant"; text: string; handoff?: boolean }` y `toModelMessages(turns: HistoryTurn[], opts: { toolCalls: boolean }): ModelMessage[]` en `history.ts`.
- Produces: `ToolOptions.onHandoff?: () => void` (se llama en `handoff_to_admin` real, después del update, y en dry run).
- Produces: `TryTurn` acepta `handoff?: boolean` (Zod `z.boolean().optional()`).

- [ ] **Step 1: Tests unitarios que fallan** en `history.test.ts`:
  - `"drops leading assistant turns so the history opens with the user"`.
  - `"expands a handoff turn into tool-call, tool-result and the text"`: `[{user,"quiero 2"},{assistant,"Te atiende alguien del equipo.",handoff:true},{user,"dale"}]` con `toolCalls: true` → mensajes `user`, `assistant` con parte `{ type: "tool-call", toolName: "handoff_to_admin" }`, `tool` con `{ type: "tool-result", output: { type: "json", value: { ok: true } } }`, `assistant` con el texto, `user`. El `toolCallId` es único por turno.
  - `"keeps a handoff turn as plain text when toolCalls is false"`.
- [ ] **Step 2:** `npx vitest run src/bot/history.test.ts` → FAIL.
- [ ] **Step 3: Implementar `toModelMessages`.** → Step 2 en verde.
- [ ] **Step 4: Tests de integración que fallan** en `reply.int.test.ts` (bloque 2b):
  - `"stores the handoff reply with handoff = true"`: modelo `[toolCall("handoff_to_admin",…), text(…)]` → la fila del bot tiene `handoff = true`; una respuesta normal queda en `false`.
  - `"replays a previous handoff to the model as a tool call"`: sembrar mensaje bot con `handoff = true` (ownerSql) + cliente "dale" → `model.doGenerateCalls[0].prompt` contiene una parte `tool-call` con `toolName: "handoff_to_admin"`.
  - `"relays without tool calls in the history"`: escalación respondida + mensaje bot `handoff = true` previo → el prompt del relay no contiene `tool-call` (Review Focus 4).
  - En `try-agent.int.test.ts`: `"replays a handoff turn of the test chat as a tool call"`.
- [ ] **Step 5:** correr esos archivos → FAIL.
- [ ] **Step 6: Implementar.** `loadConversation` selecciona `messages.handoff`. `runConversation` pasa `onHandoff: () => (handedOff = true)` y `deliver(..., { handoff: handedOff })` guarda `handoff` en el insert **y** en el `onConflictDoUpdate.set`. Ambos caminos (`runConversation` con `toolCalls: true`, `relayToCustomer` con `toolCalls: false`) arman el historial con `toModelMessages` (autor `customer` → `user`, resto → `assistant`). `tryAgent` usa `toModelMessages(..., { toolCalls: true })`; `test-chat.tsx` guarda `handoff: true` en el turno del asistente cuando la respuesta trajo la nota de traspaso, y lo manda en el historial.
- [ ] **Step 7:** → PASS; `npm test`.
- [ ] **Step 8: Commit** `fix: replay past handoffs as tool calls so the model hands off again`.

### Task 5: Conversación nueva desde `reopened_at`

**Files:**
- Modify: `crm/src/bot/reply.ts` (`loadConversation`)
- Test: `crm/src/bot/reply.int.test.ts`

- [ ] **Step 1: Tests que fallan:**
  - `"after a reopen, the model only sees messages since reopened_at"`: mensajes viejos (cliente+bot) hace 3 días, `reopened_at = now() - 1 minute`, cliente "hola" ahora → el prompt no contiene el texto viejo.
  - `"introduces itself again after a reopen"`: bot respondió hace 1 hora (no se presentaría), `reopened_at` después → el system prompt incluye la instrucción de presentarse (misma aserción que el test existente "introduces itself on a fresh conversation only").
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3: Implementar:** en `loadConversation`, filtrar `recent` y el cálculo de `lastBotAt` con `sent_at >= coalesce(contact.reopened_at, '-infinity')`. El tope de 20 respuestas por hora no cambia.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat: start a fresh bot conversation after a reopen`.

### Task 6: Botones en el tablero

**Files:**
- Create: `crm/src/app/t/[slug]/close-contact-button.tsx`
- Modify: `crm/src/app/t/[slug]/actions.ts`, `crm/src/app/t/[slug]/page.tsx` (`Card`), `crm/src/app/globals.css`
- Test: `crm/e2e/board.spec.ts`

**Interfaces:**
- Consumes: `closeContact` (Task 1).
- Produces: `closeContactAction(slug: string, contactId: string): Promise<Result<{ id: string }>>`; `<CloseContactButton slug contactId name variant: "sale" | "dismiss" />`.

- [ ] **Step 1: E2E que fallan** en `board.spec.ts` (sembrar en `beforeAll`: "Carla" en postventa con pedido entregado, "Dani" en consulta):
  - `"Cerrar venta removes a postventa card"`: clic en "Cerrar venta" dentro del artículo de Carla → el artículo desaparece y el heading pasa a "Postventa 0".
  - `"the × removes a consulta card"`: clic en el botón con nombre "Quitar a Dani del tablero" → desaparece.
  - Ajustar los conteos de los tests existentes.
- [ ] **Step 2:** `npx playwright test e2e/board.spec.ts` → FAIL.
- [ ] **Step 3: Implementar** la action (igual a `reactivateAction`) y el botón (patrón de `ReactivateButton`: `useTransition`, texto pendiente "Cerrando…", error con `role="alert"`, mensaje de catch "No pudimos sacarlo del tablero, probá de nuevo."). `variant="sale"` → botón "Cerrar venta" en el pie de las tarjetas de Postventa; `variant="dismiss"` → "×" en la esquina superior derecha de las tarjetas de Consulta, fuera del `<a>` de la tarjeta, área táctil ≥ 32 px y foco visible.
- [ ] **Step 4:** → PASS; revisión visual del tablero (desktop y mobile).
- [ ] **Step 5: Commit** `feat: add Cerrar venta and dismiss buttons to the board`.

### Task 7: Pestaña Configuración

**Files:**
- Modify: `crm/src/tenants/tenants.ts`, `crm/src/app/t/[slug]/tenant-nav.tsx`
- Create: `crm/src/app/t/[slug]/configuracion/{page.tsx,actions.ts,settings-form.tsx,loading.tsx,error.tsx}`
- Test: `crm/src/tenants/tenants.int.test.ts` (crear si no existe), `crm/e2e/settings.spec.ts`

**Interfaces:**
- Produces: `saveBoardSettings(tenantId: string, input: unknown): Promise<Result<{ consultaIdleDays: number }>>` con `z.object({ consultaIdleDays: z.coerce.number().int().min(1).max(30) })`, mensaje "Entre 1 y 30 días".

- [ ] **Step 1: Tests que fallan:**
  - `"saves consulta_idle_days"` (3 → la base tiene 3).
  - `"rejects 0, 31 and non-numbers with VALIDATION"`.
  - `"only touches its own tenant"`.
  - E2E: `"Configuración saves the idle days"`: ir a Configuración desde la nav, poner 3, guardar, recargar → el campo muestra 3.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3: Implementar** `saveBoardSettings` (update vía `getDb()` como `admin_phone`). Página con `useActionState` (patrón de `agente/agent-form.tsx`): `<input type="number" min=1 max=30>` con label, mensaje de guardado con `role="status"`, error del servidor con `role="alert"`; `loading.tsx` y `error.tsx` copiando los de `agente/`. Link "Configuración" al final de la nav.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat: add a settings tab for the consulta idle days`.

### Task 8: Eval, README y cierre

**Files:**
- Modify: `crm/eval/agent.eval.ts`, `README.md`

- [ ] **Step 1:** En `agent.eval.ts`, escenario `"7 segundo traspaso"`: historial `[{user,"Quiero 2 panes"},{assistant,"Bárbaro, ya te atiende alguien del equipo para cerrar la compra.",handoff:true},{user,"Quiero 2 más, ¿cómo pago?"}]`; pasa si `adminNote` empieza con `"(el bot pasaría"`. Hace falta que `scenarios` acepte un historial además de `message`.
- [ ] **Step 2:** `npm run eval:agent` → el escenario 7 aprueba 2/2 con `qwen3:8b`.
- [ ] **Step 3:** README: tablero (Cerrar venta, ×, consultas inactivas, reapertura) y pestaña Configuración, en el estilo de las secciones existentes.
- [ ] **Step 4: Verificación final:** `npm run lint`, `npm run typecheck`, `npm test`, `npx playwright test`, `npm audit --audit-level=high`, `gitleaks detect` → todo limpio.
- [ ] **Step 5: Commit** `docs: describe closing contacts and the settings tab`.
