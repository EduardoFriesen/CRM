# Tablero como panel de tareas actuales

Fecha: 2026-11-24 · Tamaño: cambio mediano

## Intención

El tablero es el panel de control de lo que hay que atender **ahora**: conversaciones activas y pedidos sin entregar. Lo terminado se saca del tablero y queda solo como registro (las pestañas Clientes y Ventas, que se diseñan aparte).

1. **"Cerrar venta"** en las tarjetas de Postventa: saca al cliente del tablero.
2. **Cruz (×)** en la esquina de las tarjetas de Consulta: saca al cliente del tablero a mano.
3. **Consultas inactivas:** un cliente en Consulta que no conversa hace más de N días (por defecto 1) sale solo de la columna. N se configura en una pestaña nueva **Configuración**.
4. Un cliente que salió del tablero y vuelve a escribir es una **conversación nueva**: aparece en Consulta y el bot arranca de cero.
5. **Traspaso que no se ejecuta:** un cliente que ya tuvo un traspaso tiene que poder pasar a Venta otra vez.

Los pedidos pendientes siguen en el tablero como hoy.

## Causa del punto 5 (verificada)

El historial que recibe el modelo guarda solo el texto de los mensajes del bot, no las herramientas que usó. Después de un primer traspaso, el historial contiene "Bárbaro, ya te atiende alguien del equipo…" como mensaje suelto; el modelo (qwen3:8b) lo copia y no llama a `handoff_to_admin`. Reproducido contra Ollama:

| Historial | Llamó a `handoff_to_admin` |
|---|---|
| sin traspaso previo | 8/8 |
| traspaso previo solo como texto | 0/8 (copia la frase) |
| traspaso previo como llamada a la herramienta + texto | 8/8 |

Pasa en Postventa y en Consulta.

## Objetivos / no objetivos

- Objetivo: el tablero muestra solo conversaciones activas y pedidos pendientes.
- Objetivo: empezar a guardar hasta dónde llegó cada cliente, para que la futura pestaña Clientes lo muestre.
- No objetivo: las pestañas Clientes y Ventas (diseños aparte, a continuación).
- No objetivo: quitar tarjetas de Venta (siguen hasta que el admin las mueve o hay pedido).
- Antiobjetivo: perder pedidos o mensajes al sacar a alguien del tablero. Nada se borra.

## Enfoques considerados

- **A. Columna `closed_at` en `contacts`** (elegido). El tablero filtra los cerrados; las tres etapas no cambian; la fecha permite arrancar una conversación nueva.
- B. Cuarta etapa `cerrado`. Descartado: las etapas se usan en columnas, selector, prompt y tipos, y se pierde la fecha.

Consultas inactivas:

- **Filtro en la consulta del tablero** (elegido): una Consulta con `last_message_at` más viejo que N días no se muestra. Sin tareas programadas; cambiar N aplica al instante, también hacia atrás.
- Tarea periódica que marca `closed_at`: suma un job y un horario, y cambiar N no afecta a los ya cerrados.

Traspaso:

- **Guardar qué mensajes del bot fueron un traspaso y reconstruirlos en el historial como llamada a la herramienta + texto** (elegido): probado 8/8, cubre todos los casos.
- Cortar el historial en la última entrega: no cubre al cliente que tuvo un traspaso sin pedido.
- Detectar por texto que el modelo "anunció" un traspaso: frágil.

## Diseño

- **Migración 0018:**
  - `contacts.closed_at timestamptz null` (null = en el tablero), `contacts.reopened_at timestamptz null`, `contacts.reached_venta_at timestamptz null`.
  - `messages.handoff boolean not null default false`.
  - `tenants.consulta_idle_days smallint not null default 1`, check 1–30.
  - RLS y grants igual que las columnas existentes.
- **Cerrar / quitar:** `closeContact(tenantId, contactId)` en `contacts.ts` pone `closed_at = now()` si la etapa es Postventa o Consulta y no está cerrado; si no, `NOT_CLOSABLE` / `NOT_FOUND`. Una server action la usa desde dos botones: "Cerrar venta" (Postventa) y "×" (Consulta, con `aria-label="Quitar a <nombre> del tablero"`). Sin confirmación: no se pierde nada y el cliente reaparece si escribe. Estados pendiente y error como `ReactivateButton`.
- **Tablero:** `listBoard` excluye `closed_at is not null` y las Consultas con `last_message_at < now() - consulta_idle_days`. El contador cuenta solo lo visible.
- **Reapertura (webhook):** un mensaje **del cliente** (no `fromMe`) sobre un contacto cerrado, o en Consulta inactiva, pone `closed_at = null`, `reopened_at = now()`, `stage = 'consulta'`, `bot_paused_until = null`. Los mensajes del número del negocio no reabren.
- **Conversación nueva:** `loadConversation` toma solo mensajes con `sent_at >= reopened_at` (si hay), y el cálculo de "presentarse" mira solo mensajes del bot desde ahí.
- **Hasta dónde llegó:** `reached_venta_at` se pone (si es null) en `handoff_to_admin` y al pasar a Venta desde el selector. Con eso y los pedidos entregados, la pestaña Clientes podrá clasificar: compró / llegó a Venta sin comprar / nunca pasó de Consulta. Los clientes ya existentes se clasifican por etapa actual y pedidos.
- **Traspaso en el historial:** cuando `handoff_to_admin` se ejecutó en el turno, el mensaje del bot se guarda con `handoff = true`. Al armar el historial, esos mensajes van como `tool-call handoff_to_admin` + `tool-result {ok:true}` + el texto. Un único helper arma el historial para la respuesta normal y para el relay.
- **Configuración:** pestaña nueva `/t/[slug]/configuracion` con un campo "Quitar consultas sin actividad después de N días" (1–30), validado con Zod en el servidor. Estados ideal, cargando, error y guardado.

## Verificación

- Integración: `closeContact` (Postventa, Consulta, Venta rechazado, otro tenant), tablero sin cerrados ni Consultas inactivas, cambio de N, reapertura por webhook (cliente sí, negocio no), historial desde `reopened_at`, `reached_venta_at`, mensaje de traspaso marcado y reconstruido.
- E2E: "Cerrar venta" y "×" sacan la tarjeta; Configuración guarda N.
- Eval: escenario nuevo "segundo traspaso" con un traspaso previo en el historial.

## Queda para quien construye

- Si el relay (que corre sin herramientas) acepta llamadas a herramientas en el historial con todos los proveedores; si no, el relay manda solo el texto.
