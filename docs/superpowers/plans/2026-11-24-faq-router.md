# FAQ Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Answer frequent customer questions with a zero-token pre-filter or one small router call plus templates, keep the current bot for everything else with a leaner prompt, and measure tokens per path.

**Architecture:** `runConversation` keeps all its guards; the text is produced by a new `answerTurn` pipeline (pre-filter → router → FAQ answer or complex path). Business info moves to its own table edited in a new Configuración › Negocio sub-tab. Every turn writes a `bot_events` row that a CLI script aggregates.

**Tech Stack:** Next.js (read `node_modules/next/dist/docs/` before touching routes), TypeScript strict, Drizzle + Postgres RLS, Vercel AI SDK `ai@7` (`MockLanguageModelV4` from `ai/test` for tests), Zod, Vitest (`*.test.ts` unit, `*.int.test.ts` with DB), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-24-faq-router-design.md`

## Global Constraints

- All commands run from `crm/`. Per task: `npm test`, `npm run lint`, `npm run typecheck` green before the commit.
- Code and commit messages in English; customer-facing text in rioplatense Spanish with voseo.
- Never state stock quantities: only "disponible" / "sin stock".
- Empty (or whitespace-only) business field ⇒ no template ⇒ complex path.
- alias / CBU / CVU / "te transfiero" / "cómo pago" ⇒ handoff, never `payment_methods`.
- Router and templates only when the contact's stage is `consulta`.
- Router: tools without `execute`, `toolChoice: "required"`, `maxOutputTokens: 200`, `maxRetries: 0`, one step, last 3 turns, no catalog/business info/facts.
- Complex path: history 6 (was 20), facts max 3000 chars (was 8000), `isStepCount(3)` (was 4).
- `bot_events` never stores message text, phones or keys. Test chat writes no events.
- New tables: RLS `tenant_isolation` policy + grants to `crm_app`, same as `drizzle/0016_ai_usage_rls.sql`.
- `agent_configs.business_info` stays in the database but leaves the Drizzle schema and the app.
- Conventional Commits; one logical change per commit; branch `feat/faq-router`.

## Review Focus

1. A debounced batch mixing a trivial and a real message ("gracias\ny cuánto sale el pan?") must reach the router, not be silenced → Task 4 test.
2. A customer in Postventa asking a price must go to the complex path (so `set_stage` can reopen) → Task 8 test.
3. The admin writes while a template answer is being prepared: the template must not be sent → Task 8 test.
4. Router returns a known tool with invalid args (`price` with empty `product`) or an unknown tool ⇒ complex path, not a crash → Task 6 test.
5. A price search matching more than 3 products, some with stock 0, lists 3, says "sin stock" where it applies and never a number of units → Task 5 test.

---

### Task 1: Business profile table and router model column

**Files:**
- Modify: `src/db/schema.ts` (add `businessProfiles`, `botEvents` comes in Task 7; add `routerModel` to `agentConfigs`; remove `businessInfo` from `agentConfigs`)
- Create: `drizzle/0021_business_profiles.sql` (generated with `npm run db:generate`, then append the copy statement), `drizzle/0022_business_profiles_rls.sql` (hand-written, register in `drizzle/meta/_journal.json` like 0016)
- Create: `src/business/profile.ts`
- Test: `src/business/profile.int.test.ts`

**Interfaces:**
- Produces:
  - `type BusinessProfile = { hours: string; address: string; paymentMethods: string; shipping: string; other: string }`
  - `getBusinessProfile(tenantId: string): Promise<BusinessProfile>` — all `""` when no row.
  - `saveBusinessProfile(tenantId: string, input: unknown): Promise<Result<BusinessProfile>>` — Zod: each field trimmed, max 1000, `other` max 8000; error message "Revisá la información del negocio" with field errors.
  - `agentConfigs.routerModel: text("router_model")` nullable.

- [ ] **Step 1: Write failing tests** in `profile.int.test.ts`:
  - `returns empty fields when nothing is saved` → `toEqual({ hours: "", address: "", paymentMethods: "", shipping: "", other: "" })`
  - `saves and trims` → save `{ hours: "  Lun a vie 9 a 18  " }` then get `.hours === "Lun a vie 9 a 18"`
  - `rejects a field over 1000 chars` → `success === false`, `error.details.hours` defined
  - `is private to each tenant` → b's save not visible from a
  - `migration copied business_info into other` → insert via `ownerSql` an `agent_configs` row is not possible after the column leaves the schema; instead assert the SQL file `0021_business_profiles.sql` contains `INSERT INTO "business_profiles"` … `SELECT` … `"business_info"` (read with `fs`).
- [ ] **Step 2: Run** `npx vitest run src/business/profile.int.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement** schema, migrations and `profile.ts`. Copy statement appended to 0021: `INSERT INTO "business_profiles" ("tenant_id","other") SELECT "tenant_id","business_info" FROM "agent_configs" WHERE "business_info" <> '' ON CONFLICT DO NOTHING;`. The generated 0021 must NOT drop `business_info`: delete that line if drizzle emits it. Upsert with `onConflictDoUpdate` on `tenant_id`, `updated_at = now()`.
- [ ] **Step 4: Run** `npm run db:migrate && npx vitest run src/business src/db` → PASS (RLS test in `src/db/rls.int.test.ts` still green; add `business_profiles` to its table list if it enumerates tables).
- [ ] **Step 5: Commit** `feat: store business info in its own table`

### Task 2: Agent config without business info, with router model; split cached prompt

**Files:**
- Modify: `src/agent/config.ts` (drop `businessInfo` from `AgentView`, `AgentRuntime`, `agentInput`, `toView`; add `routerModel: string | null` — input `z.string().trim().max(100).optional()`, `""` ⇒ `null`)
- Modify: `src/agent/model.ts` (`MODEL_SUGGESTIONS` unchanged; add `ROUTER_SUGGESTIONS: Record<Provider, string[]>` = anthropic `["claude-haiku-5-5"]`, google `["gemini-3.5-flash-lite"]`, openai `["gpt-4.1-mini"]`, others `[]`)
- Modify: `src/bot/prompt.ts`, `src/bot/reply.ts`, `src/bot/try-agent.ts`
- Test: `src/bot/prompt.test.ts`, `src/agent/config.int.test.ts`, `src/bot/reply.int.test.ts`

**Interfaces:**
- Consumes: `BusinessProfile`, `getBusinessProfile` (Task 1).
- Produces:
  - `PromptInput` replaces `businessInfo: string` with `business: BusinessProfile` and adds `cache: boolean`.
  - `buildSystemPrompt(p: PromptInput): SystemModelMessage[]` — `[fixed, dynamic]`. `fixed` = current rules minus date/stage/introduce lines + the `<negocio>` fence with lines `Horarios:`, `Dirección:`, `Medios de pago:`, `Envíos:`, `Otros:` (each `asData`, empty ⇒ `(sin cargar)`) + facts. When `cache`, `fixed.providerOptions = { anthropic: { cacheControl: { type: "ephemeral" } } }`. `dynamic` = date/time, stage, introduce lines.
  - `type TurnUsage = { inputTokens: number; outputTokens: number; cachedTokens: number }` exported from `reply.ts`.
  - `generateAgentText(tenantId, model, args: { system: SystemModelMessage[]; messages: ModelMessage[]; tools: ToolSet }): Promise<{ text: string; usage: TurnUsage }>` — `usage` summed over steps; `cachedTokens` from `step.usage.inputTokenDetails.cacheReadTokens ?? 0`. Uses `instructions` (not deprecated `system`).
  - Constants in `reply.ts`: `HISTORY = 6`, steps `isStepCount(3)`; `FACTS_MAX = 3000` in `prompt.ts`.

- [ ] **Step 1: Write failing tests**
  - prompt: `puts date, stage and introduction in the second message only` → `[fixed, dynamic]`; `fixed.content` doesn't contain "Fecha y hora"; `dynamic.content` does.
  - prompt: `fixed part is identical across calls at different times` → same input, two `now` values ⇒ equal `fixed.content`.
  - prompt: `marks the fixed part for caching only when asked` → `cache: true` ⇒ `providerOptions.anthropic.cacheControl.type === "ephemeral"`; `cache: false` ⇒ `providerOptions` undefined.
  - prompt: `lists each business field and fences them` → contains `Horarios: Lun a vie` and `Envíos: (sin cargar)`; `<x>` in a field becomes `‹x›`.
  - prompt: update existing tests that passed `businessInfo` to pass `business`.
  - config: `saves the router model; blank means none` → `routerModel: ""` ⇒ view `routerModel === null`; `"claude-haiku-5-5"` ⇒ stored.
  - reply: `sends only the last 6 messages to the model` → seed 10 customer/bot turns, assert `model.doGenerateCalls[0].prompt` has ≤ 6 non-system messages.
  - reply: `caches the system prompt for anthropic` → tenant provider `anthropic`; first system message of the prompt carries the anthropic cache providerOptions.
- [ ] **Step 2: Run** `npx vitest run src/bot/prompt.test.ts src/agent src/bot/reply.int.test.ts` → FAIL.
- [ ] **Step 3: Implement.** `cache` = `rt.provider === "anthropic"`. `runConversation`, `relayToCustomer` and `tryAgent` load `getBusinessProfile` and pass `business`. Remove `businessInfo` everywhere `tsc` complains (agent form field goes away in Task 3; until then delete the textarea from `agent-form.tsx` and from `agente/actions.ts`).
- [ ] **Step 4: Run** `npm test && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `refactor: split the system prompt to cache its fixed part and trim history`

### Task 3: Configuración sub-tabs and Negocio form

**Files:**
- Create: `src/app/t/[slug]/configuracion/layout.tsx` (sub-nav: Agente, Tablero, Negocio; `aria-current` like `tenant-nav.tsx`; `<nav aria-label="Secciones de configuración">`)
- Move: `src/app/t/[slug]/agente/*` → `src/app/t/[slug]/configuracion/agente/*`; current `configuracion/page.tsx`, `settings-form.tsx`, `actions.ts`, `loading.tsx`, `error.tsx` → `configuracion/tablero/`
- Create: `configuracion/page.tsx` → `redirect(\`/t/${slug}/configuracion/agente\`)`; `src/app/t/[slug]/agente/page.tsx` → same redirect
- Create: `configuracion/negocio/{page.tsx,business-form.tsx,actions.ts,loading.tsx,error.tsx}`
- Modify: `src/app/t/[slug]/tenant-nav.tsx` (remove "Agente"; "Configuración" is current for any path under `/configuracion`)
- Modify: `configuracion/agente/agent-form.tsx` (add "Modelo rápido" field, `list="router-suggestions"`, hint "Opcional. Clasifica las preguntas frecuentes; vacío usa el modelo principal.")
- Modify: every `revalidatePath`/`href` pointing at `/agente` or `/configuracion`; e2e specs `agent.spec.ts`, `settings.spec.ts`, `agent-ollama.spec.ts`, `usage-nav.spec.ts`
- Test: `e2e/business.spec.ts`

**Interfaces:**
- Consumes: `getBusinessProfile`, `saveBusinessProfile` (Task 1); `routerModel`, `ROUTER_SUGGESTIONS` (Task 2).
- Produces: routes `/t/[slug]/configuracion/{agente,tablero,negocio}`.

- [ ] **Step 1: Write failing E2E** `e2e/business.spec.ts`:
  - `Configuración opens on Agente and shows the three sub-tabs` → visiting `/t/<slug>/configuracion` lands on `/configuracion/agente`; links "Agente", "Tablero", "Negocio" visible; "Agente" has `aria-current="page"`.
  - `old /agente link redirects` → `/t/<slug>/agente` ends on `/configuracion/agente`.
  - `saves business info` → fill Horarios "Lun a vie 9 a 18", Guardar, reload, value persists; status "Información guardada."
  - `shows field error` → 1001 chars in Horarios ⇒ field error visible, `aria-invalid="true"`.
- [ ] **Step 2: Run** `npx playwright test e2e/business.spec.ts` → FAIL.
- [ ] **Step 3: Implement.** Negocio form: five labeled `<textarea>` (Horarios, Dirección, Medios de pago, Envíos, Otros) with hints ("Ej. Lun a vie de 9 a 18, sáb de 9 a 13"); same `useActionState` + `panel`/`field`/`form-actions` classes as the Tablero form. Empty state: intro text "El bot responde horarios, dirección, pagos y envíos con lo que cargues acá. Si un campo queda vacío, consulta al admin." `loading.tsx` skeleton and `error.tsx` copy the existing ones.
- [ ] **Step 4: Run** `npx playwright test` (whole suite, routes moved) → PASS.
- [ ] **Step 5: Commit** `feat: group agent, board and business settings under Configuración`

### Task 4: Pre-filter

**Files:**
- Create: `src/lib/plain.ts` (`plain(text: string): string` — NFD, strip diacritics, lowercase); use it in `src/bot/sensitive-guard.ts` and `src/bot/money-guard.ts`
- Create: `src/bot/faq/types.ts`, `src/bot/faq/rules.ts`, `src/bot/faq/prefilter.ts`
- Test: `src/bot/faq/prefilter.test.ts`, `src/lib/plain.test.ts`

**Interfaces:**
- Produces (`types.ts`):
  - `type FaqName = "price" | "stock" | "hours" | "location" | "payment_methods" | "shipping" | "handoff" | "unclear"`
  - `type FaqArgs = { product?: string; zone?: string; reason?: string }`
  - `type FaqCall = { fn: FaqName; args: FaqArgs }`
  - `type Decision = { kind: "silence" } | ({ kind: "faq" } & FaqCall)`
- Produces (`rules.ts`): `TRIVIAL: RegExp` (whole message, on `plain` text: ok, oka, okey, gracias, muchas gracias, dale, listo, joya, genial, perfecto, buenisimo, 👍, 🙏, 😊, only emojis/punctuation), `RULES: { pattern: RegExp; fn: FaqName }[]` in this order: handoff (alias|cbu|cvu|te transfiero|como (te )?pago), hours (horario|a que hora|abren|cierran), location (direccion|donde (estan|quedan|queda)|ubicacion), payment_methods (medios de pago|aceptan tarjeta|mercado ?pago|efectivo), shipping (envio|envian|delivery|mandan).
- Produces (`prefilter.ts`): `prefilter(text: string, lastBotText: string | null): Decision | null`. `MAX_RULE_WORDS = 8`. Handoff via rule sets `args.reason = "El cliente quiere pagar"`.

- [ ] **Step 1: Write failing tests**
  - `silences trivial messages` → each of `"ok"`, `"Gracias!!"`, `"👍"`, `"dale"` with `lastBotText = "Sale $2.500."` ⇒ `{ kind: "silence" }`
  - `does not silence after a bot question` → `prefilter("dale", "¿Te lo reservo?")` ⇒ `null`
  - `does not silence a batch with a real question` → `prefilter("gracias\ny cuánto sale el pan?", null)` ⇒ `null`
  - `maps obvious questions` → `"a que hora abren?"` ⇒ `{ kind: "faq", fn: "hours", args: {} }`; `"dónde están?"` ⇒ location; `"aceptan mercadopago?"` ⇒ payment_methods; `"hacen envios?"` ⇒ shipping
  - `paying is a handoff, not payment info` → `"pasame el alias"` ⇒ fn `handoff`; `"cbu?"` ⇒ handoff
  - `ignores long messages` → 9+ words containing "horario" ⇒ `null`
  - `plain` → `plain("Ñandú DÓNDE") === "nandu donde"`
- [ ] **Step 2: Run** `npx vitest run src/bot/faq src/lib/plain.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run src/bot src/lib` → PASS (guards still green after using `plain`).
- [ ] **Step 5: Commit** `feat: answer trivial and obvious messages without the model`

### Task 5: Templates and FAQ answers

**Files:**
- Create: `src/bot/faq/templates.ts`, `src/bot/faq/answers.ts`
- Test: `src/bot/faq/templates.test.ts`, `src/bot/faq/answers.int.test.ts`

**Interfaces:**
- Consumes: `FaqCall` (Task 4), `getBusinessProfile` (Task 1), `searchCatalog` (`src/catalog/catalog.ts`, returns `{ name, description, price, availability }[]`, `availability` is `"disponible" | "sin stock"`).
- Produces:
  - `type TemplateKey = "price_one" | "price_many" | "price_more" | "stock" | "hours" | "location" | "payment_methods" | "shipping" | "handoff" | "unclear" | "intro"`
  - `TEMPLATES: Record<TemplateKey, string[]>` (2-3 variants each, `{var}` placeholders)
  - `fill(key: TemplateKey, vars: Record<string, string>, pick: () => number = Math.random): string`
  - `answerFaq(tenantId: string, call: FaqCall, pick?: () => number): Promise<string | null>` — `null` per the spec table. `handoff` returns the handoff template (the caller runs `handOff`). `intro` is used by the caller (Task 8) with `{tenant}`.

- [ ] **Step 1: Write failing tests**
  - templates: `every key has 2 or 3 variants`; `fill replaces all variables` → no `{` left; `pick picks the variant` → `pick = () => 0` and `() => 0.99` give different strings for `hours`.
  - templates: `no template asks for or gives stock numbers` → no variant of `stock`/`price_*` contains `{stock}` or `unidades`.
  - answers: `price of one product` → product "Pan de campo" 2500 ⇒ text contains `Pan de campo` and `$2.500`
  - answers: `lists 3 and offers more when there are more` → 5 matching products, 2 with stock 0 ⇒ 3 names, "sin stock" next to the zero-stock ones among them, `/más opciones/`, no `/\d+\s*unidades/`
  - answers: `stock says only available or not` → stock 7 ⇒ contains "disponible", not "7"
  - answers: `null when no product matches` → `price` "torta" ⇒ `null`
  - answers: `business fields fill their template` → hours "Lun a vie 9 a 18" ⇒ contains it
  - answers: `null when the field is empty or blank` → hours `"   "` ⇒ `null`
  - answers: `unclear and handoff always answer` → non-empty strings
- [ ] **Step 2: Run** `npx vitest run src/bot/faq` → FAIL.
- [ ] **Step 3: Implement.** Copy example for the reviewer to judge tone (implementer writes the rest in the same register): `hours`: `"Atendemos {hours}."`, `"Nuestro horario es {hours}."`; `unclear`: `"Perdón, no te entendí bien. ¿Me contás un poco más qué buscás?"`; `handoff`: `"Genial, ya te paso con alguien del equipo para cerrarlo."`
- [ ] **Step 4: Run** `npx vitest run src/bot/faq` → PASS.
- [ ] **Step 5: Commit** `feat: answer frequent questions with templates and real data`

### Task 6: Router

**Files:**
- Create: `src/bot/faq/router.ts`
- Test: `src/bot/faq/router.test.ts`

**Interfaces:**
- Consumes: `FaqCall`, `FaqName` (Task 4); `HistoryTurn` (`src/bot/history.ts`); `TurnUsage` (Task 2).
- Produces:
  - `type RouterCall = FaqCall | { fn: "complex"; args: Record<string, never> }`
  - `ROUTER_TURNS = 3`
  - `routeMessage(model: LanguageModel, turns: HistoryTurn[]): Promise<{ call: RouterCall; usage: TurnUsage }>` — sends the last 3 turns (handoff turns as plain text); returns `complex` when there is no tool call, the tool is unknown, or Zod rejects the args. Provider errors are rethrown (the caller classifies them).

- [ ] **Step 1: Write failing tests** (MockLanguageModelV4)
  - `returns the tool the model picked with its args` → mock tool call `price {product:"pan"}` ⇒ `{ fn: "price", args: { product: "pan" } }`
  - `forces a tool and caps output` → `model.doGenerateCalls[0]`: `toolChoice.type === "required"`, `maxOutputTokens === 200`, tool names = the 9 in the spec
  - `sends only the last 3 turns and no business data` → 5 turns in ⇒ prompt has 3 non-system messages; system text < 1500 chars
  - `invalid args fall back to complex` → `price {product:""}` ⇒ `complex`
  - `unknown tool or plain text falls back to complex`
  - `reports usage` → mock usage 10/2 ⇒ `{ inputTokens: 10, outputTokens: 2, cachedTokens: 0 }`
  - `rethrows provider errors` → mock throws `APICallError` 401 ⇒ rejects
- [ ] **Step 2: Run** `npx vitest run src/bot/faq/router.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Tools built with `tool({ description, inputSchema })` and no `execute`; `price`/`stock` input `{ product: z.string().trim().min(1).max(100) }`, `shipping` `{ zone: z.string().max(100).optional() }`, `handoff` `{ reason: z.string().trim().min(1).max(300) }`, rest `{}`. Prompt: classify the last customer message; `handoff` when they want to buy, pay, reserve, talk to a person or complain; `complex` for anything else that needs a conversation.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: route customer messages with a small model call`

### Task 7: Bot events table

**Files:**
- Modify: `src/db/schema.ts` (`botEvents`, `BOT_PATHS = ["silence","prefilter","faq","complex","handoff","relay"] as const`, pg enum `bot_path`)
- Create: `drizzle/0023_bot_events.sql` (generated), `drizzle/0024_bot_events_rls.sql` (hand-written; grants `SELECT, INSERT`)
- Create: `src/usage/events.ts`
- Test: `src/usage/events.int.test.ts`

**Interfaces:**
- Produces:
  - `type BotPath = (typeof BOT_PATHS)[number]`
  - `type BotEvent = { contactId: string; path: BotPath; fn: string | null; model: string | null; routerModel: string | null; inputTokens: number; outputTokens: number; cachedTokens: number; routerInputTokens: number; routerOutputTokens: number; latencyMs: number; outcome: string }`
  - `recordBotEvent(tenantId: string, e: BotEvent): Promise<void>` — never throws; logs `bot event failed: <code>` like `meter()`.
  - Columns: `id uuid pk default random`, `tenant_id`, `contact_id` (fk contacts, on delete cascade), the fields above in snake_case, `created_at timestamptz default now()`, index `(tenant_id, created_at)`.

- [ ] **Step 1: Write failing tests** — `records one row`; `is private to each tenant`; `swallows failures` (non-existent contact id ⇒ resolves, no row).
- [ ] **Step 2: Run** `npx vitest run src/usage/events.int.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run db:migrate && npx vitest run src/usage src/db` → PASS.
- [ ] **Step 5: Commit** `feat: record one bot event per turn`

### Task 8: Wire the pipeline into the bot

**Files:**
- Create: `src/bot/faq/turn.ts`
- Modify: `src/bot/reply.ts` (`runConversation`, `runRelay`), `src/worker.ts` untouched
- Test: `src/bot/faq/turn.int.test.ts`, `src/bot/reply.int.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 4, 5, 6, 7; `handOff`, `makeTools` (`src/bot/tools.ts`); `generateOrRecord` (now returns `{ text, usage } | skip outcome`).
- Produces:
  - `type TurnResult = { path: BotPath; fn: string | null; text: string | null; handoff: boolean; model: string | null; routerModel: string | null; usage: TurnUsage; routerUsage: TurnUsage }` (`text: null` = silence)
  - `answerTurn(tenantId: string, input: { turns: HistoryTurn[]; stage: Stage; introduce: boolean; tenantName: string; routerModel: LanguageModel | null; runComplex: () => Promise<{ text: string; usage: TurnUsage } | SkipOutcome>; doHandoff: (reason: string) => Promise<void>; pick?: () => number }): Promise<TurnResult | SkipOutcome>` where `SkipOutcome = "skipped:key-invalid" | "skipped:model-error" | "skipped:quota"`.
  - Customer text = customer turns after the last non-customer turn, joined with `\n`; `lastBotText` = last assistant turn text or `null`.
  - `runConversation` deps add `routerModel?: LanguageModel | null`. Default: `null` when `deps.model` is given (existing tests keep a single mock), otherwise `createModel({ ...rt, model: rt.routerModel ?? rt.model })`. `null` skips the router (complex path).
  - Template answers get `fill("intro", { tenant })` + `"\n"` in front when `introduce`.
  - After the outcome is known, `recordBotEvent` with the path reached, the turn's outcome and `latencyMs` from turn start. Turns stopped by entry guards record nothing. `runRelay` records `path: "relay"`.

- [ ] **Step 1: Write failing tests**
  - turn: `silence sends nothing and calls no model` → `"gracias"` ⇒ `{ path: "silence", text: null }`, router mock not called
  - turn: `prefilter rule answers with zero tokens` → hours loaded, `"a que hora abren?"` ⇒ `path: "prefilter"`, `fn: "hours"`, router not called
  - turn: `router FAQ answers without the main model` → router mock `price {product:"pan"}` ⇒ `path: "faq"`, `runComplex` not called
  - turn: `empty field goes to the complex path` → router `hours`, hours empty ⇒ `path: "complex"`, `routerUsage.inputTokens > 0`
  - turn: `handoff runs the handoff and answers with its template` → `doHandoff` called once, `handoff: true`
  - turn: `outside consulta skips prefilter and router` → stage `postventa`, `"a que hora abren?"` ⇒ `path: "complex"`, router not called
  - turn: `introduces itself on a template answer` → `introduce: true` ⇒ text starts with the intro line
  - reply: `answers a FAQ with a template and records the event` → `bot_events` row `path='faq'`, `fn='price'`, `outcome='sent'`
  - reply: `does not send a template over an admin who wrote meanwhile` → admin message inserted with `sent_at` after the customer's ⇒ outcome `skipped:not-customer-last`, `send` not called, event recorded with that outcome
  - reply: `records nothing when the chat is paused`
  - reply: existing tests stay green unchanged.
- [ ] **Step 2: Run** `npx vitest run src/bot` → FAIL.
- [ ] **Step 3: Implement.** Order inside `runConversation` stays: entry guards → `answerTurn` → `adminWroteSince` → `asksForSensitiveData` (only on `path === "complex"`) → `deliver(…, handoff)`. Silence returns the new outcome `"skipped:trivial"` (add it to `ConversationOutcome`).
- [ ] **Step 4: Run** `npm test && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat: answer frequent questions through the router before the main model`

### Task 9: Test chat uses the same pipeline

**Files:**
- Modify: `src/bot/try-agent.ts`, `src/app/t/[slug]/configuracion/agente/test-chat.tsx`
- Test: `src/bot/try-agent.int.test.ts`

**Interfaces:**
- Consumes: `answerTurn` (Task 8).
- Produces: `TryReply` gains `path: BotPath`; stage passed to `answerTurn` is `"consulta"`; `deps` gains `routerModel?: LanguageModel | null` with the same default rule as Task 8. Notes: faq/prefilter ⇒ `"(respondió con plantilla: <fn>)"`; silence ⇒ `reply: ""`, `adminNote: "(el bot no respondería: mensaje trivial)"`. No `bot_events` rows.

- [ ] **Step 1: Write failing tests** — `shows the template path`; `shows silence as a note`; `writes no bot events`; existing tests green.
- [ ] **Step 2: Run** `npx vitest run src/bot/try-agent.int.test.ts` → FAIL.
- [ ] **Step 3: Implement**; `test-chat.tsx` renders an empty reply as only the note.
- [ ] **Step 4: Run** `npm test && npx playwright test e2e/agent.spec.ts` → PASS.
- [ ] **Step 5: Commit** `feat: show which path the bot took in the test chat`

### Task 10: Metrics script

**Files:**
- Create: `scripts/metrics.ts`, `scripts/prices.json`, `scripts/metrics-report.ts` (pure aggregation)
- Modify: `package.json` (`"metrics": "tsx scripts/metrics.ts"` — `tsx` only if already installed; otherwise bundle with the existing `esbuild` like `build:worker` and run with `node`)
- Test: `scripts/metrics-report.test.ts` (add `scripts/**/*.test.ts` to vitest include if needed)

**Interfaces:**
- Produces:
  - `prices.json`: `{ "<model id>": { "input": number, "output": number, "cached": number } }` USD per million tokens; seed with the models in `MODEL_SUGGESTIONS`/`ROUTER_SUGGESTIONS`, values copied from each provider's pricing page at implementation time.
  - `summarize(rows: EventRow[], prices: Prices): Report` where `EventRow` = `bot_events` columns, `Report = { total: number; byPath: Record<BotPath, { share: number; avgInput: number; avgOutput: number; avgCached: number; costUsd: number }>; unknownModels: string[] }`. Main tokens are priced with `model`, router tokens with `router_model`.
  - CLI: `npm run metrics -- [--tenant <slug>] [--days 7]`, connects with `DATABASE_OWNER_URL`, read-only query, prints a table with `console.table`.

- [ ] **Step 1: Write failing tests** — `shares add up to 100`; `averages per path`; `cost uses cached price for cached tokens` (cached tokens subtracted from input before pricing); `prices router tokens with the router model`; `lists models missing from prices`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** tests → PASS; then `DATABASE_OWNER_URL=… npm run metrics -- --days 1` against dev prints a table without error.
- [ ] **Step 5: Commit** `feat: report bot cost per path from recorded events`

### Task 11: Router eval and README

**Files:**
- Create: `eval/router.eval.ts`
- Modify: `package.json` (`"eval:router": "vitest run --config vitest.eval.config.ts eval/router.eval.ts"`), `README.md` (root: section "Bot: respuestas frecuentes y métricas")

**Interfaces:**
- Consumes: `routeMessage` (Task 6), `prefilter` (Task 4), `createModel` with `EVAL_MODEL`.

- [ ] **Step 1: Write the eval** — 30 cases `{ text: string; before?: HistoryTurn[]; expected: FaqName | "complex" | "silence" }` in rioplatense with typos and abbreviations ("q", "xq", "cuanto sale", "orario", messages split with `\n`), covering every function at least twice. Each case runs `prefilter` first and the router only if it returned `null`. Prints accuracy overall and per expected function and a list of misses; the test fails under 80% overall.
- [ ] **Step 2: Run** `npm run eval:router` with local Ollama → prints the report (record the number in the commit body).
- [ ] **Step 3: README** — how to run, how to add an FAQ (function in `answers.ts` + template in `templates.ts` + tool in `router.ts` + optional rule in `rules.ts`), how to read metrics (`npm run metrics`), where prices live.
- [ ] **Step 4: Run** `npm run eval:agent` → existing agent eval still passes.
- [ ] **Step 5: Commit** `test: measure router accuracy on realistic customer messages`

### Task 12: Close the iteration

- [ ] **Step 1:** `npm test && npm run lint && npm run typecheck && npx playwright test` → all green.
- [ ] **Step 2:** `npm audit --audit-level=high` and `gitleaks detect` → no high/critical, no leaks.
- [ ] **Step 3:** Update `~/.claude/recordatorios.md` only if the user asks.
