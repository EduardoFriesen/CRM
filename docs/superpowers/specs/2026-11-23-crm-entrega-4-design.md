# CRM Entrega 4 — Etapas automáticas y barra de consumo — Diseño

Fecha: 2026-11-23 · Estado: borrador para aprobación
Sobre la entrega 3 (`docs/superpowers/specs/2026-11-23-crm-entrega-3-design.md`).

## Intención
1. Las etapas siguen el circuito real de venta, y el bot detecta cuándo un cliente en Postventa quiere volver a comprar.
2. Cuando el pedido se entrega y el cliente pasa a Postventa, el bot vuelve a atender esa charla sin esperar a que venza la pausa del traspaso.
3. Una barra siempre visible muestra cuánto se consume del modelo de IA y, si el negocio carga su límite, cuánto queda. Así no vuelve a pasar que el bot se quede mudo por cuota sin aviso.

## Reglas de etapas (decisión del usuario)
| Etapa | Única forma de llegar |
|---|---|
| **Consulta** | Contacto nuevo; o el bot detecta que un cliente en **Postventa** muestra intención de volver a comprar |
| **Venta** | Solo con el traspaso (`handoff_to_admin`): cuando hace falta el admin para cerrar |
| **Postventa** | Solo con **Marcar entregado** en un pedido (ya en la entrega 3) |

- La herramienta `set_stage` del bot solo acepta **`consulta`** (*decisión mía: es la única transición que el bot hace por su cuenta*). Venta y Postventa salen de `handoff_to_admin` y de `deliverOrder`.
- El bot recibe la **etapa actual** del contacto en el prompt. Regla fija nueva: "Si el cliente está en Postventa y muestra intención de volver a comprar (pide otro producto o repetir el pedido), llamá a set_stage con consulta. Si solo pregunta por lo que ya compró o hace un reclamo, no cambies la etapa."
- Se quita la regla de la 2a que mandaba a Venta "cuando decide comprar o pregunta cómo pagar": eso ahora es el traspaso.
- La corrección manual desde la tarjeta sigue igual (Postventa requiere pedido entregado).
- El chat de prueba refleja la misma regla: `set_stage` dry-run solo informa consulta.

## Reactivación al entregar
`deliverOrder` pone `contacts.bot_paused_until = null` en la misma transacción que pasa el contacto a Postventa.

## Barra de consumo
- **Qué se mide**: por negocio y por día calendario en `America/Argentina/Buenos_Aires`:
  - pedidos al modelo (cada llamada al proveedor, incluidos los pasos con herramientas);
  - tokens de entrada y de salida (`usage` que devuelve el AI SDK);
  - respuestas enviadas por WhatsApp.
  - Cuenta **todo lo que gasta cuota**: respuestas y transmisiones del bot, chat de prueba y verificación de key.
  - Las llamadas que fallan (429, errores) cuentan como pedido sin tokens: Google también las cuenta.
- **Límites opcionales** en la pantalla Agente: "Límite diario de pedidos" y "Límite diario de tokens", que el negocio copia de su plan. Si no los carga, la barra muestra solo lo consumido.
- **Dónde**: una franja fina debajo de la navegación del negocio, en todas sus pantallas:
  `IA hoy · 18 pedidos · 24.310 tokens · 9 respuestas · [barra] 18 de 1.000 pedidos · Último error: —`
  - La barra de progreso aparece solo si hay un límite cargado; si hay dos, toma el más cercano a agotarse.
  - Colores: normal, amarillo desde 80% y rojo al 100%, con texto, no solo color, para accesibilidad.
  - Tooltip o texto chico: "Aproximado: tu proveedor puede reiniciar la cuota en otro horario (Google: medianoche del Pacífico)."
  - Último error con `describeAgentError`.
  - Link a Agente.
- Se actualiza con el refresco de la página (15 s en Clientes) y en cada navegación.

## Modelo de datos
- `ai_usage`, con RLS: `tenant_id`, `day` date, `requests` int, `input_tokens` bigint, `output_tokens` bigint, `replies` int; PK `(tenant_id, day)`. Upsert con incremento atómico. `crm_app`: SELECT/INSERT/UPDATE.
- `agent_configs.daily_request_limit` int null y `daily_token_limit` int null (≥ 1).

## Implementación (a criterio del implementador, con estas restricciones)
- Un único punto registra el uso: el wrapper que hoy llama a `generateText`, y también `verifyKey`. Toma `steps.length` y el `usage` total del resultado; en error suma 1 pedido.
- El registro de uso **nunca** hace fallar una respuesta: si falla, se loguea el código y se sigue.
- Sin dependencias nuevas.

## Verificación
- **Integración**:
  - `set_stage` del bot con `venta` o `postventa` es rechazado por el esquema de la herramienta y la etapa no cambia;
  - `set_stage consulta` desde Postventa funciona;
  - el prompt incluye la etapa;
  - `deliverOrder` limpia `bot_paused_until`;
  - una respuesta con 2 pasos suma 2 pedidos y los tokens de ambos;
  - un 429 suma 1 pedido sin tokens;
  - el día se corta en Buenos Aires;
  - RLS de `ai_usage`.
- **Unitario**: el cálculo del porcentaje y el color de la barra (sin límite, con uno, con dos, al 80% y al 100%).
- **E2E**: la barra aparece en Clientes y en Catálogo; con un límite cargado muestra "N de M pedidos".

## Fuera de alcance
- Costo en dinero. Descuentos. Alertas por WhatsApp al acercarse al límite (*posible siguiente paso*).
