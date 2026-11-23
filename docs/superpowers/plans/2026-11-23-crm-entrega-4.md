# CRM Entrega 4 (Etapas automáticas + barra de consumo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El bot solo puede devolver a Consulta (detecta recompra en Postventa); Venta sale del traspaso y Postventa de la entrega, que además reactiva el bot; una barra muestra el consumo diario de IA y lo que queda si hay límites.

**Architecture:** Se restringe la herramienta `set_stage` y se pasa la etapa al prompt. `deliverOrder` limpia la pausa. Un módulo `src/usage/usage.ts` registra el uso con un upsert atómico por (negocio, día de Buenos Aires) desde el único punto que llama al modelo. Una franja server-side en el layout del negocio lo muestra.

**Tech Stack:** el existente; sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-11-23-crm-entrega-4-design.md`

## Global Constraints

- Las reglas de las entregas previas siguen vigentes (RLS, Zod, `Result`, 4 estados, WCAG AA, sin PII en logs, commits convencionales con el trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).
- Copias exactas:
  - regla del prompt: `Si el cliente está en Postventa y muestra intención de volver a comprar (pide otro producto o repetir el pedido), llamá a set_stage con consulta. Si solo pregunta por lo que ya compró o hace un reclamo, no cambies la etapa.`;
  - aviso de la barra: `Aproximado: tu proveedor puede reiniciar la cuota en otro horario (Google: medianoche del Pacífico).`
- Umbrales de la barra: amarillo desde **80%**, rojo desde **100%**. Si hay dos límites, gana el porcentaje mayor.
- Día = fecha en `America/Argentina/Buenos_Aires` (reusar `todayInBuenosAires` de `crm/src/orders/group.ts`).
- Registrar el uso **nunca** hace fallar una respuesta: se loguea solo el código.
- Rama: `feat/crm-entrega-4`.

## Review Focus

1. **Falla el registro de uso** (por ejemplo, la base rechaza el upsert): la respuesta al cliente se envía igual → test en Task 2.
2. **Mensaje a las 23:30 de Argentina** (ya es el día siguiente en UTC): cuenta para el día argentino → test en Task 2.
3. **Dos respuestas simultáneas del mismo negocio**: no se pierde ningún incremento → test en Task 2.
4. **El bot intenta `set_stage` a venta o postventa**: rechazado y la tarjeta no se mueve → test en Task 1.
5. **Se borra un límite en Agente** (campo vacío): la barra vuelve a mostrar solo lo consumido → test en Task 3.

---

### Task 1: Reglas de etapas del bot y reactivación al entregar

**Files:**
- Modify: `crm/src/bot/tools.ts`, `crm/src/bot/prompt.ts`, `crm/src/bot/reply.ts`, `crm/src/bot/try-agent.ts`, `crm/src/orders/orders.ts`
- Test: `crm/src/bot/prompt.test.ts`, `crm/src/bot/reply.int.test.ts`, `crm/src/orders/orders.int.test.ts`, `crm/src/bot/try-agent.int.test.ts`

**Interfaces:**
- Produces:
  - `set_stage` con `inputSchema: z.object({ stage: z.literal("consulta") })`.
  - `PromptInput` suma `stage?: Stage`; el prompt incluye `Etapa actual del cliente: <Consulta|Venta|Postventa>` (no se agrega si no hay etapa, como en el chat de prueba) y la regla exacta de Global Constraints.
  - Se elimina de la regla de etapas la mención a pasar a venta por cuenta propia.
  - `runConversation` y `runRelay` pasan `stage: conv.contact.stage`.
  - `deliverOrder` pone `botPausedUntil: null` junto con `stage: "postventa"`.

- [ ] **Step 1: Escribir los tests.**
  - `prompt.test`: con `stage: "postventa"` contiene `"Etapa actual del cliente: Postventa"` y la regla exacta; no contiene `"venta (decide comprar"`.
  - `reply.int.test`:
    - un modelo que llama `set_stage({stage:"venta"})` → la etapa no cambia (el SDK rechaza el input contra el esquema);
    - un contacto en postventa con pedido entregado y un modelo que llama `set_stage({stage:"consulta"})` → queda en consulta.
  - `orders.int.test`: un contacto con `bot_paused_until` futuro y un pedido entregado → `bot_paused_until` null.
  - `try-agent.int.test`: el test existente que mueve a venta pasa a usar `consulta` y espera `stage: "consulta"`.
- [ ] **Step 2: Ver el FAIL.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: `npx vitest run`.** Esperado: PASS.
- [ ] **Step 5: Commit** `feat: let the bot only reopen postventa customers and reactivate it on delivery`

### Task 2: Registro de uso de IA

**Files:**
- Modify: `crm/src/db/schema.ts`, `crm/src/bot/reply.ts`, `crm/src/bot/try-agent.ts`, `crm/src/agent/config.ts`
- Create: migración generada + custom RLS, `crm/src/usage/usage.ts`, `crm/src/usage/usage.int.test.ts`

**Interfaces:**
- Produces:
  - Tabla `ai_usage(tenant_id → tenants cascade, day date, requests int default 0, input_tokens bigint default 0, output_tokens bigint default 0, replies int default 0, PK(tenant_id, day))`, con RLS y `GRANT SELECT, INSERT, UPDATE` a `crm_app`.
  - `agent_configs.daily_request_limit int null` y `daily_token_limit int null`.
  - `type UsageDelta = { requests?: number; inputTokens?: number; outputTokens?: number; replies?: number }`.
  - `recordUsage(tenantId: string, delta: UsageDelta, now = new Date()): Promise<void>`: upsert con `on conflict … do update set requests = ai_usage.requests + excluded.requests …`. Captura cualquier error, loguea `usage record failed: <code>` y no relanza.
  - `getUsageToday(tenantId, now = new Date()): Promise<{ requests: number; inputTokens: number; outputTokens: number; replies: number }>`: ceros si no hay fila.
  - `meteredGenerate(tenantId, model, args) : Promise<string>` en `reply.ts` reemplaza a `generateAgentText` en `generateOrRecord` y `tryAgent`. En éxito registra `requests = steps.length` y los tokens del `totalUsage` (o la suma de `usage` de los pasos); en error registra `requests: 1` y relanza.
  - `deliver()` registra `replies: 1` después de guardar.
  - `saveAgentConfig` registra `requests: 1` cuando verificó la key.

- [ ] **Step 1: Escribir los tests** (`usage.int.test.ts` + `reply.int.test.ts`).
  - `recordUsage` dos veces → suma.
  - Review Focus 3: 20 `recordUsage({requests:1})` en `Promise.all` → `requests = 20`.
  - Review Focus 2: con `now = 2026-11-25T02:30:00Z` cuenta en `day = '2026-11-24'`.
  - RLS: B no ve el uso de A.
  - `runConversation` con un modelo de 2 pasos (tool call + texto, `usage` 1+1 por paso en el mock) → `requests 2`, `input 2`, `output 2`, `replies 1`.
  - Un 429 de cuota → `requests 1`, `input 0`.
  - Review Focus 1, en un archivo aparte con `vi.mock("@/usage/usage")` y un `recordUsage` que rechaza: `runConversation` devuelve `"sent"`. Esto exige que el wrapper llame `recordUsage(...).catch(...)` y no dependa de la captura interna.
- [ ] **Step 2: Ver el FAIL.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: `npx vitest run`.** Esperado: PASS.
- [ ] **Step 5: Commit** `feat: meter AI requests, tokens and replies per tenant and day`

### Task 3: Barra de consumo y límites en Agente

**Files:**
- Create: `crm/src/usage/meter.ts` (+ `.test.ts`), `crm/src/app/t/[slug]/usage-bar.tsx`, `crm/e2e/usage.spec.ts`
- Modify: `crm/src/agent/config.ts` (`agentInput` + `dailyRequestLimit`, `dailyTokenLimit`; `AgentView` los incluye), `crm/src/app/t/[slug]/layout.tsx`, `crm/src/app/t/[slug]/agente/{agent-form.tsx,actions.ts}`, `crm/src/app/globals.css`

**Interfaces:**
- Produces:
  - `usageMeter(u: { requests: number; inputTokens: number; outputTokens: number }, limits: { requests: number | null; tokens: number | null }): { percent: number | null; level: "ok" | "warn" | "full" | null; label: string | null }`:
    - el porcentaje es el mayor entre `requests/limit` y `(in+out)/limit`, redondeado y con tope visual en 100;
    - `label` es, por ejemplo, `"18 de 1.000 pedidos"` o `"24.310 de 200.000 tokens"` según el que gane;
    - sin límites, todo `null`.
  - `agentInput`: `dailyRequestLimit`/`dailyTokenLimit` con `"" → null` y enteros entre 1 y 1e9.
  - `UsageBar` (server) en el layout de `/t/[slug]`, debajo del header. Lee `getUsageToday` y `getAgentView` y muestra:
    - `IA hoy · N pedidos · N tokens · N respuestas`;
    - si hay `percent`, la barra (`<meter>` o `role="progressbar"` con `aria-valuenow`) y el `label`, con texto `Cerca del límite` (warn) o `Límite alcanzado` (full);
    - `Último error:` con `describeAgentError` o `—`;
    - el aviso exacto como `title` y como texto chico;
    - un link a Agente.

- [ ] **Step 1: Escribir los tests.**
  - `meter.test`:
    - sin límites → `{ percent: null, level: null, label: null }`;
    - 800/1000 pedidos → 80 y `warn`;
    - 1000/1000 → 100 y `full`;
    - 1200/1000 → `percent` 100 y `full`;
    - pedidos 10/1000 y tokens 190.000/200.000 → 95 `warn` con el label de tokens.
  - `config.int.test` (Review Focus 5): guardar `dailyRequestLimit: "1000"` y después `""` → `null`.
  - `usage.spec.ts` (E2E):
    - en `/t/<slug>` y `/t/<slug>/catalogo` se ve `IA hoy`;
    - con `ai_usage` sembrado (requests 800) y el límite de pedidos en 1000 → se ve `800 de 1.000 pedidos` y `Cerca del límite`.
- [ ] **Step 2: Ver el FAIL.**
- [ ] **Step 3: Implementar** con la skill `impeccable`, respetando la dirección visual: franja fina con `--panel`, números en `tabular-nums` y estados con texto además de color. Campos nuevos en Agente: "Límite diario de pedidos" y "Límite diario de tokens", con la pista "Copialo de tu plan; vacío = sin límite".
- [ ] **Step 4: `npx vitest run && npx playwright test`.** Esperado: PASS.
- [ ] **Step 5: Commit** `feat: show daily AI usage and limits in a bar on every tenant screen`

### Task 4: Documentación y cierre

- [ ] **Step 1: README.**
  - En la sección Bot: reglas de etapas y reactivación al entregar.
  - Sección "Consumo de IA": qué cuenta la barra, que es aproximada y cómo cargar los límites.
- [ ] **Step 2: Verificación final** (igual que en las entregas previas: suites, lint, typecheck, audit, rebuild, static/smoke/db-isolation y gitleaks). Esperado: todo verde.
- [ ] **Step 3: Commit** `docs: document stage rules and AI usage bar`
