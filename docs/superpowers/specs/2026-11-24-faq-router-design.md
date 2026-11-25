# Router de intenciones y respuestas con plantilla (ahorro de tokens)

Fecha: 2026-11-24 · Estado: borrador para aprobar

## Intención y por qué

Hoy cada mensaje de cliente dispara una llamada grande al modelo del negocio: system prompt
completo, hasta 20 mensajes de historial, hasta 8000 caracteres de "aprendidos" y hasta 4
pasos de tool use. La mayoría de los mensajes son preguntas frecuentes (precio, stock,
horarios, dónde están, cómo pagar, envíos) que se pueden contestar con datos ya cargados y
una plantilla, sin que el LLM redacte nada.

Objetivo: **gastar muchos menos tokens por mensaje** sin perder la regla central del bot:
responder solo con datos verídicos del negocio y, si falta un dato, preguntarle al admin.

## Metas

- Mensajes triviales y casos obvios se resuelven con 0 tokens (pre-filtro).
- Preguntas frecuentes se resuelven con **una sola llamada chica** al "modelo rápido" del
  negocio; el resultado de la función se envía directo al cliente, nunca vuelve al LLM.
- El camino complejo sigue siendo el bot actual, pero con contexto más corto y prompt
  caching cuando el proveedor es Anthropic.
- Métricas por mensaje (camino, función, tokens, modelo, latencia) y un script que muestre
  % por camino, tokens promedio y costo estimado.
- Configuración reorganizada: la pestaña **Configuración** tiene un submenú con
  **Agente**, **Tablero** y **Negocio**. Negocio guarda la información del negocio en
  campos separados, que es lo que usan las plantillas.

## No-metas

- Reglas de pre-filtro o plantillas editables por cada negocio desde el panel (viven en
  código, en un solo archivo de reglas y uno de plantillas).
- Cambiar el debounce, la pausa del bot, el traspaso, el botón Reactivar, el relay de
  respuestas del admin ni los recordatorios: ya existen y se reusan tal cual.
- Estado estructurado del cliente (`producto_interes`, `presupuesto`, `zona`). Ver
  "Decisiones del constructor / llamadas mías".

## Anti-metas (sería un fracaso aunque funcione)

- Una plantilla que afirme un dato que el negocio no cargó (horario, envío, medio de pago).
  Campo vacío ⇒ no hay plantilla ⇒ camino complejo (que usa `ask_admin`).
- Decir cantidades de stock: solo "disponible" / "sin stock", igual que hoy.
- Que el bot coordine un pago: alias, CBU, "te transfiero", "¿cómo pago?" siguen siendo
  traspaso a una persona (commits `93fa7c0`, `eb2acd4`).
- Perder `ask_admin`: el dueño lo pidió explícitamente; es lo que garantiza que no invente.
- Guardar texto de mensajes, teléfonos o keys en las métricas.

## Restricciones (lo que ya existe y condiciona)

- Stack: Next.js + TypeScript estricto, Postgres con Drizzle y RLS por tenant, BullMQ para
  el worker, Evolution API para WhatsApp, Vercel AI SDK (`ai@7`) con proveedor y API key
  **del negocio** (Anthropic, Google, OpenAI, compatible-OpenAI, Ollama en dev).
- Multi-negocio: todo dato de negocio es por tenant y vive en la base, no en archivos.
- Debounce de 8 s ya implementado en `src/bot/queue.ts` (`enqueueReply` con dedupe).
- "Bot activo" ya existe como `contacts.bot_paused_until` + botón Reactivar.
- Guardas de `runConversation` (`src/bot/reply.ts`) que se mantienen en todos los caminos:
  bot encendido y key válida, chat no pausado, último mensaje del cliente, tope de 20
  respuestas por hora, no hablar encima del admin (`adminWroteSince`), presentación como
  asistente virtual (`discloseAi`), `truncateForWhatsApp`, `asksForSensitiveData`.
- Los límites diarios de pedidos/tokens hoy solo se muestran (barra de uso); el router
  también suma a `ai_usage` vía `meter()`.

## Enfoques considerados

**A. Router completo (elegido).** Pre-filtro con reglas → una llamada al modelo rápido con
`toolChoice: "required"` que solo elige función → la función responde con plantilla. Lo que
no se puede resolver con plantilla va al bot actual, achicado. Máximo ahorro en FAQ y tolera
errores de tipeo; en lo complejo hace 2 llamadas (router chico + bot). Hay que medir la
precisión del router.

**B. Solo pre-filtro por palabras clave.** 0 tokens en lo que agarra, pero falla con
"q onda el orario" y lo manda al LLM caro. Queda como primer escalón de A.

**C. Solo achicar el bot actual.** Cambio más chico, pero cada mensaje sigue siendo una
llamada grande. Su recorte se aplica al camino complejo de A.

Eligió el dueño: **A**, en la conversación del 2026-11-24.

## Diseño

### Flujo por turno

`runConversation` conserva todas sus guardas; lo que cambia es cómo produce el texto:

```
mensajes del cliente (debounce existente)
  → guardas existentes (encendido, pausa, último = cliente, tope por hora)
  → etapa ≠ consulta  ─────────────────────────────→ camino complejo
  → pre-filtro (0 tokens)
       trivial            → silencio (no se responde)
       regla obvia        → función FAQ
       nada               → router
  → router (modelo rápido, 1 llamada, sin ejecutar tools)
       función FAQ        → plantilla con datos ─(dato vacío / sin resultados)→ camino complejo
       handoff            → handOff() existente + plantilla de traspaso
       unclear            → plantilla "¿me contás un poco más?"
       complex            → camino complejo
  → guardas de salida existentes (adminWroteSince, asksForSensitiveData, truncate)
  → deliver() existente
  → registrar evento de métricas
```

- "El mensaje" que se clasifica es el bloque de mensajes del cliente desde la última
  respuesta del bot o del admin, unidos con salto de línea (el debounce ya los juntó en un
  solo job).
- Solo se usa router y plantillas en etapa **Consulta**. En Venta el chat suele estar
  pausado; en Postventa el bot actual decide si reabrir con `set_stage`, así que va directo
  al camino complejo.
- Si `discloseAi` pide presentarse en este mensaje, la respuesta con plantilla lleva una
  línea de presentación adelante (plantilla propia).

### Pre-filtro (`src/bot/faq/prefilter.ts` + `src/bot/faq/rules.ts`)

- Texto normalizado (minúsculas, sin tildes, igual que `sensitive-guard`).
- **Trivial** ("ok", "gracias", "👍", "dale", "listo", "joya", solo emojis): no se responde.
  Excepción: si el último mensaje del bot terminaba en "?" no es trivial ("dale" puede ser
  "sí, lo quiero") y pasa al router.
- **Reglas obvias**: lista de `{ pattern: RegExp, fn, args? }` en `rules.ts`. Agregar una
  regla es agregar una línea. Se aplican solo a mensajes cortos (≤ 8 palabras) para no
  capturar mensajes con varias intenciones. Reglas iniciales:
  - horario/abren/cierran → `hours`
  - dirección/dónde están/ubicación → `location`
  - medios de pago/aceptan tarjeta/mercado pago → `payment_methods`
  - alias/cbu/cvu/te transfiero/cómo pago → `handoff` (es intención de pagar, no pregunta)
  - envío/envían/delivery → `shipping`

### Router (`src/bot/faq/router.ts`)

- Modelo: nuevo campo opcional **Modelo rápido** en la config del agente
  (`agent_configs.router_model`, texto, nullable). Mismo proveedor y misma key que el
  modelo principal; vacío = usa el modelo principal. Sugerencias en `MODEL_SUGGESTIONS`
  (ej. `claude-haiku-5-5`, `gemini-3.5-flash-lite`, `gpt-4.1-mini`).
- `generateText` con tools **sin `execute`**, `toolChoice: "required"`,
  `maxOutputTokens: 200`, `maxRetries: 0`, un solo paso. Se lee la primera tool call.
- Prompt corto: instrucciones de clasificación (unas 10 líneas) + últimos 3 turnos. Sin
  catálogo, sin info del negocio, sin aprendidos, sin reglas de venta.
- Tools del router (descripciones de una línea):
  `price(product)`, `stock(product)`, `hours()`, `location()`, `payment_methods()`,
  `shipping(zone?)`, `handoff(reason)` (comprar, pagar o reservar), `attention(reason)` (reclamo o pedir una persona; ver 2026-11-25-attention-board-orders-design.md), `quote(items[{product, quantity}])`, `catalog()`, `greeting()`, `unclear()`, `complex()`.
- Si el router falla (error del proveedor, respuesta sin tool call, args inválidos según
  Zod): camino complejo. Errores de key inválida o cuota se manejan igual que hoy
  (`generateOrRecord`).
- Se mide con `meter()` como cualquier llamada.

### Funciones FAQ (`src/bot/faq/answers.ts`) y plantillas (`src/bot/faq/templates.ts`)

Cada función recibe los args del router y el tenant, consulta datos y devuelve
`string | null`. `null` = "no puedo responder con datos cargados" ⇒ camino complejo.

| Función | Datos | Respuesta | `null` cuando |
|---|---|---|---|
| `price` | `searchCatalog` | 1 producto: nombre + precio (+ "sin stock" si aplica). 2-3: lista. >3: los 3 primeros y "tengo más opciones, ¿cuál buscás?" | sin coincidencias |
| `stock` | `searchCatalog` | "disponible" / "sin stock", nunca cantidades | sin coincidencias |
| `hours` | Negocio · horarios | plantilla con el texto cargado | campo vacío |
| `location` | Negocio · dirección | idem | campo vacío |
| `payment_methods` | Negocio · medios de pago | idem | campo vacío |
| `shipping` | Negocio · envíos | idem (la zona no se interpreta: se muestra lo cargado) | campo vacío |
| `handoff` | — | `handOff()` existente + plantilla de traspaso | nunca |
| `attention` | — | `requestAttention()`: sin cambio de etapa, bot apagado, tarjeta roja, aviso al admin + plantilla de traspaso | nunca |
| `unclear` | — | plantilla de pedido de aclaración | nunca |
| `catalog` | `searchCatalog` sin filtro | hasta 10 productos con precio (+ "sin stock" si aplica); si hay más, "tengo más opciones" | catálogo vacío |
| `quote` | `matchProducts` (filas completas, solo en el servidor) | por ítem `• Producto: cant × precio = subtotal` + total en centavos, "(sin envío)" y "¿Querés avanzar con el pedido?". Nombre exacto gana; si no, una sola coincidencia. Cantidad > stock: plantilla `quote_short` (nunca muestra el stock) + traspaso a una persona | algún producto sin coincidencia única, lista vacía |
| `greeting` | — | primer contacto: solo la intro; después: plantilla de saludo corto. Solo por la regla `GREETING` (`rules.ts`) o un atajo: el router ya no la ofrece (confundía "dale" y "hola, me interesa") | nunca |
| `farewell` | — | plantilla de despedida (sin intro); regla `FAREWELL` o router; si el bot ya se despidió, silencio | nunca |
| `order_status` | `orders` del contacto (solo Postventa) | pendiente más próximo: fecha y dirección; si no, último entregado. Cancelados se ignoran | sin pendientes ni entregados |
| `learned` | `business_facts` (30 más recientes, numeradas en el prompt) | la respuesta del admin tal cual. Se descarta si el mensaje nombra una letra o número que la pregunta no tiene | fact inexistente |

- Plantillas: 2-3 variantes por función, en rioplatense con voseo, elegidas al azar
  (función de azar inyectable para tests). Variables con `{nombre}`.
- Agregar una FAQ = función en `answers.ts` + plantilla en `templates.ts` + tool en
  `router.ts` (+ regla opcional en `rules.ts`).
- Las plantillas no usan el "tono" del negocio (eso requeriría el LLM); se aceptan así.

### Camino complejo

- Es el `generateAgentText` actual con `makeTools` (incluye `ask_admin`, `search_catalog`,
  `handoff_to_admin`, `set_stage`). Cambios:
  - Historial de **6** mensajes (antes 20), constante en `reply.ts`.
  - Aprendidos: tope de 3000 caracteres (antes 8000).
  - `stopWhen: isStepCount(3)` (antes 4).
  - El system se parte en dos mensajes de sistema: (1) fijo por negocio = reglas + el
    bloque `<negocio>`, en el mismo orden de hoy (las reglas antes del cerco de datos);
    (2) dinámico = fecha/hora, etapa y presentación, como reglas cortas. Si el proveedor
    es Anthropic, el (1) lleva `providerOptions.anthropic.cacheControl = { type:
    "ephemeral" }`; como las tools van antes del system, quedan dentro del prefijo
    cacheado. Si el prompt no llega al mínimo de Anthropic para cachear, no se cachea y
    está bien: `cached_tokens` en las métricas lo muestra.
  - La información del negocio en el prompt sale de los campos de la pestaña Negocio
    (horarios, dirección, medios de pago, envíos, otros).
- El chat de prueba (`tryAgent`) usa el mismo flujo completo (pre-filtro y router
  incluidos), como si el cliente estuviera en Consulta, y muestra en la nota qué camino
  tomó, ej. "(respondió con plantilla: precio)". Si el pre-filtro decide no responder,
  la respuesta va vacía con la nota "(el bot no respondería: mensaje trivial)";
  `TryReply` suma un campo `path`.

### Pestaña Configuración con submenú

```
Configuración
 ├ Agente   → lo que hoy es /agente (form + chat de prueba) + campo "Modelo rápido"
 ├ Tablero  → lo que hoy es /configuracion (días de inactividad)
 └ Negocio  → horarios · dirección · medios de pago · envíos · otros
```

- Rutas: `/t/[slug]/configuracion/agente`, `/tablero`, `/negocio`, con un `layout.tsx`
  que pinta el submenú (`aria-current` como `tenant-nav`). `/configuracion` redirige a
  `/configuracion/agente`; `/agente` redirige también (links viejos). "Agente" sale del
  menú principal.
- Negocio: tabla nueva `business_profiles` (`tenant_id` PK, `hours`, `address`,
  `payment_methods`, `shipping`, `other`, `updated_at`), con RLS y grants iguales al resto.
  Es tabla aparte porque se puede cargar antes de configurar el agente.
- Migración en dos tiempos: esta entrega copia `agent_configs.business_info` a
  `business_profiles.other` y deja de usar la columna (sale del form y del schema de
  Drizzle, la columna queda en la base); una migración posterior, en otra entrega, la
  elimina. Así un worker viejo corriendo durante el deploy no falla.
- Validación con Zod (texto, máx. 1000 por campo, `other` máx. 8000). Form con sus 4
  estados (loading, error, vacío, ideal), como los demás.

### Métricas

- Tabla `bot_events` con RLS (el chat de prueba no registra eventos): `tenant_id`,
  `contact_id`, `path` (`silence` | `prefilter` | `faq` | `complex` | `handoff` |
  `relay`), `fn` (nullable; `unclear` es `path = faq, fn = unclear`), `model`
  (nullable), `input_tokens`, `output_tokens`, `cached_tokens`, `latency_ms`,
  `outcome` (el `ConversationOutcome` del turno: `sent`, `skipped:quota`,
  `skipped:model-error`, `skipped:not-customer-last`…), `created_at`. Sin texto de
  mensajes.
- Se registra una fila por cada turno que llegó a pre-filtro, router o modelo, se haya
  enviado o no (así el costo incluye lo gastado en respuestas descartadas o fallidas).
  `path` es el último camino al que llegó. Los turnos cortados por las guardas de
  entrada (apagado, pausa, tope por hora) no gastan nada y no se registran. `runRelay`
  registra `path = relay`.
- Una fila por turno; si hubo router y después camino complejo, la fila suma los tokens
  de las dos llamadas y `path = complex`, con `router_input_tokens` /
  `router_output_tokens` aparte para ver cuánto agrega el router.
- `cached_tokens` sale de `usage.inputTokenDetails.cacheReadTokens` del AI SDK.
- `ai_usage` (barra diaria) sigue igual.
- Script `npm run metrics -- [--tenant <slug>] [--days 7]` (`scripts/metrics.ts`): % de
  turnos por camino, tokens promedio por camino y costo estimado. Es una herramienta del
  operador: se conecta con `DATABASE_OWNER_URL` (la misma que usa `migrate.mjs`), solo
  lee, y se corre en el servidor con `docker compose exec` o local contra la base de
  dev. No se expone en la app. Precios por modelo en
  `scripts/prices.json` (USD por millón: input, output, cached), editable.

### Tests

- Unit: pre-filtro (triviales, excepción del "?", reglas, mensajes largos), plantillas
  (variantes, sin cantidades de stock), parser de la salida del router.
- Integración (DB de test existente): cada función FAQ, incluido el `null` con campo
  vacío; `runConversation` por cada camino con `send` y modelo mock (el WhatsApp ya se
  mockea inyectando `send`); migración de `business_info` → `other`; RLS de las tablas
  nuevas.
- Eval del router `eval/router.eval.ts` (`npm run eval:router`): ~30 mensajes realistas en
  rioplatense (tipeos, "q", "xq", "cuanto sale", mensajes partidos) con la función
  esperada; reporta precisión total y por función. Modelo por `EVAL_MODEL` como el eval
  actual.
- El eval de agente existente (`eval/agent.eval.ts`) tiene que seguir pasando.
- E2E: submenú de Configuración y guardado de Negocio.

## Decisiones del constructor / llamadas mías (para revisar)

1. **Sin estado estructurado** (`producto_interes`, `presupuesto`, `zona`): nadie lo
   llenaría sin otra llamada al LLM, y 6 mensajes de historial cubren lo mismo. Se agrega
   si las métricas muestran que el camino complejo lo necesita.
2. Trivial = no responder (no plantilla corta), salvo después de una pregunta del bot.
3. alias/CBU/cómo pago ⇒ traspaso, no `payment_methods`.
4. Router y plantillas solo en etapa Consulta.
5. Reglas y plantillas en código, no editables por negocio.
6. Historial 6, aprendidos 3000 caracteres, 3 pasos en el camino complejo.
7. Prompt partido en parte fija (cacheada) y parte dinámica; sin exigir que la caché
   funcione si el prompt queda chico.
8. Métricas: una fila por turno que gastó o decidió algo, con su `outcome`; el relay
   también cuenta.
9. Script de métricas con el rol dueño de la base, solo para el operador.
10. `business_info` se deja de usar ahora y se borra en una entrega posterior.
11. Chat de prueba = cliente en Consulta; silencio se muestra como nota.

## Queda para el constructor

- Texto exacto de prompts del router y de las plantillas.
- Orden de las tareas y cómo partir los commits (TDD por función).
- Formato de salida del script de métricas.
- Los ~30 mensajes del eval del router.

## Extensión 2026-11-25

Ver `2026-11-25-router-learning-design.md`: router también en Postventa (funciones acotadas), atajos (`router_examples`, path `example`) que marca el modelo pesado con `mark_faq`, y la pantalla "Atajos del bot" en Aprendido.
