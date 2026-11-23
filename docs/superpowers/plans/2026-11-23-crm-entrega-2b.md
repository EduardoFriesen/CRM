# CRM Entrega 2b (Consulta al admin + traspaso) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El bot consulta al admin por WhatsApp y transmite su respuesta citada al cliente, aprendiéndola salvo que sea de precios. Además pasa el control al admin al cerrar una venta y se pausa en esa charla hasta que se reactiva.

**Architecture:** Dos herramientas nuevas del bot (`ask_admin`, `handoff_to_admin`) y un "canal admin" en el webhook (el número personal del admin no es cliente). Tres tipos de tarea nuevos en la cola BullMQ existente (`relay`, `check-admin`, `remind`), procesados por el mismo `crm-worker`. Los datos aprendidos van al prompt dentro de `<negocio>`.

**Tech Stack:** el de la 2a (Next.js 16, Drizzle + RLS, Zod, BullMQ, Vercel AI SDK v7, Vitest, Playwright).

**Spec:** `docs/superpowers/specs/2026-11-23-crm-entrega-2b-design.md` (sobre la 2a: `docs/superpowers/specs/2026-11-23-crm-entrega-2a-design.md`).

## Global Constraints

- Todo lo de la 2a sigue vigente:
  - sin logs de texto, teléfonos ni keys;
  - la key nunca sale del servidor;
  - RLS vía `withTenant`;
  - 4 estados en la UI;
  - commits convencionales con el trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Valores fijados por el spec:
  - `pause_hours` default **12**, rango **1–168**;
  - recordatorio a las **2 h**, una sola vez;
  - verificación del eco a los **10 s**;
  - pista "citá el mensaje" como mucho cada **10 min**;
  - máximo **3** consultas pendientes por contacto;
  - datos aprendidos en el prompt hasta **8000** caracteres, primero los más recientes;
  - pregunta ≤ **500**, respuesta ≤ **2000**.
- **Precios nunca se aprenden.** Se bloquea si `is_price` **o** si `mentionsMoney(question + " " + answer)`.
- El número del admin (`tenants.admin_phone`, dígitos) **nunca** crea contacto, no se guarda en `messages` y no despierta al bot.
- Los mensajes que llegan durante una pausa no se contestan después.
- Textos al admin (contenido fijo, redacción libre):
  - consulta: `Consulta de <nombre|un cliente> (+<tel>): <pregunta>. Respondé citando este mensaje.`;
  - recordatorio: `Recordatorio: ` + el texto de la consulta;
  - traspaso: `Traspaso: <nombre> (+<tel>) quiere cerrar una compra. <reason>. Atendelo desde el WhatsApp del negocio.`;
  - confirmación: `Listo, le respondí a <nombre>.` (+ ` (no la guardé porque es de precios)` si aplica);
  - pista: `Para responder una consulta, citá el mensaje de la consulta.`
- Rama: `feat/crm-entrega-2b`, que sale de `feat/crm-entrega-2a`.

## Review Focus

1. **El admin cita una consulta ya respondida**: no se reenvía dos veces ni se reaprende; se ignora → test en Task 6.
2. **El número del admin llega como `@lid` con `remoteJidAlt`**: igual se lo reconoce como admin → test en Task 6.
3. **Un cliente escribe durante la pausa y después se reactiva**: el mensaje viejo no se contesta solo; el próximo mensaje nuevo sí → test en Task 4.
4. **El admin responde "Sale $3.500" a una consulta marcada `is_price=false`**: se transmite al cliente, pero no se aprende → test en Task 6.
5. **El eco `fromMe` del mensaje del bot llega antes de que el worker lo reclame**: no pausa la conversación → test en Task 5.

---

## File Structure

```
crm/drizzle/0007_*.sql (generada) + 0008_entrega2b_rls.sql (custom)
crm/src/db/schema.ts                     + escalations, businessFacts, contacts.botPausedUntil, agentConfigs.pauseHours/adminHintAt
crm/src/bot/money-guard.ts               mentionsMoney
crm/src/bot/prompt.ts                    + facts, + reglas 2b
crm/src/bot/admin-messages.ts            textos al admin + notifyAdmin
crm/src/bot/tools.ts                     + ask_admin, handoff_to_admin
crm/src/bot/reply.ts                     + pausa, + facts, + runRelay
crm/src/bot/admin-jobs.ts                checkAdminPause, sendReminder
crm/src/bot/queue.ts                     + enqueueRelay/enqueueCheckAdmin/enqueueReminder
crm/src/worker.ts                        despacho por job.name
crm/src/facts/facts.ts                   listFacts/updateFact/deleteFact/listPendingEscalations/answerEscalation
crm/src/contacts/contacts.ts             + reactivateBot, listBoard con botPausedUntil
crm/src/agent/config.ts                  + pauseHours, adminPhone
crm/src/whatsapp/webhook.ts              + canal admin, + contextInfo, + check-admin, + pausa
crm/src/app/t/[slug]/aprendido/*         pantalla "Datos aprendidos"
crm/src/app/t/[slug]/{page.tsx,stage-select.tsx→card-actions}, agente/*  UI
```

---

### Task 1: Esquema 2b

**Files:**
- Modify: `crm/src/db/schema.ts`
- Create: migración generada + `crm/drizzle/0008_entrega2b_rls.sql` (custom), `crm/src/db/entrega2b.int.test.ts`

**Interfaces:**
- Produces:
  - `agent_configs.pause_hours int NOT NULL DEFAULT 12` con `CHECK (pause_hours BETWEEN 1 AND 168)`.
  - `agent_configs.admin_hint_at timestamptz NULL`.
  - `contacts.bot_paused_until timestamptz NULL`.
  - `escalations(id uuid, tenant_id → tenants cascade, contact_id → contacts cascade, question text, is_price bool, admin_message_id text, status pgEnum('escalation_status',['pending','answered']) default 'pending', answer text null, reminded_at null, created_at, answered_at null)`, unique `(tenant_id, admin_message_id)`.
  - `business_facts(id, tenant_id → tenants cascade, question text, answer text, escalation_id → escalations set null, created_at, updated_at)`.
  - TS: `Escalation`, `BusinessFact`.
  - SQL:
    - RLS `tenant_isolation` en `escalations` y `business_facts`;
    - `GRANT SELECT, INSERT, UPDATE ON escalations`;
    - `GRANT SELECT, INSERT, UPDATE, DELETE ON business_facts`;
    - `GRANT UPDATE (admin_phone) ON tenants` a `crm_app`.

- [ ] **Step 1: Escribir los tests.** `entrega2b.int.test.ts`:
  - `withTenant(A)` no ve escalations ni facts de B;
  - `crm_app` puede `update tenants set admin_phone` pero no `name` (`permission denied`);
  - `pause_hours = 0` falla por el check;
  - una config nueva queda con `pause_hours = 12`.
- [ ] **Step 2: Ver el FAIL.**
- [ ] **Step 3: Implementar** el schema, `npm run db:generate` y la migración custom. Reconstruir `crm` y `crm-worker` justo después de migrar la base de dev (la 2a mostró que la imagen vieja choca con el esquema nuevo).
- [ ] **Step 4: `npx vitest run`.** Esperado: PASS.
- [ ] **Step 5: Commit** `feat: add escalation, learned facts and bot pause schema`

### Task 2: Detector de dinero y prompt con datos aprendidos

**Files:**
- Create: `crm/src/bot/money-guard.ts` (+ `.test.ts`)
- Modify: `crm/src/bot/prompt.ts`, `crm/src/bot/prompt.test.ts`

**Interfaces:**
- Produces:
  - `mentionsMoney(text: string): boolean`: true si hay `$` seguido de dígitos, o alguna palabra (minúsculas, sin acentos, con límite de palabra) del conjunto `precio|precios|cuesta|cuestan|sale|salen|vale|valen|costo|costos|cobr\w*|descuento|recargo|pesos|ars|usd|dolares`.
  - `PromptInput` suma `facts: { question: string; answer: string }[]`. `buildSystemPrompt` los agrega dentro de `<negocio>` bajo "Preguntas ya respondidas por el equipo:", recortando a 8000 caracteres en el orden recibido (el llamador los pasa del más reciente al más viejo).
  - Reglas fijas nuevas:
    - "Si te falta un dato, usá ask_admin y decile al cliente: lo consulto y te aviso.";
    - "En ask_admin marcá is_price=true si la pregunta es sobre precios, costos, descuentos o recargos.";
    - "Nunca uses las preguntas ya respondidas para dar precios.";
    - "Cuando el cliente quiera cerrar la compra (confirma, pregunta cómo pagar o pide reservar), usá handoff_to_admin y decile que lo atiende alguien del equipo.";
    - "Formulá las consultas al admin sin datos personales del cliente."

    Se reemplaza la regla de la 2a "si te falta un dato decí…" por la de `ask_admin`. La frase de la 2a queda solo como respaldo si `ask_admin` falla.

- [ ] **Step 1: Escribir los tests.**
  - `mentionsMoney`: true para `"$2.500"`, `"cuesta 3000"`, `"Sale 3.500 la docena"`, `"tiene descuento"`, `"en pesos"`; false para `"abrimos a las 8"`, `"sí, hacemos envíos a Pilar"`, `"salimos a las 9"`, `"la venta es por mayor"`.
  - Prompt: incluye `"Preguntas ya respondidas"` con un fact dentro de `<negocio>`; con 300 facts de 100 caracteres, la sección de facts mide ≤ 8000 y contiene el primero; contiene `"ask_admin"` y `"handoff_to_admin"` en las reglas, antes de `<negocio>`.
- [ ] **Step 2: Ver el FAIL.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Correr la suite.** Esperado: PASS.
- [ ] **Step 5: Commit** `feat: add money guard and learned facts to the bot prompt`

### Task 3: Mensajes al admin

**Files:**
- Create: `crm/src/bot/admin-messages.ts` (+ `.test.ts`, + `admin-messages.int.test.ts`)

**Interfaces:**
- Consumes: `sendText` (`crm/src/whatsapp/evolution.ts`), `withTenant`, `tenants`, `whatsappInstances`.
- Produces:
  - `escalationText(c: { name: string | null; phone: string | null }, question: string): string`;
  - `reminderText(...)`;
  - `handoffText(c, reason: string): string`;
  - `relayConfirmText(name: string | null, notLearnedBecausePrice: boolean): string`;
  - `HINT_TEXT`: exactos según Global Constraints; nombre nulo → `"un cliente"`, teléfono nulo → se omite el paréntesis.
  - `notifyAdmin(tenantId: string, text: string, deps?: { send?: typeof sendText }): Promise<{ id: string }>`: envía a `${admin_phone}@s.whatsapp.net` por la instancia del negocio.

- [ ] **Step 1: Escribir los tests.**
  - Unit: `escalationText({ name: "Ana", phone: "5491122334455" }, "¿Hacen envíos a Pilar?")` → `"Consulta de Ana (+5491122334455): ¿Hacen envíos a Pilar?. Respondé citando este mensaje."` (normalizar el punto doble si la pregunta ya termina en `?` o `.`); `escalationText({ name: null, phone: null }, "x")` empieza con `"Consulta de un cliente: "`.
  - Integración: `notifyAdmin` llama `send(slug, "5491100000000@s.whatsapp.net", text)`.
- [ ] **Step 2: Ver el FAIL.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Ver el PASS.**
- [ ] **Step 5: Commit** `feat: add admin notification messages`

### Task 4: Herramientas `ask_admin` y `handoff_to_admin`, pausa y facts en la conversación

**Files:**
- Modify: `crm/src/bot/tools.ts`, `crm/src/bot/reply.ts`, `crm/src/bot/try-agent.ts`, `crm/src/bot/queue.ts`, `crm/src/bot/reply.int.test.ts`, `crm/src/bot/try-agent.int.test.ts`
- Create: `crm/src/facts/facts.ts` (solo `recentFacts` en esta tarea)

**Interfaces:**
- Consumes: `notifyAdmin`, `escalationText`, `handoffText` (Task 3).
- Also produces in `crm/src/bot/queue.ts`: `enqueueReminder(tenantId, escalationId)`, con demora de 7 200 000 ms, `jobId` `remind:<escalationId>` y el mismo timeout de 1,5 s. Es el default de `scheduleReminder`; el worker lo procesa desde la Task 5.
- Produces:
  - `recentFacts(tenantId): Promise<{ question: string; answer: string }[]>`, más recientes primero.
  - `makeTools(tenantId, contactId, opts: { dryRun: boolean; onStage?; onAdmin?: (kind: "ask" | "handoff", text: string) => void; notify?: (text: string) => Promise<{ id: string }>; scheduleReminder?: (escalationId: string) => Promise<void> })` suma:
    - `ask_admin({ question: string ≤ 500, is_price: boolean })`:
      - con `dryRun` solo llama `onAdmin("ask", question)`;
      - si no, y si hay < 3 pendientes del contacto: `notify(escalationText(...))`, inserta la escalación con `admin_message_id` = id devuelto, llama `scheduleReminder(id)` y devuelve `{ ok: true }`;
      - si ya hay ≥ 3 pendientes o `notify` lanza, devuelve `{ ok: false, fallback: "no tengo ese dato, te lo confirma alguien del equipo" }`.
    - `handoff_to_admin({ reason: string ≤ 300 })`:
      - con `dryRun` solo llama `onAdmin("handoff", reason)`;
      - si no: `bot_paused_until = now + pause_hours`, etapa `venta` y `notify(handoffText(...))`. Si `notify` falla, igual pausa y registra `recordAgentError("HANDOFF_NOTIFY")`.
  - `runConversation` devuelve `"skipped:paused"` si `contact.botPausedUntil > now`. Pasa `facts: await recentFacts(tenantId)` al prompt.
  - `tryAgent` devuelve `{ reply, stage, adminNote: string | null }`: `"(el bot consultaría al admin: <q>)"` o `"(el bot pasaría la charla a alguien del equipo)"`.

- [ ] **Step 1: Escribir los tests** en `reply.int.test.ts`, con modelos falsos que llaman las herramientas y `send` stubs:
  - **(a)** `ask_admin` → el admin recibe el texto de consulta (`send` con el JID del admin), existe una escalación `pending` con `admin_message_id` = id devuelto, se llama `scheduleReminder` y el cliente recibe la respuesta del modelo;
  - **(b)** con 3 pendientes, `ask_admin` no notifica y la herramienta devuelve `ok:false`;
  - **(c)** `notify` que lanza → no hay escalación y la herramienta devuelve `ok:false`;
  - **(d)** `handoff_to_admin` → `bot_paused_until` ≈ now + 12 h (±1 min), etapa `venta` y el admin recibe el texto de traspaso;
  - **(e)** con `bot_paused_until` futuro → `"skipped:paused"`, sin `send`;
  - **(f)** Review Focus 3: con pausa vencida (pasado) y un mensaje del cliente posterior → `"sent"`;
  - **(g)** un fact guardado aparece en el prompt que recibe el modelo.
  - En `try-agent.int.test.ts`: `ask_admin` en dry-run → `adminNote` contiene la pregunta y no hay escalaciones.
- [ ] **Step 2: Ver el FAIL.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: `npx vitest run`.** Esperado: PASS.
- [ ] **Step 5: Commit** `feat: let the bot ask the admin and hand off closing sales`

### Task 5: Tareas de cola `relay`, `check-admin` y `remind`

**Files:**
- Create: `crm/src/bot/admin-jobs.ts`, `crm/src/bot/admin-jobs.int.test.ts`
- Modify: `crm/src/bot/queue.ts` (+ tests en `queue.int.test.ts`), `crm/src/bot/reply.ts` (`runRelay`), `crm/src/worker.ts`

**Interfaces:**
- Produces:
  - `type BotJob = { name: "reply"; data: { tenantId; contactId } } | { name: "relay"; data: { tenantId; escalationId } } | { name: "check-admin"; data: { tenantId; contactId; waMessageId } } | { name: "remind"; data: { tenantId; escalationId } }`.
  - `enqueueRelay(tenantId, escalationId)`: sin demora, `jobId` `relay:<escalationId>`.
  - `enqueueCheckAdmin(tenantId, contactId, waMessageId)`: demora 10 000 ms.
  - Ambas con el mismo timeout de 1,5 s de `enqueueReply`. `enqueueReminder` ya existe desde la Task 4.
  - `runRelay(tenantId, escalationId, deps?: { model?; send?; now? }): Promise<ConversationOutcome | "skipped:not-answered">`:
    - sale con `skipped:disabled` si el bot está apagado o la key es inválida;
    - sale con `skipped:paused` si la charla está pausada;
    - sale con `skipped:rate-limit` si se pasó el tope;
    - si no, arma el prompt con la instrucción `El equipo respondió a la consulta "<q>": "<a>". Comunicáselo al cliente con tus palabras, sin agregar datos.`, envía y guarda como `bot`.
  - `checkAdminPause(tenantId, contactId, waMessageId): Promise<"paused" | "bot-message">`: si el mensaje sigue con `author='admin'` → `bot_paused_until = now + pause_hours`.
  - `sendReminder(tenantId, escalationId, deps?): Promise<"sent" | "skipped">`: solo si sigue `pending` y `reminded_at` es null; después marca `reminded_at`.
  - Worker: despacha por `job.name` y loguea `job.name`, el outcome y los ms.

- [ ] **Step 1: Escribir los tests.**
  - `checkAdminPause`:
    - un mensaje que el bot ya reclamó (`author='bot'`) → `"bot-message"` y no pausa (Review Focus 5);
    - un mensaje `admin` → `"paused"` con la pausa ≈ now + `pause_hours`.
  - `sendReminder`:
    - envía una vez;
    - la segunda llamada → `"skipped"`;
    - con la consulta `answered` → `"skipped"`.
  - `runRelay`:
    - envía y guarda `bot`;
    - con la pausa activa → `"skipped:paused"`, sin `send`;
    - el prompt incluye la respuesta del admin.
  - Cola: dos `enqueueRelay` del mismo `escalationId` → 1 job; `enqueueCheckAdmin` queda `delayed`.
- [ ] **Step 2: Ver el FAIL.**
- [ ] **Step 3: Implementar.** El worker usa la misma cola `bot-replies` y despacha por `job.name`.
- [ ] **Step 4: `npx vitest run`.** Esperado: PASS.
- [ ] **Step 5: Commit** `feat: relay admin answers, reminders and admin-typing pause from the worker`

### Task 6: Webhook — canal admin, respuestas citadas y pausa

**Files:**
- Modify: `crm/src/whatsapp/webhook.ts`, `crm/src/whatsapp/webhook.int.test.ts`
- Modify: `crm/src/facts/facts.ts` (+ `answerEscalation`)

**Interfaces:**
- Consumes: `enqueueRelay`, `enqueueCheckAdmin` (Task 5); `mentionsMoney` (Task 2); `notifyAdmin`, `relayConfirmText`, `HINT_TEXT` (Task 3).
- Produces:
  - El esquema del upsert suma `data.contextInfo: { stanzaId?: string } | null`.
  - `answerEscalation(tenantId, quotedId: string, answer: string, deps?): Promise<"answered" | "ignored">`:
    - busca la escalación `pending` por `admin_message_id = quotedId`;
    - si no existe o ya está `answered` → `"ignored"`;
    - si no, la marca `answered` con `answer` (cortado a 2000);
    - aprende un `business_fact` si `!is_price && !mentionsMoney(question + " " + answer)`;
    - llama `enqueueRelay` y `notifyAdmin(relayConfirmText(...))`.
  - En `storeMessage`, antes de crear el contacto: si `phoneFromJid(jid, alt) === tenant.admin_phone`, el mensaje va al canal admin.
    - `fromMe` → se ignora.
    - Si trae `contextInfo.stanzaId` → `answerEscalation`.
    - Si no, y hay pendientes y `admin_hint_at` es null o tiene más de 10 min → se envía `HINT_TEXT` y se actualiza `admin_hint_at`.
    - En todos los casos, return sin tocar `contacts` ni `messages`.
  - Un `fromMe` guardado como `admin` en una charla de cliente → `enqueueCheckAdmin(tenantId, contactId, key.id)`.
  - Mensaje entrante del cliente con `bot_paused_until > now` → no se encola la respuesta.

- [ ] **Step 1: Escribir los tests**, en `webhook.int.test.ts` con la cola mockeada y `notifyAdmin` mockeado:
  - **(a)** un mensaje desde el número del admin sin cita → no hay contacto nuevo ni filas en `messages`; con una consulta pendiente se envía `HINT_TEXT` una vez, y un segundo mensaje enseguida no reenvía la pista;
  - **(b)** una cita a la consulta pendiente → `answered`, se aprende el fact, se llama `enqueueRelay` y el admin recibe "Listo, le respondí a Ana.";
  - **(c)** Review Focus 4: una consulta con `is_price=false` y la respuesta `"Sale $3.500"` → `answered` y relay, pero **sin** fact; la confirmación incluye "(no la guardé porque es de precios)";
  - **(d)** una consulta con `is_price=true` y la respuesta `"Sí"` → sin fact;
  - **(e)** Review Focus 1: citar una consulta ya respondida → `"ignored"`, sin relay;
  - **(f)** Review Focus 2: admin con `remoteJid` `123@lid` y `remoteJidAlt` = el número del admin → se reconoce como admin;
  - **(g)** un `fromMe` en la charla de un cliente → se llama `enqueueCheckAdmin` con el `key.id`;
  - **(h)** un cliente pausado escribe → `enqueueReply` no se llama.
- [ ] **Step 2: Ver el FAIL.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: `npx vitest run`.** Esperado: PASS.
- [ ] **Step 5: Commit** `feat: handle admin replies and pauses in the whatsapp webhook`

### Task 7: UI — Datos aprendidos, Agente, tarjeta pausada y chat de prueba

**Files:**
- Create: `crm/src/app/t/[slug]/aprendido/{page.tsx,actions.ts,facts-manager.tsx,loading.tsx,error.tsx}`, `crm/e2e/facts.spec.ts`
- Modify:
  - `crm/src/facts/facts.ts` (+ `listFacts`, `updateFact`, `deleteFact`, `listPendingEscalations`);
  - `crm/src/contacts/contacts.ts` (+ `reactivateBot(tenantId, contactId): Promise<Result<{ id: string }>>`; `BoardContact` + `botPausedUntil: Date | null`);
  - `crm/src/agent/config.ts` (`agentInput` + `pauseHours` (coerce int 1–168, default 12) + `adminPhone` (`/^\d{10,15}$/`), que actualiza `tenants.admin_phone`; `AgentView` + `pauseHours`, `adminPhone`);
  - `crm/src/app/t/[slug]/{page.tsx,actions.ts,stage-select.tsx}`, `agente/{agent-form.tsx,actions.ts,test-chat.tsx}`, `tenant-nav.tsx` (orden: Clientes · Catálogo · Agente · Aprendido · WhatsApp), `globals.css`;
  - `crm/e2e/board.spec.ts`, `crm/e2e/agent.spec.ts`.

**Interfaces:**
- Produces:
  - `listFacts(tenantId): Promise<BusinessFact[]>`.
  - `updateFact(tenantId, id, input: unknown): Promise<Result<BusinessFact>>`: question 1–500, answer 1–2000. **Rechaza con `VALIDATION`** si `mentionsMoney(question + answer)`, con el mensaje "Los precios van en el catálogo".
  - `deleteFact(tenantId, id)`.
  - `listPendingEscalations(tenantId): Promise<{ id; question; contactName; createdAt }[]>`.

- [ ] **Step 1: Escribir los tests.**
  - Integración: `updateFact` con una respuesta `"$500"` → `VALIDATION`; `reactivateBot(A, contactoDeB)` → `NOT_FOUND`.
  - E2E `facts.spec.ts`, con un fact y una consulta pendiente sembrados con `ownerSql`:
    - se ven la consulta pendiente y el fact;
    - editar la respuesta → se ve la nueva;
    - borrar con confirmación → desaparece;
    - estado vacío: "Todavía no aprendió nada…".
  - `board.spec.ts`: con un contacto con `bot_paused_until` = now + 2 h, la tarjeta muestra "Bot pausado hasta" y el botón "Reactivar bot" (fuera del link). Al tocarlo desaparece el aviso.
  - `agent.spec.ts`:
    - "Horas de pausa tras un traspaso" muestra 12;
    - guardar el WhatsApp del administrador `5491199999999` → recargar → persiste;
    - en el chat de prueba con `CRM_FAKE_MODEL`, la respuesta sigue siendo "Respuesta de prueba" (regresión).
- [ ] **Step 2: Ver el FAIL.**
- [ ] **Step 3: Implementar** con la skill `impeccable`, respetando la dirección visual existente. El botón de reactivar sigue el patrón de `stage-select.tsx`: transition, error inline y try/catch.
- [ ] **Step 4: Correr** `npx vitest run && npx playwright test`. Esperado: PASS.
- [ ] **Step 5: Commit** `feat: add learned facts screen, pause controls and admin settings`

### Task 8: Documentación y cierre

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README.** Sección "Consultas al admin y traspaso":
  - las consultas y avisos llegan al WhatsApp del administrador, que se configura en Agente;
  - se responde **citando** el mensaje;
  - lo aprendido se ve y se edita en "Aprendido", y **los precios nunca se aprenden**;
  - el traspaso pausa el bot en esa charla (12 h por defecto) y se reactiva desde la tarjeta;
  - el número del admin no aparece como cliente.

  Checklist manual:
  - consulta → citar → el cliente recibe la respuesta → repetir la pregunta y que conteste sin consultar;
  - preguntar un precio no cargado y que consulte siempre;
  - "lo quiero comprar" → traspaso, aviso, pausa y Reactivar.
- [ ] **Step 2: Verificación final.** `cd crm && npx vitest run && npx playwright test && npm run lint && npm run typecheck && npm audit --audit-level=high`; reconstruir con `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build`; después `bash tests/static.sh && bash tests/smoke.sh && bash tests/db-isolation.sh && gitleaks detect --no-banner --redact`. Esperado: todo verde y `crm-worker ready`.
- [ ] **Step 3: Commit** `docs: document admin questions, learned facts and handoff`
