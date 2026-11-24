# Pestañas Clientes y Ventas

Fecha: 2026-11-24 · Tamaño: cambio mediano · Sigue a `2026-11-24-close-sale-design.md`

## Intención

El tablero es el panel de lo actual; lo demás es **registro**. Dos pestañas nuevas para consultarlo:

- **Clientes:** todos los que escribieron alguna vez (también los que salieron del tablero), con su estado (compró / llegó a Venta sin comprar / nunca pasó de Consulta), filtrables, y su historial de compras al tocar la tarjeta.
- **Ventas:** los pedidos entregados, filtrables por producto, cliente, fecha y monto, con totales.

Los pedidos pendientes siguen en el tablero; "Ver entregados y cancelados" sale del tablero porque eso vive en Ventas. La pestaña del tablero pasa a llamarse **Tablero** para no chocar con Clientes.

## Enfoques considerados

- **Filtros en la URL, resueltos en el servidor** (elegido): un `<form method="get">` arma los parámetros; la página (server component) filtra en SQL. Funciona sin JS, sobrevive a recargar y se comparte como link. Paginado de 50.
- Filtrado en el cliente: obliga a mandar todos los registros al navegador; no escala y duplica lógica.

## Diseño

**Clientes** (`/t/[slug]/clientes`)
- Estado derivado en SQL: **Compró** = tiene un pedido entregado; **Llegó a Venta sin comprar** = no compró y (`reached_venta_at` no null, o etapa venta/postventa, o tiene algún pedido); **Nunca pasó de Consulta** = el resto. Los clientes anteriores a `reached_venta_at` que pasaron por Venta sin pedido figuran como "nunca pasó de Consulta".
- "Fuera del tablero" = `closed_at` no null o Consulta inactiva (`idleConsulta`).
- Fila: nombre, teléfono, último mensaje (relativo), etapa o "Fuera del tablero", estado, total gastado (suma de entregados).
- Filtros: `q` (nombre o teléfono, contiene, sin distinguir mayúsculas), `estado` (`compro` | `venta` | `consulta`), `tablero` (`si` | `no`), `pagina`. Orden: último mensaje, más reciente primero.
- Historial: `<details>` nativo por cliente con sus pedidos (fecha de entrega, productos, cantidades, total, estado), total gastado y link al chat.

**Ventas** (`/t/[slug]/ventas`)
- Por defecto, pedidos entregados; `cancelados=si` suma los cancelados.
- Filtros: `producto` (nombre del ítem contiene), `cliente` (nombre o teléfono contiene), `desde` / `hasta` (fecha de entrega, inclusive), `min` / `max` (total), `pagina`. Orden: fecha de entrega, más reciente primero.
- Totales sobre todo el resultado filtrado (no solo la página), contando solo entregados: cantidad, monto total, ticket promedio.
- La tarjeta de pedido se reutiliza del tablero.

**Común**
- Validación de parámetros con Zod en el servidor; valores inválidos se ignoran (filtro vacío), no rompen la página. Los comodines `%` y `_` del texto se escapan.
- Cuatro estados: ideal, cargando (skeleton), error (reintentar), vacío (distinto si hay filtros: "Ningún resultado con estos filtros" + limpiar).

## No objetivos

Exportar a CSV, gráficos, editar clientes. Se agregan si hacen falta.

## Verificación

Integración para los filtros, el estado derivado, los totales y el aislamiento entre negocios; E2E para filtrar y desplegar el historial; revisión visual escritorio y celular.
