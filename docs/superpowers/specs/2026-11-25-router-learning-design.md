# Router: aprendidas, despedidas, estado del pedido y aprendizaje automático

Fecha: 2026-11-25 · Rama: `feat/faq-router` · Extiende `2026-11-24-faq-router-design.md`.

## Intención

Que el modelo pesado se llame solo cuando hace falta una conversación de verdad. Hoy, preguntas
que ya tienen respuesta en datos del negocio (lo que el admin contestó antes, el estado de un
pedido, una despedida) terminan en el pesado: más lento y más caro. Además, cuando el pesado
contesta algo que una función barata resolvía, el sistema no lo aprende y vuelve a pasar.

**Éxito:** baja el % de turnos `complex` en `npm run metrics`, sin respuestas equivocadas.

## Objetivos

1. **`learned`**: el router responde con una respuesta aprendida del admin (`business_facts`).
2. **`farewell`**: despedidas sin modelo (regla) o con el router.
3. **`order_status`**: estado del último pedido del cliente, en etapa Postventa.
4. **Aprendizaje automático (opción A)**: cuando el pesado contesta algo que resolvía una función
   barata, se guarda como ejemplo del negocio; un mensaje idéntico se resuelve sin modelo y uno
   parecido lo guía en el router.

## No-objetivos

- Que el sistema genere reglas (regex) o código nuevo.
- Embeddings / búsqueda semántica.
- Router en etapa Venta (el bot suele estar pausado tras el traspaso).
- Aprender ejemplos de `price`, `stock`, `quote`, `handoff`, `unclear` (sus args dependen del
  mensaje o requieren criterio; el router ya los resuelve bien).

## Anti-objetivos (sería un fracaso aunque funcione)

- Contestar la respuesta aprendida de **otra** pregunta.
- Que un ejemplo mal marcado se repita sin que el admin pueda verlo y borrarlo.
- Tapar un reclamo en Postventa con una plantilla de estado.
- Mostrar datos de un pedido de otro cliente, o cantidades de stock.

## Enfoques considerados

**Aprendidas (cómo encontrar la respuesta):**
1. *Elegido* — lista numerada de preguntas aprendidas en el prompt del router (máx. 30, las más
   recientes); el router elige el número y el código manda la respuesta del admin tal cual.
   Preciso con sinónimos. Costo: ~15 tokens por pregunta, solo si hay aprendidas.
2. Búsqueda por palabras clave: 0 tokens, pero falla con sinónimos y arriesga contestar otra cosa.
3. Embeddings: lo más preciso a escala; infraestructura y llamadas extra, desproporcionado.

**Aprendizaje automático:**
- *A (elegido)* — el pesado marca la función con una herramienta; se guarda un ejemplo por negocio,
  usado como coincidencia exacta (0 tokens) y como guía del router (few-shot). Pantalla para borrar.
- B — solo un reporte para que una persona agregue reglas: más seguro, no automático.

## Diseño

### Orden del turno (`src/bot/faq/turn.ts`)

```
prefilter (silencio / regla)  →  ejemplo exacto (nuevo)  →  router  →  pesado
```

- Etapas con camino barato: **Consulta** (como hoy) y **Postventa** (nuevo). Venta → pesado.
- En **Postventa** solo se aceptan: `order_status`, `hours`, `location`, `payment_methods`,
  `shipping`, `greeting`, `farewell`, `learned`, `handoff`, `unclear`. Si el router elige
  `price`, `stock`, `quote` o `catalog` → pesado (el pesado sabe volver al cliente a Consulta con
  `set_stage`). En **Consulta**, `order_status` → pesado.

### 1. `learned` (aprendidas)

- `routeMessage` recibe `facts: { question: string }[]` (las 30 más recientes de
  `recentFacts`, en ese orden). Si hay al menos una, se agrega al prompt del router una sección
  `Preguntas ya respondidas por el negocio:` con `1. <pregunta>` … y la tool
  `learned({ n: int 1..facts.length })`. Sin aprendidas, la tool no se ofrece.
- Instrucción: "learned: el cliente pregunta lo mismo que una de las preguntas ya respondidas
  (aunque con otras palabras). Si no es claramente la misma, no la elijas."
- `answerFaq` recibe el id real del fact (el turno traduce `n` → `facts[n-1].id`) y devuelve la
  respuesta del admin **tal cual** (plantilla `learned: ["{answer}"]`). Fact borrado o `n` fuera
  de rango → `null` → pesado.
- Las aprendidas nunca contienen precios ni casos personales (`whyNotLearned` ya lo garantiza).

### 2. `farewell` (despedidas)

- Regla `FAREWELL` en `rules.ts` (cada línea, como `GREETING`): `chau`, `chao`, `adios`,
  `hasta luego`, `hasta manana`, `nos vemos`, `saludos`, con cortesías (`gracias`, `ok`, `dale`)
  y emojis/puntuación. "buenas noches" sigue siendo saludo.
- Prefilter: si todo el mensaje es despedida → `farewell`; pero si el último mensaje del bot ya
  era una despedida (su texto coincide con alguna variante de `TEMPLATES.farewell`) → silencio.
- Tool `farewell` en el router para las que la regla no cubre.
- Plantillas: "¡Gracias por escribirnos! Cualquier cosa, acá estamos." / "¡Un gusto! Cuando
  necesites, escribinos." Con `introduce`, se manda solo la plantilla (sin intro).

### 3. `order_status` (estado del pedido)

- Solo en Postventa. Datos: pedidos del **contacto del turno** (`orders.contact_id`), vía
  `withTenant`. Se elige el `pending` con la fecha de entrega más próxima; si no hay, el
  `delivered` más reciente. Los `cancelled` se ignoran. *(Decisión mía: un pedido cancelado viejo
  no debe tapar uno pendiente.)*
- Respuesta según estado:
  - `pending`: "Tu pedido está confirmado para el {date}, con entrega en {address}."
  - `delivered`: "Tu pedido se entregó el {date}." (fecha de `delivered_at`)
  - Sin pedidos pendientes ni entregados → `null` → pesado.
- Fechas en zona `America/Argentina/Buenos_Aires`, formato "viernes 28/11".
- Router: "order_status: pregunta cuándo llega, dónde está o en qué estado está SU pedido. Un
  reclamo (llegó mal, no llegó, falta algo) es handoff."
- `answerFaq` pasa a recibir `contactId` (lo necesita `order_status`).

### 4. Aprendizaje automático (A)

**Tabla `router_examples`** (migración + RLS como `bot_events`):

| columna | tipo | nota |
|---|---|---|
| id | uuid pk | |
| tenant_id | uuid fk tenants, cascade | RLS `tenant_isolation` |
| key | text | mensaje normalizado (`plain`, sin puntuación/emojis, espacios colapsados) |
| text | text | mensaje original recortado a 200 caracteres (para mostrar) |
| fn | text | una de las funciones aprendibles |
| fact_id | uuid fk business_facts, cascade, null | solo para `learned` |
| created_at | timestamptz | |

- `unique (tenant_id, key)`: el último marcado gana (upsert).
- Tope 200 por negocio: al insertar, se borran los más viejos.
- `crm_app`: SELECT, INSERT, UPDATE, DELETE.
- **Funciones aprendibles:** `hours`, `location`, `payment_methods`, `shipping`, `greeting`,
  `farewell`, `catalog`, `order_status`, `learned`.

**Herramienta del pesado `mark_faq`** (`src/bot/tools.ts`):
- Input: `{ fn: <aprendible>, fact?: int }`. Descripción: "Si el ÚLTIMO mensaje del cliente se
  respondía solo con horarios, dirección, medios de pago, envíos, un saludo, una despedida, el
  catálogo, el estado de su pedido o una respuesta aprendida (fact = su número), llamala además
  de responder. Si hacía falta algo más, no la llames."
- El prompt del pesado numera las aprendidas igual que el router (`[n] Pregunta: …`).
- Al ejecutar: toma el bloque del cliente posterior al último turno del bot (como el prefilter),
  verifica que `answerFaq` con esa función devuelva texto (si no, no guarda) y hace el upsert.
  Siempre responde `{ ok: true }` al modelo. En `dryRun` (chat de prueba) no guarda nada.
- No se guarda si el mensaje normalizado tiene más de 12 palabras (un mensaje largo rara vez se
  repite igual y arrastra más datos personales).

**Uso de los ejemplos:**
- *Coincidencia exacta* (en `answerTurn`, tras el prefilter): si `key` coincide y la función está
  permitida en la etapa → `answerFaq`. Si devuelve `null`, sigue al router. Path nuevo
  `example` en `bot_path` (migración `ALTER TYPE ... ADD VALUE`), `fn` = la función.
- *Guía del router*: los últimos 20 ejemplos del negocio (sin `learned` si su fact ya no está en
  la lista de 30) se agregan al prompt: `Ejemplos de este negocio: "<text>" → <fn>`.

**Pantalla:** en `/t/[slug]/aprendido`, sección nueva "Atajos del bot": lista (mensaje, función
en castellano, fecha) con botón Borrar. Server action con `withTenant` y validación Zod del id.
Estados: cargando (skeleton), error, vacío ("Todavía no hay atajos: aparecen cuando el bot
detecta preguntas frecuentes") e ideal.

### Métricas y eventos

- `bot_events.path` suma `example`. `npm run metrics` lo muestra como un camino más.
- La barra de consumo muestra `Atajo (sin IA)` para `path = example`.

## Restricciones

- Ningún precio, stock ni dato de otro cliente sale de una plantilla nueva.
- Todo acceso a datos con `withTenant` (RLS).
- Datos personales (Ley 25.326): `router_examples` guarda texto de clientes sin vincularlo al
  contacto; se puede borrar desde la pantalla; se borra en cascada con el negocio.
- El prompt del router sigue debajo de ~1500 caracteres **sin** aprendidas ni ejemplos; con ellas
  crece de forma acotada (30 preguntas + 20 ejemplos, cada uno recortado a 120 caracteres).

## Tests y evaluación

- TDD por función: reglas (`FAREWELL`), `answerFaq` (`learned`, `farewell`, `order_status`),
  router (tools condicionales, `n` fuera de rango), `answerTurn` (etapas, ejemplo exacto),
  `mark_faq` (guarda / no guarda / dryRun / tope 200), pantalla (acción de borrar).
- `eval/router.eval.ts`: casos de `farewell`, `order_status` (con etapa) y `learned` con una lista
  de aprendidas de prueba, incluyendo una pregunta parecida pero distinta (debe ir a `complex`).

## Lo que queda a criterio de quien implemente

- Nombres internos, orden exacto de las secciones del prompt, textos de las plantillas dentro del
  tono rioplatense actual.
