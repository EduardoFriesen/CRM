# Atención, botones del tablero y edición de pedidos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Traspasos de "atención" que no cambian la etapa (tarjeta roja, bot apagado, aviso al admin), botones por columna del tablero en lugar del selector, y edición de pedidos pendientes con atrasados en rojo.

**Architecture:** Tres campos nuevos en `contacts` (`bot_off`, `attention_reason`, `attention_at`). El bot distingue `handoff` (venta) de `attention`. El tablero pinta cada tarjeta según esos campos y muestra botones por columna. `updateOrder` reemplaza los ítems de un pedido pendiente en una transacción que devuelve y vuelve a tomar stock.

**Tech Stack:** Next.js + TypeScript estricto, Drizzle + Postgres (RLS con `withTenant`), Zod, Vercel AI SDK, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-25-attention-board-orders-design.md`

Comandos desde `crm/`: `npx vitest run <archivo>`, `npx vitest run`, `npx tsc --noEmit`, `npm run lint`, `npx playwright test <spec>`.

## Global Constraints

- Atención: no cambia `stage`; `bot_off = true`; `attention_reason`, `attention_at = now()`; aviso al admin `⚠️ <cliente> necesita atención: <motivo> Atendelo desde el WhatsApp del negocio.`
- Venta (`handoff`): sin cambios (Venta + pausa `pauseHours`).
- Reactivar: `bot_off = false`, `bot_paused_until = null`, `attention_reason = null`, `attention_at = null`.
- Reabrir conversación (`reopenContact`): también limpia `bot_off` y la atención.
- Bot no responde con `bot_off` (worker y webhook).
- Postventa permite `attention` y no `handoff`.
- Cerrar en Venta: rechazado si hay pedido pendiente (`HAS_PENDING_ORDER`, "Entregá o cancelá el pedido antes de cerrar").
- Solo pedidos `pending` se editan; mismo esquema de validación que crear; stock ajustado en la misma transacción.
- Rojo siempre con texto (motivo de atención / "Atrasado").
- Commits Conventional terminando con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Cliente en atención que vuelve a escribir:** el webhook no encola y el worker no responde. → test en Task 1.
2. **Editar un pedido bajando cantidades / cambiando producto:** el stock termina exacto (lo devuelto + lo nuevo). → test en Task 4.
3. **Editar un pedido sin stock suficiente:** rechaza y el pedido y el stock quedan como estaban. → test en Task 4.
4. **Cerrar en Venta con pedido pendiente:** rechazado también en el servidor. → test en Task 3.
5. **Reclamo en Postventa por el router:** queda en Postventa, en atención. → test en Task 2.

---

### Task 1: Datos y funciones de atención

**Files:** Modify `crm/src/db/schema.ts`, `crm/src/contacts/contacts.ts`, `crm/src/bot/tools.ts`, `crm/src/bot/admin-messages.ts`, `crm/src/bot/reply.ts`, `crm/src/whatsapp/webhook.ts`; migración vía `npm run db:generate` (renombrar a `0028_contact_attention.sql`). Test: `crm/src/contacts/attention.int.test.ts` (nuevo), `crm/src/bot/reply.int.test.ts`.

**Interfaces — Produces:**
- `requestAttention(tenantId: string, contactId: string, reason: string, opts: Pick<ToolOptions, "notify">): Promise<void>` en `tools.ts` (junto a `handOff`).
- `attentionText(c: Who, reason: string): string` en `admin-messages.ts`.
- `setBotOff(tenantId: string, id: string, off: boolean): Promise<Result<{ id: string }>>` en `contacts.ts`; `off=false` limpia también pausa y atención. `reactivateBot` pasa a ser `setBotOff(…, false)`.
- `BoardContact` suma `botOff: boolean`, `attentionReason: string | null`, `pendingOrderId: string | null`.

- [ ] **Step 1: failing tests** — `requestAttention` deja `stage` igual, `bot_off` true, `attention_reason` = motivo y llama `notify` con `attentionText`; `setBotOff(false)` limpia los cuatro campos; `reopenContact` limpia `bot_off` y atención; `listBoard` devuelve `botOff`, `attentionReason`, `pendingOrderId` (pendiente de fecha más próxima); `runConversation` con `bot_off` → `"skipped:paused"` sin llamar al modelo; webhook no encola con `bot_off` (seguir el patrón de test del webhook existente).
- [ ] **Step 2:** correr → FAIL.
- [ ] **Step 3: implement** campos + migración, funciones, chequeo `bot_off` en `runConversation` (junto al de pausa) y en el webhook (`returning` suma `botOff`).
- [ ] **Step 4:** `npx vitest run` → PASS.
- [ ] **Step 5: commit** `feat: contacts can need attention with the bot off`

### Task 2: El bot distingue venta de atención

**Files:** Modify `crm/src/bot/faq/{types,router,turn,answers,scope}.ts`, `crm/src/bot/tools.ts`, `crm/src/bot/reply.ts`, `crm/src/bot/try-agent.ts`, `crm/eval/router.eval.ts`. Tests: `router.test.ts`, `turn.int.test.ts`, `answers.int.test.ts`, `reply.int.test.ts`, `try-agent.int.test.ts`.

**Interfaces:**
- Consumes: `requestAttention` (Task 1).
- Produces: `FaqName` suma `"attention"`; `FaqAnswer = string | { text: string; attention: string }` (reemplaza `handoff` del objeto); `answerTurn` input suma `doAttention: (reason: string) => Promise<void>`; `TurnResult` suma `attention: boolean`; `ToolOptions` suma `onAttention?: () => void`; `onAdmin` kind suma `"attention"`.

- [ ] **Step 1: failing tests**
  - router: tool `attention` con `reason` (1..300); lista de tools ordenada la incluye; instrucciones: `handoff` = "quiere comprar, pagar o reservar sin decir cantidad"; `attention` = "reclamo o pide hablar con una persona (indicá el motivo)".
  - answers: presupuesto con cantidad > stock → `{ text: fill("quote_short"), attention: "Pidió … no hay stock suficiente." }`.
  - turn: `attention` del router → `doAttention(reason)` llamado, `doHandoff` no, `path "handoff"`, `attention: true`, texto `fill("handoff")`; presupuesto sin stock → `doAttention`; Postventa: `attention` permitido, `handoff` → complex.
  - tools: `attention_to_admin({reason})` llama `requestAttention` (no `handOff`), en dryRun llama `onAdmin("attention", reason)` y no escribe.
  - reply: `runConversation` con router `attention` → contacto sigue en `consulta`, `bot_off` true, admin notificado con "necesita atención".
  - try-agent: atención en dry run → `adminNote` "(el bot avisaría al admin que necesita atención: <motivo>)", sin escribir.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3: implement.** `scope.ts`: Postventa cambia `handoff` por `attention`. `mark_faq` sin cambios (atención no es aprendible).
- [ ] **Step 4:** `npx vitest run` → PASS; eval: `"mi envio no llego"`, `"quiero hablar con una persona"`, `"mi pedido llego mal"`, `"el paquete nunca me llego"`, `"mi pedido llego roto"` → `attention`; pagos/compras siguen `handoff`. `OLLAMA_URL=http://localhost:11434/v1 npm run eval:router` ≥ 80%.
- [ ] **Step 5: commit** `feat: hand complaints and stock shortfalls to a person without a sale`

### Task 3: Botones del tablero

**Files:** Modify `crm/src/app/t/[slug]/page.tsx`, `actions.ts`, `close-contact-button.tsx`, `reactivate-button.tsx`, `crm/src/contacts/contacts.ts` (`closeContact`), `crm/src/app/globals.css`. Create `crm/src/app/t/[slug]/stage-button.tsx`, `bot-toggle.tsx`. Test: `crm/src/contacts/contacts.int.test.ts` (o el int test existente de contactos), `crm/e2e/board.spec.ts`.

**Interfaces:** Consumes `setBotOff`, `BoardContact` (Task 1), `changeStage` (existe). Produces `setBotOffAction(slug, contactId, off: boolean)`.

- [ ] **Step 1: failing tests**
  - `closeContact` acepta `venta`; con pedido pendiente → `fail("HAS_PENDING_ORDER", "Entregá o cancelá el pedido antes de cerrar")`.
  - E2E (board.spec): Consulta sin `<select>` y con "Pasar a Venta" que la mueve; Venta sin `<select>`, con × (confirmación) y "Volver a Consulta"; Postventa con `<select>` y "Desactivar bot" ↔ "Activar bot"; tarjeta con `attention_reason` muestra el motivo, tiene clase `attention` y "Reactivar bot" la limpia. (El "Editar pedido" de Venta se prueba en Task 5.)
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3: implement.** `StageButton({ slug, contactId, name, to: "venta" | "consulta" })` con texto "Pasar a Venta"/"Volver a Consulta" y `aria-label` con el nombre. `BotToggle` en Postventa. "Reactivar bot" si `paused || botOff`. Rojo: `.card.attention` (borde y fondo de `--danger` suaves) + `<p class="card-attention">Necesita atención: <motivo></p>`. × en Venta con `confirm()` nativo.
- [ ] **Step 4:** `npx vitest run`, `npx playwright test e2e/board.spec.ts` → PASS; captura de pantalla para revisión visual.
- [ ] **Step 5: commit** `feat: board actions per stage instead of the stage selector`

### Task 4: `updateOrder`

**Files:** Modify `crm/src/orders/orders.ts`. Test: `crm/src/orders/orders.int.test.ts`.

**Interfaces — Produces:** `updateOrder(tenantId: string, id: string, input: unknown): Promise<Result<OrderView>>`; input = `orderInput` sin `contactId` (`orderInput.omit({ contactId: true })`).

- [ ] **Step 1: failing tests** — edita fecha/dirección/notas; cambiar cantidad 3→1 devuelve 2 al stock; cambiar producto A→B devuelve A y toma B; sin stock suficiente → `OUT_OF_STOCK` y pedido + stock sin cambios; pedido entregado/cancelado → `fail("VALIDATION", "Ese pedido ya no está pendiente")`; producto con `stock` null no toca stock; total recalculado; otro tenant → `NOT_FOUND`.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3: implement** en una transacción: bloquear el pedido (`for update`), devolver stock de ítems con `stockTaken`, borrar ítems, tomar stock nuevo con la misma lógica que `createOrder` (extraer `takeStock(tx, qty)` y usarla en ambos), insertar ítems, actualizar pedido y total. `OutOfStock` revierte la transacción entera.
- [ ] **Step 4:** `npx vitest run src/orders` → PASS.
- [ ] **Step 5: commit** `feat: edit pending orders with exact stock adjustment`

### Task 5: Editar pedido en la UI y atrasados en rojo

**Files:** Modify `crm/src/app/t/[slug]/order-form.tsx` (modo edición), `order-card.tsx`, `orders-section.tsx`, `page.tsx`, `actions.ts`, `globals.css`. Test: `crm/e2e/orders.spec.ts`.

**Interfaces:** Consumes `updateOrder` (Task 4), `pendingOrderId` (Task 1). Produces `updateOrderAction(slug, id, input)`; `OrderFormButton` acepta `order?: OrderView` (precarga y llama `updateOrderAction`), texto del botón "Editar pedido".

- [ ] **Step 1: failing E2E** — editar un pedido pendiente desde su tarjeta cambia cantidad y total; desde la tarjeta del cliente en Venta aparece "Editar pedido" (no "Crear pedido"); una tarjeta de pedido atrasado tiene clase `overdue` y el texto "Atrasado".
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3: implement.** La página carga el pedido pendiente del contacto desde `pendingOrders` por `pendingOrderId`. Tarjeta atrasada: `order-card overdue` + etiqueta "Atrasado".
- [ ] **Step 4:** `npx playwright test e2e/orders.spec.ts e2e/board.spec.ts`, `npx vitest run`, `npx tsc --noEmit`, `npm run lint` → OK.
- [ ] **Step 5: commit** `feat: edit orders from the board and show overdue ones in red`

### Task 6: Verificación final

- [ ] `npx vitest run`, `npx tsc --noEmit`, `npm run lint`, E2E completos (`npx playwright test`), `git diff | gitleaks detect --pipe`, `npm audit --audit-level=high`.
- [ ] Actualizar `docs/superpowers/specs/2026-11-24-faq-router-design.md` (tabla: `handoff` venta / `attention`).
- [ ] Commit `docs: router spec notes the attention handoff`.
