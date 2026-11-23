# CRM — Ollama local para desarrollo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Usar un modelo local de Ollama como proveedor del bot solo en desarrollo, y elegir el modelo con una evaluación reproducible.

**Architecture:** Nuevo proveedor `ollama` cuya URL fija el servidor con `OLLAMA_URL`; sin esa variable el proveedor no existe (UI y validación). Usa `createOpenAICompatible` sin `safeFetch`, porque la URL no la controla el negocio. El compose de desarrollo define la variable apuntando al host (`10.0.2.2`, habilitado con el loopback de Docker rootless). Una configuración de Vitest aparte corre la evaluación contra Ollama real.

**Tech Stack:** el existente; sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-11-23-crm-ollama-dev-design.md`

## Global Constraints

- Reglas de entregas previas vigentes (RLS, Zod, `Result`, 4 estados, WCAG AA, sin PII en logs, commits convencionales con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).
- `OLLAMA_URL` **nunca** en `docker-compose.yml` ni en `.env.example`: solo en `docker-compose.dev.yml` (`http://10.0.2.2:11434/v1`, servicios `crm` y `crm-worker`).
- Etiqueta exacta del proveedor: `Ollama (local, solo desarrollo)`. Sugerencias de modelo: `qwen3:8b`, `llama3.1:8b`.
- Error exacto si el servidor no tiene Ollama: `Ollama no está disponible en este servidor`.
- Rama: `feat/crm-ollama-dev`.

## Review Focus

1. **Servidor sin `OLLAMA_URL` recibe un POST armado con `provider=ollama`**: `VALIDATION` y no se guarda nada → test en Task 1.
2. **El negocio manda una `baseUrl` junto con ollama**: se ignora; se guarda `null` y se usa la del servidor → test en Task 1.
3. **Ollama apagado o modelo no descargado al guardar**: se guarda como `unverified` con código, sin romper → test en Task 1.
4. **Pasar de ollama a un proveedor en la nube sin cargar key**: exige la key; el marcador local nunca se reutiliza como API key → test en Task 1.

---

### Task 1: Proveedor "Ollama (local)" condicionado al servidor

**Files:**
- Modify: `crm/src/db/schema.ts` (`PROVIDERS` + `"ollama"`), `crm/src/agent/model.ts`, `crm/src/agent/config.ts`, `crm/src/app/t/[slug]/agente/agent-form.tsx` y la `page.tsx` de agente, `docker-compose.dev.yml`, `tests/static.sh`
- Create: migración generada (`npx drizzle-kit generate --name provider_ollama`; debe quedar `ALTER TYPE "provider" ADD VALUE 'ollama'`)
- Test: `crm/src/agent/model.test.ts`, `crm/src/agent/config.int.test.ts`

**Interfaces:**
- Produces:
  - `ollamaUrl(): string | null` en `model.ts` (lee `process.env.OLLAMA_URL`, vacío → `null`).
  - `availableProviders(): Provider[]`: todos menos `"ollama"` cuando `ollamaUrl()` es `null`.
  - `createModel` caso `"ollama"`: `createOpenAICompatible({ name: "ollama", baseURL: ollamaUrl() })(s.model)`, sin `apiKey` ni `safeFetch`; sin URL lanza `new Error("OLLAMA_UNAVAILABLE")`.
  - `MODEL_SUGGESTIONS.ollama = ["qwen3:8b", "llama3.1:8b"]`.
  - `saveAgentConfig` con `provider: "ollama"`: rechaza sin `ollamaUrl()` con `fail("VALIDATION", "Revisá la configuración del agente", { provider: ["Ollama no está disponible en este servidor"] })`; no pide key; guarda `baseUrl: null`, `apiKeyEnc: encrypt("local")`, `apiKeyLast4: ""`. Al pasar de ollama a otro proveedor, la key existente **no** se reutiliza (`existing.provider === "ollama"` cuenta como sin key).
  - La página de agente pasa `providers={availableProviders()}` al formulario; este lista solo esos y oculta "API key" y "URL base" con ollama.

- [ ] **Step 1: Escribir los tests.**
  - `model.test.ts`:
    - `availableProviders()` sin `OLLAMA_URL` no incluye `"ollama"`; con `vi.stubEnv("OLLAMA_URL", "http://127.0.0.1:11434/v1")` sí.
    - Con esa URL y `vi.stubGlobal("fetch", spy)` que responde un chat completion mínimo, `generateText({ model: await createModel({ provider: "ollama", model: "qwen3:8b", apiKey: "", baseUrl: "http://evil.example" }), prompt: "hola" })` llama a `http://127.0.0.1:11434/v1/chat/completions` (la del servidor, aunque sea loopback).
  - `config.int.test.ts`:
    - Review Focus 1: sin `OLLAMA_URL`, `saveAgentConfig(t.id, { ...base, provider: "ollama", apiKey: "" })` → `error.details.provider[0] === "Ollama no está disponible en este servidor"` y no hay fila en `agent_configs`.
    - Review Focus 2: con `OLLAMA_URL`, `baseUrl: "http://evil.example"` → `data.baseUrl === null`.
    - Review Focus 3: con `OLLAMA_URL` = `http://127.0.0.1:9/v1` (puerto cerrado) y el verificador real → `success: true`, `keyStatus: "unverified"`.
    - Review Focus 4: guardar ollama y después `{ ...base, provider: "google", apiKey: "" }` → `error.details.apiKey[0] === "Cargá la API key"`.
- [ ] **Step 2: Ver el FAIL.** `cd crm && npx vitest run src/agent` → fallan los nuevos.
- [ ] **Step 3: Implementar** según Interfaces; generar la migración; en `docker-compose.dev.yml` agregar `environment: OLLAMA_URL: http://10.0.2.2:11434/v1` a `crm` y `crm-worker`; en `tests/static.sh`:
  - `check "OLLAMA_URL only in the dev override"`: `docker compose config` del base sin `OLLAMA_URL` en `crm`/`crm-worker`;
  - con `-f docker-compose.yml -f docker-compose.dev.yml`, ambos lo tienen.
- [ ] **Step 4: `npx vitest run && npm run lint && npm run typecheck && bash ../tests/static.sh`.** Esperado: todo verde.
- [ ] **Step 5: Commit** `feat: add a server-only Ollama provider for local development`

### Task 2: Loopback de Docker, evaluación del agente y documentación

**Files:**
- Create: `crm/vitest.eval.config.ts`, `crm/eval/agent.eval.ts`
- Modify: `crm/package.json` (`"eval:agent": "vitest run --config vitest.eval.config.ts"`), `README.md`
- Fuera del repo: `~/.config/systemd/user/docker.service.d/ollama-loopback.conf`

**Interfaces:**
- Consumes: Task 1 (`provider: "ollama"`, `ollamaUrl()`), `tryAgent(tenantId, history)` y sus `adminNote` (`"(el bot consultaría al admin: …)"` / `"(el bot pasaría la charla a alguien del equipo)"`).
- Produces: `npm run eval:agent` con `EVAL_MODEL` (por defecto `qwen3:8b`) y `OLLAMA_URL` (por defecto `http://127.0.0.1:11434/v1`).

- [ ] **Step 1: Loopback.**
  - Escribir el override con `[Service]` y `Environment=DOCKERD_ROOTLESS_ROOTLESSKIT_DISABLE_HOST_LOOPBACK=false`.
  - `systemctl --user daemon-reload && systemctl --user restart docker`, y levantar el stack con el override de desarrollo.
  - Esperado:
    - `ps` de rootlesskit **sin** `--disable-host-loopback`;
    - `docker compose ps` con todo `running`;
    - desde `crm-worker`, `fetch("http://10.0.2.2:11434/api/version")` responde con la versión (requiere Ollama corriendo).
- [ ] **Step 2: Evaluación.** `vitest.eval.config.ts` reutiliza alias y `env` de `vitest.config.ts`, con `include: ["eval/**/*.eval.ts"]` y `testTimeout: 600_000`. `agent.eval.ts`:
  - crea un negocio con el agente ollama (`EVAL_MODEL`), info "Panadería. Horario: lunes a sábado de 8 a 20.", producto activo "Pan de campo" a 2500 y `discloseAi` activo;
  - corre cada escenario 2 veces con `tryAgent` y una charla de un mensaje;
  - imprime `console.table` con escenario, aprobadas/2 y segundos promedio;
  - borra el negocio en `afterAll`;
  - el test no falla por escenarios reprobados: es medición, no gate.

  | # | Mensaje | Aprueba si |
  |---|---|---|
  | 1 | `¿Cuánto sale el pan de campo?` | `reply` incluye `2.500` |
  | 2 | `¿Cuánto sale la torta de chocolate?` | sin `$\s?\d` en `reply` **y** (`adminNote` empieza con `(el bot consultaría` o `reply` incluye `no tengo ese dato`) |
  | 3 | `¿Hacen envíos a Pilar?` | `adminNote` empieza con `(el bot consultaría` o `reply` incluye `no tengo ese dato` |
  | 4 | `Dale, quiero 2 panes, ¿cómo pago?` | `adminNote` empieza con `(el bot pasaría` |
  | 5 | `¿Sos un bot?` | `reply` matchea `/asistente virtual\|bot\|inteligencia artificial\|\bIA\b/i` |
- [ ] **Step 3: Correr la evaluación** con Ollama arriba:
  - `ollama pull qwen3:8b && ollama pull llama3.1:8b`;
  - `EVAL_MODEL=qwen3:8b npm run eval:agent` y `EVAL_MODEL=llama3.1:8b npm run eval:agent`.
  - Esperado: dos tablas. Gana el que aprueba más; si empatan, el más rápido. Ledger: `Ruling: modelo <x> — <tabla resumida>`. `ollama rm <perdedor>`.
- [ ] **Step 4: README**, sección "Modelo local (solo desarrollo)":
  - instalar Ollama;
  - el override de loopback y cómo revertirlo, con su costo;
  - `ollama pull <ganador>`;
  - elegir "Ollama (local, solo desarrollo)" en Agente;
  - `npm run eval:agent`;
  - que en producción no existe.
- [ ] **Step 5: Verificación final:** suites, lint, typecheck, audit, rebuild, static/smoke/db-isolation y gitleaks. Esperado: verde.
- [ ] **Step 6: Commit** `feat: add an agent evaluation against local Ollama models` (incluye el README)
