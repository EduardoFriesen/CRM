# Router: aprendidas, despedidas, estado del pedido y atajos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el router (o una regla, o un atajo guardado) responda despedidas, estado del pedido y respuestas aprendidas, y que el sistema guarde como atajo lo que el modelo pesado marca como resoluble por una función barata.

**Architecture:** El turno pasa a ser `prefilter → atajo exacto → router → pesado` (`crm/src/bot/faq/turn.ts`), con camino barato en Consulta y Postventa. Las respuestas salen siempre de `answerFaq` (datos reales + plantillas). Los atajos viven en una tabla nueva `router_examples` (RLS) y los escribe la herramienta `mark_faq` del pesado.

**Tech Stack:** Next.js + TypeScript estricto, Vercel AI SDK v6 (`ai`), Drizzle + Postgres (RLS con `withTenant`), Zod, Vitest (`*.int.test.ts` contra la DB de test), eval con Ollama.

**Spec:** `docs/superpowers/specs/2026-11-25-router-learning-design.md`

Todos los comandos se corren desde `crm/`. Tests: `npx vitest run <archivo>`. Suite: `npx vitest run`. Tipos: `npx tsc --noEmit`. Lint: `npm run lint`.

## Global Constraints

- Etapas con camino barato: Consulta y Postventa. Venta → pesado.
- Postventa permite solo: `order_status`, `hours`, `location`, `payment_methods`, `shipping`, `greeting`, `farewell`, `learned`, `handoff`, `unclear`. Consulta permite todo menos `order_status`.
- Funciones aprendibles (atajos): `hours`, `location`, `payment_methods`, `shipping`, `greeting`, `farewell`, `catalog`, `order_status`, `learned`.
- Router: máx. 30 aprendidas (las más recientes, orden de `recentFacts`) y 20 atajos; cada texto recortado a 120 caracteres en el prompt.
- Atajos: tope 200 por negocio (se borran los más viejos); no se guardan mensajes de más de 12 palabras ni vacíos; nada se guarda en `dryRun`.
- Ninguna plantilla nueva muestra precio, stock ni datos de otro cliente. Todo acceso a datos con `withTenant`.
- Fechas de pedidos en `America/Argentina/Buenos_Aires`, formato "viernes 28/11".
- Plantillas en rioplatense con voseo; textos fijados abajo donde el spec los fija.
- Commits Conventional (`feat:`, `test:`, `fix:`), terminando con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Aprendida parecida pero distinta** ("¿hacen factura A?" vs aprendida "¿hacen factura B?"): debe ir al pesado, no contestar la otra. → caso en eval (Task 8) y test de `n` fuera de rango (Task 3).
2. **Reclamo en Postventa** ("mi pedido llegó roto"): `handoff`, nunca `order_status`. → caso en eval (Task 8).
3. **Atajo cuya función ya no tiene datos** (se vació el horario, se borró la aprendida): no responder vacío, seguir al router. → test en Task 5.
4. **Atajo de `order_status` que matchea en Consulta**: no se usa (no permitido en la etapa), sigue al router. → test en Task 5.
5. **"chau" repetido**: segunda despedida seguida → silencio, sin loop. → test en Task 1.

---

### Task 1: Despedidas (`farewell`)

**Files:**
- Modify: `crm/src/bot/faq/types.ts`, `crm/src/bot/faq/rules.ts`, `crm/src/bot/faq/prefilter.ts`, `crm/src/bot/faq/templates.ts`, `crm/src/bot/faq/answers.ts`, `crm/src/bot/faq/router.ts`, `crm/src/bot/faq/turn.ts`
- Test: `crm/src/bot/faq/prefilter.test.ts`, `crm/src/bot/faq/router.test.ts`, `crm/src/bot/faq/templates.test.ts`, `crm/src/bot/faq/answers.int.test.ts`, `crm/src/bot/faq/turn.int.test.ts`

**Interfaces:**
- Produces: `FaqName` incluye `"farewell"`; `TemplateKey` incluye `"farewell"`; `export const FAREWELL: RegExp` en `rules.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// prefilter.test.ts
it("answers a bare farewell without the router", () => {
  for (const t of ["chau", "Chau!!", "gracias, chau", "hasta luego", "nos vemos 👋", "adiós", "saludos", "ok dale, hasta mañana"]) {
    expect(prefilter(t, null), t).toEqual({ kind: "faq", fn: "farewell", args: {} });
  }
  expect(prefilter("buenas noches", null)).toMatchObject({ fn: "greeting" });
});
it("a second farewell in a row is silenced", () => {
  for (const v of TEMPLATES.farewell) expect(prefilter("chau", v)).toEqual({ kind: "silence" });
});
it("a farewell with a question is not a bare farewell", () => {
  expect(prefilter("chau, mañana abren?", null)).not.toMatchObject({ fn: "farewell" });
});

// templates.test.ts
it("farewell thanks the customer", () => {
  expect(TEMPLATES.farewell).toEqual([
    "¡Gracias por escribirnos! Cualquier cosa, acá estamos.",
    "¡Un gusto! Cuando necesites, escribinos.",
  ]);
});

// answers.int.test.ts: agregar "farewell" al loop de "unclear, greeting and handoff always answer".
// router.test.ts: agregar "farewell" a la lista ordenada de tools.

// turn.int.test.ts
it("a farewell on first contact sends only the farewell, no introduction", async () => {
  const t = await makeTenant();
  const r = await answerTurn(t.id, input(customer("chau"), null, { introduce: true, pick: () => 0 }));
  expect(r).toMatchObject({ path: "prefilter", fn: "farewell", text: fill("farewell", {}, () => 0) });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/bot/faq` — Expected: FAIL en los tests nuevos.

- [ ] **Step 3: Implement**

- `rules.ts`: `FAREWELL` con el mismo `SEP` que `GREETING`; palabras `chau|chao|adios|hasta luego|hasta manana|nos vemos|saludos`, cortesías opcionales `gracias|muchas gracias|ok|dale|listo` en cualquier posición, y al menos una palabra de despedida (no basta "ok").
- `prefilter.ts`: después del chequeo de saludo, si todas las líneas no vacías matchean `FAREWELL` → si `lastBotText` es exactamente una variante de `TEMPLATES.farewell` (trim), `silence`; si no, `farewell`. Importa `TEMPLATES`.
- `router.ts`: tool `farewell: none`, descripción "The message is only a goodbye, with no question or request."; línea de instrucciones "- farewell: el mensaje es SOLO una despedida (chau, hasta luego). Si además pregunta o pide algo, no es farewell."
- `answers.ts`: `case "farewell"` junto a `greeting`.
- `turn.ts`: con `introduce`, `farewell` devuelve solo `answer` (sin intro). `greeting`/`unclear` siguen devolviendo solo la intro.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/bot` — Expected: PASS.

- [ ] **Step 5: Commit** — `feat: answer farewells with a rule or the router`

---

### Task 2: Estado del pedido (`order_status`) y router en Postventa

**Files:**
- Modify: `crm/src/bot/faq/types.ts`, `crm/src/bot/faq/templates.ts`, `crm/src/bot/faq/answers.ts`, `crm/src/bot/faq/router.ts`, `crm/src/bot/faq/turn.ts`, `crm/src/bot/reply.ts`, `crm/src/bot/try-agent.ts`
- Test: `crm/src/bot/faq/answers.int.test.ts`, `crm/src/bot/faq/turn.int.test.ts`, `crm/src/bot/faq/router.test.ts`

**Interfaces:**
- Produces:
  - `answerFaq(tenantId: string, call: FaqCall, pick?: () => number, contactId?: string): Promise<FaqAnswer | null>` (nuevo 4.º parámetro).
  - `answerTurn` input suma `contactId: string`.
  - `export function allowedIn(stage: Stage, fn: string): boolean` en `turn.ts`.
  - `export function customerBlock(turns: HistoryTurn[]): string` en `turn.ts` (texto del cliente posterior al último turno no-`user`, unido con `\n`; lo usa también Task 6).

- [ ] **Step 1: Write the failing tests**

```ts
// answers.int.test.ts (crear pedidos con createOrder o insert vía ownerSql; contacto con makeContact)
it("order_status answers the nearest pending order of that contact", ...);
//   dos pending (28/11 y 05/12) + uno cancelled más nuevo → texto contiene "28/11" y la dirección;
//   expect(out).toBe(fill("order_pending", { date: "viernes 28/11", address: "Av. Siempre Viva 123" }, () => 0))
it("order_status falls back to the latest delivered order", ...);   // contiene la fecha de delivered_at
it("order_status is null without pending or delivered orders, or for another contact's orders", ...);

// turn.int.test.ts
it("in postventa the router answers order status", ...);           // stage "postventa", routerFor("order_status", {}) → path "faq", fn "order_status"
it("in postventa a product question goes to the main model", ...);  // routerFor("price", {product:"pan"}) → path "complex", runComplex llamado
it("in consulta order_status goes to the main model", ...);
it("venta always goes to the main model", ...);                     // stage "venta", router no se llama
```

Plantillas exactas:
- `order_pending: ["Tu pedido está confirmado para el {date}, con entrega en {address}."]`
- `order_delivered: ["Tu pedido se entregó el {date}."]`

- [ ] **Step 2: Run to verify they fail** — `npx vitest run src/bot/faq` → FAIL.

- [ ] **Step 3: Implement**

- `answers.ts`: `case "order_status"` → `answerOrder(tenantId, contactId, pick)`; sin `contactId` → `null`. Query con `withTenant` sobre `orders` filtrando `contactId` y `status in ('pending','delivered')`; elige el `pending` de `deliveryDate` más próxima, si no el `delivered` de `deliveredAt` más reciente. Fecha con `Intl.DateTimeFormat("es-AR", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: "America/Argentina/Buenos_Aires" })` → "viernes 28/11" (quitar la coma que agrega Intl). `deliveryDate` es `date` (string `YYYY-MM-DD`): construirla al mediodía UTC para no correr el día.
- `router.ts`: tool `order_status: none`, descripción "The customer asks when their order arrives, where it is or its status (not a complaint)."; instrucción "- order_status: pregunta cuándo llega, dónde está o en qué estado está SU pedido. Un reclamo (llegó mal, no llegó, falta algo) es handoff."
- `turn.ts`: reemplazar `if (input.stage !== "consulta") return complex(base)` por: Venta → complex; el resultado del prefilter o del router que no pase `allowedIn(stage, fn)` → complex (conservando `routerModel`/`routerUsage`). Pasar `input.contactId` a `answerFaq`. Extraer `customerBlock`.
- `reply.ts` (`runConversation`) y `try-agent.ts`: pasar `contactId` (`try-agent` pasa `""`).

- [ ] **Step 4: Run** — `npx vitest run` → PASS (ajustar llamadas existentes a `answerTurn` en tests con `contactId`).

- [ ] **Step 5: Commit** — `feat: answer order status in postventa from the customer's orders`

---

### Task 3: Respuestas aprendidas en el router (`learned`)

**Files:**
- Modify: `crm/src/facts/facts.ts`, `crm/src/bot/faq/types.ts`, `crm/src/bot/faq/templates.ts`, `crm/src/bot/faq/answers.ts`, `crm/src/bot/faq/router.ts`, `crm/src/bot/faq/turn.ts`
- Test: `crm/src/bot/faq/router.test.ts`, `crm/src/bot/faq/answers.int.test.ts`, `crm/src/bot/faq/turn.int.test.ts`

**Interfaces:**
- Produces:
  - `recentFacts(tenantId)` devuelve `{ id: string; question: string; answer: string }[]` (mismo orden).
  - `export const ROUTER_FACTS = 30` en `router.ts`.
  - `routeMessage(model, turns, ctx?: { facts?: { question: string }[]; examples?: RouterExample[] })` (`RouterExample` lo define Task 4; en esta task el parámetro `examples` puede no existir todavía).
  - `FaqArgs` suma `n?: number` (del router) y `factId?: string` (resuelto por el turno).
  - Plantilla `learned: ["{answer}"]`.

- [ ] **Step 1: Write the failing tests**

```ts
// router.test.ts
it("offers learned only when there are facts, numbered in the prompt", async () => {
  const none = new MockLanguageModelV4({ doGenerate: call("hours", {}) });
  await routeMessage(none, turns(1));
  expect(none.doGenerateCalls[0].tools?.map((t) => t.name)).not.toContain("learned");
  const some = new MockLanguageModelV4({ doGenerate: call("learned", { n: 2 }) });
  const r = await routeMessage(some, turns(1), { facts: [{ question: "¿Hacen factura A?" }, { question: "¿Tienen estacionamiento?" }] });
  expect(r.call).toEqual({ fn: "learned", args: { n: 2 } });
  const sys = some.doGenerateCalls[0].prompt.filter((m) => m.role === "system").map((m) => m.content).join("");
  expect(sys).toContain("1. ¿Hacen factura A?");
  expect(sys).toContain("2. ¿Tienen estacionamiento?");
});
it("learned with n out of range falls back to complex", async () => {
  const m = new MockLanguageModelV4({ doGenerate: call("learned", { n: 3 }) });
  expect((await routeMessage(m, turns(1), { facts: [{ question: "a" }, { question: "b" }] })).call.fn).toBe("complex");
});
it("sends at most 30 facts", ...); // 35 facts → el prompt contiene "30." y no "31."

// answers.int.test.ts
it("learned answers the admin's answer verbatim", ...);   // fact creado vía answerEscalation o insert → answerFaq({fn:"learned", args:{factId}}) === answer
it("learned is null for a deleted or unknown fact", ...);

// turn.int.test.ts
it("the router's learned number maps to the fact id", ...); // dos facts; routerFor("learned",{n:1}) → text = respuesta del fact más reciente
```

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement**

- `router.ts`: schema `learned: z.object({ n: z.number().int().min(1) })`; la tool se incluye solo si `ctx.facts?.length`; el rango se valida después del parse (`n <= facts.length`, si no `COMPLEX`). Sección del prompt: `Preguntas ya respondidas por el negocio:` + `n. <pregunta recortada a 120>`; instrucción "- learned: el cliente pregunta lo mismo que una de las preguntas ya respondidas (aunque con otras palabras); indicá su número. Si no es claramente la misma, no la elijas."
- `turn.ts`: carga `recentFacts(tenantId)` y pasa los primeros `ROUTER_FACTS` a `routeMessage`; si el router devuelve `learned`, arma `{ fn: "learned", args: { factId: facts[n-1].id } }`.
- `answers.ts`: `case "learned"` → busca el fact por `factId` con `withTenant`; `fill("learned", { answer })` o `null`.

- [ ] **Step 4: Run** — `npx vitest run` → PASS. Verificar que el test "sends only the last 3 turns and no business data" (prompt < 1500 sin facts) sigue verde.

- [ ] **Step 5: Commit** — `feat: answer learned questions from the router`

---

### Task 4: Tabla y módulo de atajos (`router_examples`)

**Files:**
- Modify: `crm/src/db/schema.ts`
- Create: `crm/drizzle/00NN_router_examples.sql` (vía `npm run db:generate`), `crm/drizzle/00NN_router_examples_rls.sql` (vía `npx drizzle-kit generate --custom --name router_examples_rls`), `crm/src/bot/faq/examples.ts`
- Test: `crm/src/bot/faq/examples.int.test.ts`, `crm/src/bot/faq/examples.test.ts`

**Interfaces:**
- Produces (en `examples.ts`):
  - `export const LEARNABLE = ["hours","location","payment_methods","shipping","greeting","farewell","catalog","order_status","learned"] as const; export type Learnable = (typeof LEARNABLE)[number];`
  - `export type RouterExample = { id: string; text: string; fn: Learnable; factId: string | null; createdAt: Date };`
  - `export function exampleKey(text: string): string` — `plain`, puntuación/símbolos/emojis → espacio, espacios colapsados, trim.
  - `export async function saveExample(tenantId: string, e: { text: string; fn: Learnable; factId?: string | null }): Promise<boolean>` — `false` si la clave está vacía o tiene más de 12 palabras; upsert por `(tenant_id, key)`; después borra los que excedan 200 (los más viejos).
  - `export async function findExample(tenantId: string, text: string): Promise<RouterExample | null>`
  - `export async function recentExamples(tenantId: string, limit = 20): Promise<RouterExample[]>`
  - `export async function deleteExample(tenantId: string, id: string): Promise<Result<{ id: string }>>` — id validado con Zod uuid, como `deleteFact`.

Tabla (ver spec): `id uuid pk`, `tenant_id` fk cascade, `key text not null`, `text text not null` (recortado a 200), `fn text not null`, `fact_id uuid` fk `business_facts` `on delete cascade`, `created_at timestamptz default now()`, `unique(tenant_id, key)`. RLS igual que `0024_bot_events_rls.sql` y `GRANT SELECT, INSERT, UPDATE, DELETE ON "router_examples" TO crm_app;`.

- [ ] **Step 1: Write the failing tests**

```ts
// examples.test.ts
it("normalizes case, accents, punctuation and emojis", () => {
  expect(exampleKey("¿A qué HORA abren?? 😊")).toBe("a que hora abren");
});

// examples.int.test.ts
it("saves and finds by normalized text", ...);           // save "A qué hora abren?" → findExample("a que hora abren") no null
it("the last mark wins for the same text", ...);         // dos saves mismo texto distinta fn → una fila, fn la última
it("does not save long or empty messages", ...);         // 13 palabras → false; "👍" → false
it("keeps at most 200 per tenant, dropping the oldest", ...);
it("deleting a fact deletes its examples", ...);
it("is private to each tenant", ...);
it("deleteExample rejects a non-uuid", ...);
```

- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** schema + migraciones (`npm run db:generate`, luego la custom de RLS) + `examples.ts`. Aplicar a la DB de test como hace el setup existente (`src/test/global-setup.ts`).
- [ ] **Step 4: Run** — `npx vitest run src/bot/faq/examples*` → PASS.
- [ ] **Step 5: Commit** — `feat: router_examples table with RLS and its module`

---

### Task 5: Usar los atajos en el turno (coincidencia exacta y guía del router)

**Files:**
- Modify: `crm/src/db/schema.ts` (`BOT_PATHS` suma `"example"`), nueva migración `ALTER TYPE "bot_path" ADD VALUE 'example'` (vía `db:generate`), `crm/src/bot/faq/turn.ts`, `crm/src/bot/faq/router.ts`, `crm/src/usage/last-answer.ts`
- Test: `crm/src/bot/faq/turn.int.test.ts`, `crm/src/bot/faq/router.test.ts`, `crm/src/usage/last-answer.test.ts`

**Interfaces:**
- Consumes: `findExample`, `recentExamples`, `RouterExample` (Task 4); `allowedIn` (Task 2).

- [ ] **Step 1: Write the failing tests**

```ts
// turn.int.test.ts
it("an exact example answers without the router", ...);  // saveExample hours + perfil con horario; router mock → path "example", fn "hours", router.doGenerateCalls.length 0
it("an example whose function has no data falls through to the router", ...); // horario vacío → se llama al router
it("an example not allowed in the stage falls through to the router", ...);   // order_status en consulta
it("a learned example answers its fact", ...);
// router.test.ts
it("lists the tenant's examples as guidance", ...);      // examples [{text:"a que hora cierran", fn:"hours"}] → sys contiene '"a que hora cierran" → hours'
// last-answer.test.ts
it("calls an example a shortcut", () => expect(describeAnswerer(e("example", null, null))).toBe("Atajo (sin IA)"));
```

- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement**
- `turn.ts`: después del prefilter y antes del router, `findExample(tenantId, customerBlock(turns))`; si existe y `allowedIn(stage, fn)`, `answerFaq` (para `learned`, `args.factId = example.factId`); texto no nulo → `path: "example"`. Si no, sigue. Pasa `recentExamples(tenantId)` a `routeMessage`.
- `router.ts`: sección `Ejemplos de este negocio:` con `"<texto recortado a 120>" → <fn>`; un ejemplo `learned` se muestra como `→ learned <n>` solo si su `factId` está entre los facts enviados, si no se omite.
- `last-answer.ts`: `example` → `"Atajo (sin IA)"`.
- [ ] **Step 4: Run** — `npx vitest run` → PASS.
- [ ] **Step 5: Commit** — `feat: answer saved shortcuts without a model and guide the router with them`

---

### Task 6: Herramienta `mark_faq` del modelo pesado

**Files:**
- Modify: `crm/src/bot/tools.ts`, `crm/src/bot/prompt.ts`, `crm/src/bot/reply.ts`
- Test: `crm/src/bot/tools.int.test.ts` (crear si no existe), `crm/src/bot/prompt.test.ts` (o el test existente de prompt)

**Interfaces:**
- Consumes: `saveExample`, `LEARNABLE` (Task 4); `answerFaq` (Task 2); `customerBlock` (Task 2); `recentFacts` con id (Task 3).
- Produces: `ToolOptions` suma `customerText?: string`, `facts?: { id: string }[]`, `stage?: Stage`.

- [ ] **Step 1: Write the failing tests**

```ts
it("mark_faq saves the customer's message as a shortcut when the function can answer", ...); // perfil con horario; execute({fn:"hours"}) → findExample(customerText) fn "hours"
it("mark_faq does not save when the function has no data", ...);
it("mark_faq maps fact n to the fact id", ...);            // facts [{id:A},{id:B}], fact: 2 → factId B
it("mark_faq saves nothing in dry run", ...);
it("mark_faq always answers ok to the model", ...);        // también con fn inválida para la etapa
it("numbers learned answers in the system prompt", ...);  // buildSystemPrompt({facts:[...]}) contiene "- [1] P:"
```

- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement**
- `tools.ts`: tool `mark_faq`, input `z.object({ fn: z.enum(LEARNABLE), fact: z.number().int().min(1).optional() })`, descripción exacta del spec ("Si el ÚLTIMO mensaje del cliente se respondía solo con horarios, dirección, medios de pago, envíos, un saludo, una despedida, el catálogo, el estado de su pedido o una respuesta aprendida (fact = su número), llamala además de responder. Si hacía falta algo más, no la llames."). `execute`: en `dryRun` o sin `customerText` → `{ ok: true }`; `learned` sin fact válido → no guarda; verifica `answerFaq(tenantId, call, undefined, contactId) !== null` y `allowedIn(stage, fn)`; guarda; errores atrapados (registrar con `console.error` de un código, nunca texto) → `{ ok: true }`.
- `prompt.ts`: `factsSection` numera `- [n] P: … R: …` (1-based, orden de entrada).
- `reply.ts`: pasa `customerText: customerBlock(conv.recent.map(toTurn))`, `facts`, `stage` a `makeTools`.
- [ ] **Step 4: Run** — `npx vitest run` → PASS.
- [ ] **Step 5: Commit** — `feat: let the main model mark cheap questions as shortcuts`

---

### Task 7: Pantalla "Atajos del bot"

**Files:**
- Modify: `crm/src/app/t/[slug]/aprendido/page.tsx`, `crm/src/app/t/[slug]/aprendido/actions.ts`, `crm/src/app/t/[slug]/aprendido/loading.tsx`, `crm/src/app/globals.css` (solo si hace falta)
- Create: `crm/src/app/t/[slug]/aprendido/delete-example-button.tsx`
- Test: `crm/e2e/` (spec Playwright existente del área, si hay) o test de la acción

**Interfaces:**
- Consumes: `recentExamples(tenantId, 200)`, `deleteExample` (Task 4).
- Produces: `deleteExampleAction(slug: string, id: string): Promise<Result<{ id: string }>>`.

Nombres de función en castellano: `hours` Horarios, `location` Dirección, `payment_methods` Medios de pago, `shipping` Envíos, `greeting` Saludo, `farewell` Despedida, `catalog` Catálogo, `order_status` Estado del pedido, `learned` Respuesta aprendida.

- [ ] **Step 1:** Test de la acción: borrar un atajo propio → `success`; id de otro negocio → `NOT_FOUND`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Sección `<section aria-labelledby="examples-title">` "Atajos del bot (N)" debajo de "Datos aprendidos": lista (mensaje, función, `relativeTime`) con botón Borrar (patrón de `DismissButton`, `aria-label="Borrar atajo: <mensaje>"`). Vacío: "Todavía no hay atajos: aparecen cuando el bot detecta preguntas frecuentes." Loading: skeleton en `loading.tsx`. Error: `error.tsx` existente.
- [ ] **Step 4:** Run tests + `npx tsc --noEmit` + `npm run lint` → OK. Revisión visual con `docker compose up -d --build crm` o dev server.
- [ ] **Step 5: Commit** — `feat: show and delete bot shortcuts on the learned page`

---

### Task 8: Eval, spec y verificación final

**Files:**
- Modify: `crm/eval/router.eval.ts`, `docs/superpowers/specs/2026-11-24-faq-router-design.md` (tabla de funciones)

- [ ] **Step 1:** Casos de eval. `Case` suma `facts?: { question: string }[]`; `route()` los pasa a `routeMessage`. Casos:
  - `"chau, gracias"` → `farewell`; `"bueno me voy, hasta la proxima"` → `farewell`
  - `"cuando me llega el pedido?"` → `order_status`; `"mi pedido llego roto"` → `handoff`
  - con `facts: [{question:"¿Hacen factura A?"},{question:"¿Tienen estacionamiento?"}]`: `"emiten factura a?"` → `learned`; `"hay lugar para estacionar?"` → `learned`; `"hacen factura B?"` → `complex`
- [ ] **Step 2:** `OLLAMA_URL=http://localhost:11434/v1 npm run eval:router` ≥ 80% y sin regresiones frente a 95% actual (los fallos previos "eso"/"y de ese?" no cuentan).
- [ ] **Step 3:** Agregar `farewell`, `order_status`, `learned` y el paso de atajos a la tabla del spec del router.
- [ ] **Step 4:** `npx vitest run`, `npx tsc --noEmit`, `npm run lint`, `git diff main | gitleaks detect --pipe`, `npm audit --audit-level=high` → todo OK.
- [ ] **Step 5: Commit** — `test: router eval cases for farewells, order status and learned answers`
