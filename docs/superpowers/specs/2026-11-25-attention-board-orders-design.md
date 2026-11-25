# Atención sin venta, botones del tablero y edición de pedidos

Fecha: 2026-11-25 · Rama: `feat/faq-router` · Aprobado en conversación.

## Intención

Hoy todo traspaso a una persona mueve al cliente a Venta y pausa el bot unas horas. Pero muchos
traspasos no son ventas (pidió más stock del que hay, un reclamo, quiere hablar con alguien): el
tablero miente sobre la etapa y el bot vuelve solo cuando nadie resolvió nada. Además, el
selector de etapa permite movimientos que no tienen sentido (Venta → Postventa sin pedido
entregado) y los pedidos no se pueden corregir una vez creados.

## Objetivos

### A. Atención
1. Dos tipos de traspaso:
   - **Venta** (quiere comprar, pagar o reservar): como hoy → Venta + pausa de `pauseHours`.
   - **Atención** (cantidad mayor al stock, reclamo, quiere hablar con una persona): **no cambia
     la etapa**, la tarjeta queda **roja** con el motivo, el **bot se apaga sin vencimiento** y
     **se avisa al administrador** por WhatsApp.
2. Mientras está en atención o con el bot apagado, el bot no contesta (aunque el cliente escriba).
3. "Reactivar bot" limpia la atención, el apagado y la pausa.
4. Cerrar la conversación y que el cliente vuelva a escribir la reabre limpia (sin atención ni
   apagado).

### A. Botones por columna

| Consulta | Venta | Postventa |
|---|---|---|
| × cerrar (existe) | × cerrar (nuevo) | Selector de etapa (queda) |
| **Pasar a Venta** | **Volver a Consulta** | Cerrar venta (existe) |
| Reactivar bot (si pausado/apagado) | Reactivar bot (si pausado/apagado) | **Activar / Desactivar bot** |
| — | Crear pedido, o **Editar pedido** si tiene uno pendiente | — |

- Sin selector de etapa en Consulta ni en Venta (a Postventa solo se llega entregando un pedido).
- La × de Venta pide confirmación y **no cierra si hay un pedido pendiente** (primero entregarlo o
  cancelarlo); el servidor también lo rechaza.

### B. Pedidos
1. **Editar pedido** mientras está pendiente: productos, cantidades, fecha, dirección, localidad,
   notas. El stock se ajusta en la misma transacción (devuelve lo que tomó, toma lo nuevo) y se
   rechaza si no alcanza, como al crear. Desde la tarjeta del pedido y desde la del cliente en Venta.
2. **Atrasados en rojo:** cada tarjeta de pedido atrasado se ve en rojo. Se mantienen los grupos
   existentes (Atrasados, Hoy, Mañana, Próximos), ya ordenados por fecha de entrega.

## No-objetivos
- Cambiar la pausa automática cuando el admin escribe a mano (sigue siendo `pauseHours`).
- Editar pedidos entregados o cancelados.
- Historial de cambios de un pedido.

## Anti-objetivos
- Un reclamo que termina en Venta, o un cliente en atención al que el bot le sigue contestando.
- Un pedido editado que deja el stock mal (descontado dos veces o sin devolver).
- Un pedido pendiente huérfano porque se cerró la conversación.

## Diseño

### Datos (`contacts`, una migración)
- `bot_off boolean not null default false` — apagado manual o por atención, sin vencimiento.
- `attention_reason text` (null = sin atención) y `attention_at timestamptz`.
- Se eligió un campo propio en vez de `bot_paused_until` lejano para no mezclarlo con la pausa
  temporal del admin.

### Bot
- Router: `handoff` queda para compra/pago/reserva; nueva función `attention({ reason })` para
  reclamo o pedido de hablar con una persona. Postventa permite `attention` y ya no `handoff`
  (una compra nueva en Postventa la maneja el pesado, que sabe volver a Consulta).
- Presupuesto con cantidad mayor al stock → atención (antes: traspaso a Venta).
- Modelo pesado: nueva herramienta `attention_to_admin({ reason })` para reclamos o pedido de
  persona; `handoff_to_admin` queda para cerrar una compra.
- Plantilla al cliente: la de traspaso actual (ya es neutra).
- Aviso al admin: texto nuevo "⚠️ <cliente> necesita atención: <motivo>" (mismo canal que el
  traspaso).
- `runConversation` y el webhook no responden si `bot_off`.

### Tablero
- `listBoard` suma `botOff`, `attentionReason` y `pendingOrderId` (pendiente más próximo).
- Tarjeta con `attentionReason` → clase roja y el motivo visible; "Bot apagado" visible si
  `botOff`.

## Restricciones
- Todo por `withTenant`; acciones validan ids con Zod; errores sin detalles internos.
- Accesibilidad: botones con texto o `aria-label` con el nombre del cliente; el rojo siempre
  acompañado de texto (no solo color).
- Estados de UI: los botones muestran pendiente/errores como los existentes.

## Enfoques considerados
- Bot apagado: **campo `bot_off` (elegido)** vs `bot_paused_until` en una fecha lejana (se mezcla
  con la pausa del admin y el "Bot pausado hasta…" mostraría una fecha absurda).
- Atención en el router: **función propia (elegido)** vs clasificar el motivo de `handoff` con
  palabras clave (frágil).
- Atrasados: **grupos actuales + tarjeta roja (elegido)** vs lista plana por fecha.
