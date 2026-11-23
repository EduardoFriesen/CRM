# CRM Entrega 3 — Pedidos — Diseño

Fecha: 2026-11-23 · Estado: borrador para aprobación
Parte de: `docs/superpowers/specs/2026-11-23-crm-platform-design.md` (reemplaza la "agenda de pedidos" original). Se construye sobre la 2b.

## Intención
Cerrar el circuito de venta dentro del CRM. Cuando la venta se cierra (en general después del traspaso del bot), el admin genera el pedido desde la plataforma. El pedido descuenta stock y se sigue hasta la entrega. **Un cliente solo pasa a Postventa cuando su pedido fue entregado.**

## Objetivos
- Botón **"Crear pedido"** en las tarjetas de clientes que están en **Venta**.
- Pedido con:
  - cliente (nombre y teléfono, desde el contacto);
  - una o más líneas de producto del catálogo, con cantidad;
  - precio unitario congelado y total;
  - fecha de entrega;
  - dirección, localidad y notas de envío.
- Crear el pedido **descuenta stock**; cancelarlo lo **devuelve**.
- Estados del pedido: `pendiente → entregado | cancelado`.
- **Marcar entregado** pasa al cliente a **Postventa**.
- **Postventa requiere un pedido entregado**: ni el bot ni el selector de la tarjeta pueden llevar ahí a un cliente sin pedido entregado.
- **Tarjetas de pedidos abajo del tablero de Clientes**, agrupadas en Atrasados, Hoy, Mañana y Próximos; los entregados y cancelados quedan detrás de un filtro.

## No objetivos (por ahora)
- **Descuentos** (por medio de pago, promoción o cantidad, y precio especial): *decisión del usuario, se ignora por ahora*.
- Medio de pago y cobro. Pantalla de agenda aparte. Que el bot arme pedidos. Barra de consumo de tokens (pendiente aparte).

## Anti-objetivos
- Vender stock que no hay: si una línea supera el stock disponible, el pedido no se guarda.
- Que el stock quede descontado de más o de menos ante dos pedidos simultáneos o ante una cancelación doble.
- Que cambiar un precio del catálogo cambie pedidos ya hechos.

## Decisiones del usuario
| Tema | Decisión |
|---|---|
| Quién genera el pedido | El admin, desde la plataforma |
| Botón | En la tarjeta del cliente que está en Venta |
| Dónde se ven los pedidos | Tarjetas abajo del tablero de Clientes |
| Pasaje a Postventa | Solo cuando el pedido fue entregado |
| Stock | Se descuenta al crear el pedido |
| Descuentos | Fuera de esta entrega |

## Enfoques considerados
Un solo camino razonable sobre lo existente: tablas `orders` + `order_items`, con el descuento de stock en la **misma transacción** que crea el pedido. El descuento usa un `UPDATE … SET stock = stock - qty WHERE id = … AND (stock IS NULL OR stock >= qty) RETURNING`: si alguna línea no devuelve fila, se hace rollback y se informa qué producto no alcanza. Descartado: calcular el stock disponible sumando pedidos pendientes, que complicaría todas las lecturas del catálogo y del bot.

## Modelo de datos
- `orders`, con RLS:
  - `id`, `tenant_id`, `contact_id` → contacts;
  - `status` (`pending|delivered|cancelled`) default `pending`;
  - `delivery_date` date;
  - `address` (≤ 200), `locality` (≤ 100), `notes` (≤ 500);
  - `total` numeric(12,2);
  - `created_at`, `delivered_at` null, `cancelled_at` null.
- `order_items`, con RLS:
  - `id`, `tenant_id`, `order_id` → orders (cascade), `product_id` → products (**set null**: el pedido conserva el nombre aunque se borre el producto);
  - `product_name` (copia), `unit_price` numeric(12,2) (copia), `quantity` int > 0, `line_total`.
- Grants a `crm_app`: SELECT/INSERT/UPDATE en ambas tablas. **Sin DELETE**: los pedidos se cancelan, no se borran.

## Reglas
- **Crear** (`createOrder`):
  - solo para contactos en etapa **venta** (si no, `VALIDATION`);
  - de 1 a 30 líneas; cantidad de 1 a 10 000;
  - productos activos del negocio;
  - fecha de entrega de hoy en adelante, en hora de Buenos Aires;
  - dirección obligatoria; localidad y notas opcionales.
  - Las líneas repetidas del mismo producto se suman.
  - Total = Σ(cantidad × precio del catálogo en ese momento).
  - Si falta stock → `fail("OUT_OF_STOCK", "No hay stock suficiente de <producto> (quedan N)")`, sin guardar nada.
  - Los productos sin control de stock (`stock` null) no se descuentan.
- **Marcar entregado** (`deliverOrder`): solo desde `pending`. Pone `delivered_at` y mueve el contacto a **postventa**.
- **Cancelar** (`cancelOrder`): solo desde `pending`. Devuelve el stock de las líneas cuyo producto todavía existe y tiene control de stock. La etapa no cambia.
- **Postventa con pedido entregado**: `setContactStage(…, "postventa")` devuelve `fail("NEEDS_DELIVERED_ORDER", "Para pasar a Postventa el cliente necesita un pedido entregado")` si el contacto no tiene ningún pedido `delivered`.
  - Eso cubre el **selector de la tarjeta** y la **herramienta `set_stage` del bot**: la herramienta devuelve `ok:false` y el modelo sigue la charla.
  - Volver a Consulta o a Venta se permite siempre.
  - Un pedido cancelado no cuenta.

## UI (pantalla Clientes)
- **Tarjeta en Venta**: botón **"Crear pedido"** al lado del selector de etapa, fuera del link `wa.me`.
- **Formulario de pedido** (panel dentro de la página):
  - líneas con selector de producto activo (con precio y stock visibles) y cantidad, más "Agregar producto" y "Quitar";
  - fecha de entrega (`<input type="date">`), dirección, localidad y notas;
  - total calculado en vivo, que es solo una vista previa: el servidor recalcula.
  - Errores por campo y de stock junto a la línea. Se conserva lo cargado si falla.
- **Selector de etapa**: la opción Postventa aparece deshabilitada con "(requiere pedido entregado)" si el contacto no tiene uno.
- **Sección "Pedidos"** abajo del tablero:
  - tarjetas de pedidos pendientes agrupadas en **Atrasados · Hoy · Mañana · Próximos**, por fecha en Buenos Aires;
  - cada tarjeta muestra cliente, fecha, dirección y localidad, líneas, total y los botones **"Marcar entregado"** y **"Cancelar"** (con confirmación);
  - el filtro "Ver entregados y cancelados" muestra los últimos 50;
  - contempla los 4 estados (vacío: "Todavía no hay pedidos. Se crean desde un cliente en Venta.").

## Verificación
- **Integración**:
  - crear un pedido descuenta stock y congela precios;
  - con stock insuficiente → `OUT_OF_STOCK` y el stock queda intacto, incluida una segunda línea ya validada;
  - dos pedidos concurrentes por el último stock → solo uno se guarda;
  - cancelar devuelve el stock una sola vez (la segunda cancelación → `VALIDATION`);
  - entregar mueve a Postventa;
  - `setContactStage(postventa)` sin pedido entregado → `NEEDS_DELIVERED_ORDER`;
  - el bot con `set_stage` a postventa sin pedido no mueve la tarjeta;
  - crear un pedido para un contacto que no está en Venta → `VALIDATION`;
  - RLS de `orders` y `order_items`; `crm_app` no puede borrar pedidos.
- **E2E**:
  - crear un pedido desde una tarjeta en Venta → aparece en "Hoy" o "Próximos" y el stock baja en Catálogo;
  - marcar entregado → la tarjeta pasa a Postventa;
  - cancelar → el stock vuelve;
  - la opción Postventa está deshabilitada sin pedido entregado.

## Queda a criterio del implementador
- Diseño visual del formulario y de las tarjetas de pedido, dentro de la dirección existente.
- Ubicación del formulario: panel debajo de la tarjeta o `<dialog>` nativo.
