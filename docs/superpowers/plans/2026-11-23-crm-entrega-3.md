# CRM Entrega 3 (Pedidos) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El admin crea pedidos desde las tarjetas en Venta, el pedido descuenta stock, y el cliente pasa a Postventa solo cuando un pedido suyo se entrega.

**Architecture:** Tablas `orders` y `order_items` con RLS. Un módulo `src/orders/orders.ts` hace crear, entregar y cancelar en transacciones únicas (el stock se descuenta y se devuelve con `UPDATE … WHERE stock >= qty RETURNING`). `setContactStage` exige un pedido entregado para Postventa, lo que cubre la UI y la herramienta `set_stage` del bot. La UI vive en la pantalla Clientes: botón en la tarjeta, formulario y sección de pedidos debajo del tablero.

**Tech Stack:** el existente (Next.js 16, Drizzle + RLS, Zod, Vitest, Playwright).

**Spec:** `docs/superpowers/specs/2026-11-23-crm-entrega-3-design.md`

## Global Constraints

- Lo de las entregas anteriores sigue vigente: RLS vía `withTenant`, contrato `Result`, Zod, 4 estados de UI, WCAG AA, sin PII en logs y commits convencionales con el trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Límites:
  - 1–30 líneas por pedido;
  - cantidad entre 1 y 10 000;
  - dirección 1–200 caracteres, localidad ≤ 100, notas ≤ 500;
  - fecha de entrega ≥ hoy en `America/Argentina/Buenos_Aires`.
- Copias exactas:
  - `fail("OUT_OF_STOCK", "No hay stock suficiente de <producto> (quedan N)")`;
  - `fail("NEEDS_DELIVERED_ORDER", "Para pasar a Postventa el cliente necesita un pedido entregado")`;
  - opción deshabilitada: `Postventa (requiere pedido entregado)`;
  - vacío: `Todavía no hay pedidos. Se crean desde un cliente en Venta.`
- Sin DELETE de pedidos para `crm_app`. Los productos borrados quedan como `product_id` null en las líneas, que conservan `product_name` y `unit_price`.
- Rama: `feat/crm-entrega-3`.

## Review Focus

1. **Dos pedidos simultáneos por el último stock**: solo uno se guarda; el otro recibe `OUT_OF_STOCK` → test en Task 2.
2. **Una segunda línea sin stock cuando la primera ya descontó**: rollback total, el stock queda como estaba → test en Task 2.
3. **Cancelar dos veces el mismo pedido** (doble click): el stock vuelve una sola vez → test en Task 2.
4. **El mismo producto en dos líneas**: se suman y se valida el stock contra el total → test en Task 2.
5. **El bot intenta `set_stage` postventa sin pedido entregado**: la tarjeta no se mueve → test en Task 2.

---

### Task 1: Esquema de pedidos

**Files:**
- Modify: `crm/src/db/schema.ts`
- Create: migración generada + custom `crm/drizzle/00NN_orders_rls.sql`, `crm/src/db/orders-schema.int.test.ts`

**Interfaces:**
- Produces:
  - `orderStatus` pgEnum(`pending`,`delivered`,`cancelled`).
  - `orders(id, tenant_id, contact_id → contacts cascade, status default pending, delivery_date date, address, locality default '', notes default '', total numeric(12,2), created_at, delivered_at null, cancelled_at null)`.
  - `order_items(id, tenant_id, order_id → orders cascade, product_id → products set null, product_name, unit_price numeric(12,2), quantity int CHECK > 0, line_total numeric(12,2))`.
  - Types `Order`, `OrderItem`.
  - SQL: RLS `tenant_isolation` en ambas tablas; `GRANT SELECT, INSERT, UPDATE` en ambas a `crm_app`.

- [ ] **Step 1: Escribir los tests.**
  - `withTenant(A)` no ve pedidos de B;
  - `crm_app` no puede `delete from orders` (`permission denied`);
  - `quantity = 0` falla por el check;
  - borrar un producto deja `order_items.product_id` en null y conserva `product_name`.
- [ ] **Step 2: Ver el FAIL.**
- [ ] **Step 3: Implementar.** Schema, `db:generate` y migración custom. Reconstruir `crm` y `crm-worker` después de migrar la base de dev.
- [ ] **Step 4: `npx vitest run`.** Esperado: PASS.
- [ ] **Step 5: Commit** `feat: add orders schema`

### Task 2: Lógica de pedidos y regla de Postventa

**Files:**
- Create: `crm/src/orders/orders.ts`, `crm/src/orders/orders.int.test.ts`, `crm/src/orders/group.ts` (+ `group.test.ts`)
- Modify: `crm/src/contacts/contacts.ts` (`setContactStage` + `listBoard`), `crm/src/contacts/contacts.int.test.ts`, `crm/src/bot/reply.int.test.ts`

**Interfaces:**
- Produces:
  - `orderInput = z.object({ contactId: z.uuid(), items: z.array(z.object({ productId: z.uuid(), quantity: z.coerce.number().int().min(1).max(10000) })).min(1).max(30), deliveryDate: z.iso.date(), address: z.string().trim().min(1).max(200), locality: z.string().trim().max(100).default(""), notes: z.string().trim().max(500).default("") })`. La fecha se valida además contra hoy en Buenos Aires.
  - `type OrderView = Order & { contactName: string | null; contactPhone: string | null; items: OrderItem[] }`.
  - `createOrder(tenantId, input: unknown): Promise<Result<OrderView>>`. Errores:
    - `VALIDATION`, incluido "el cliente no está en Venta";
    - `NOT_FOUND`, si el producto no es del negocio o no está activo;
    - `OUT_OF_STOCK`.
  - `deliverOrder(tenantId, orderId): Promise<Result<OrderView>>`: solo desde `pending`; pone la etapa del contacto en `postventa`.
  - `cancelOrder(tenantId, orderId): Promise<Result<OrderView>>`: solo desde `pending`, con update condicional por estado; devuelve stock.
  - `listOrders(tenantId, opts: { closed: boolean }): Promise<OrderView[]>`. Pendientes: todas, por `delivery_date` ascendente. Cerrados: los últimos 50 por fecha de cierre.
  - `groupOrders(orders: OrderView[], now: Date): { overdue: OrderView[]; today: OrderView[]; tomorrow: OrderView[]; upcoming: OrderView[] }`, con fechas en Buenos Aires.
  - `setContactStage`: si `stage === "postventa"` y el contacto no tiene un pedido `delivered` → `NEEDS_DELIVERED_ORDER`.
  - `BoardContact` suma `hasDeliveredOrder: boolean`.

- [ ] **Step 1: Escribir los tests.**
  - `orders.int.test.ts`:
    - crear con 2 líneas (Pan $2.500 × 2, Medialunas $4.800 × 1) → total `"9800.00"`, `unit_price` congelado; el stock baja de 10 a 8 y de 5 a 4; un producto con stock null no cambia;
    - Review Focus 2: la línea 1 con stock suficiente y la línea 2 sin stock → `OUT_OF_STOCK` con el mensaje exacto ("No hay stock suficiente de Medialunas (quedan 0)"), sin pedido creado y el stock de la línea 1 intacto;
    - Review Focus 4: el mismo producto en dos líneas (3 + 3) con stock 5 → `OUT_OF_STOCK`; con stock 6 → una sola línea de 6;
    - Review Focus 1: dos `createOrder` en paralelo (`Promise.all`) por un stock de 1 → exactamente uno `success`;
    - un contacto en `consulta` → `VALIDATION`;
    - fecha de ayer → `VALIDATION`;
    - un producto pausado → `NOT_FOUND`;
    - `deliverOrder` → `delivered` y el contacto en `postventa`;
    - Review Focus 3: `cancelOrder` dos veces → la segunda `VALIDATION` y el stock vuelve una sola vez;
    - `listOrders` de A no trae pedidos de B.
  - `group.test.ts`: con `now` = 2026-11-24T15:00Z → los pedidos del 23 en `overdue`, del 24 en `today`, del 25 en `tomorrow` y del 28 en `upcoming`.
  - `contacts.int.test.ts`:
    - `setContactStage(..., "postventa")` sin pedido → `NEEDS_DELIVERED_ORDER`;
    - con un pedido entregado → ok;
    - con uno solo cancelado → `NEEDS_DELIVERED_ORDER`;
    - `listBoard` trae `hasDeliveredOrder`.
  - `reply.int.test.ts`, Review Focus 5: un modelo falso que llama `set_stage({stage:"postventa"})` sin pedido → la etapa del contacto no cambia.
- [ ] **Step 2: Ver el FAIL.**
- [ ] **Step 3: Implementar.**
  - **`createOrder`**, dentro de `withTenant`:
    1. valida el contacto en `venta`;
    2. suma las líneas por producto;
    3. lee los productos activos y valida que existan todos;
    4. para cada producto con stock, `update products set stock = stock - q where id = … and stock >= q returning stock`; si no hay fila, lanza un error interno que se mapea a `OUT_OF_STOCK` fuera de la transacción, para que haya rollback;
    5. inserta el pedido y las líneas.
  - **`cancelOrder`**: `update orders set status='cancelled' … where id=… and status='pending' returning`; si devuelve fila, repone el stock de las líneas con `product_id` no null de productos con stock no null.
- [ ] **Step 4: `npx vitest run`.** Esperado: PASS.
- [ ] **Step 5: Commit** `feat: create, deliver and cancel orders with stock control`

### Task 3: UI de pedidos en Clientes

**Files:**
- Create: `crm/src/app/t/[slug]/order-form.tsx`, `crm/src/app/t/[slug]/orders-section.tsx`, `crm/src/app/t/[slug]/order-actions.tsx`, `crm/e2e/orders.spec.ts`
- Modify: `crm/src/app/t/[slug]/{page.tsx,actions.ts,stage-select.tsx}`, `crm/src/app/globals.css`

**Interfaces:**
- Consumes: `createOrder`, `deliverOrder`, `cancelOrder`, `listOrders`, `groupOrders`, `hasDeliveredOrder` (Task 2); `listProducts` (`crm/src/catalog/catalog.ts`); `formatPrice`.
- Produces: server actions `createOrderAction(slug, input)`, `deliverOrderAction(slug, id)` y `cancelOrderAction(slug, id)`; todas revalidan `/t/<slug>` y `/t/<slug>/catalogo`.

- [ ] **Step 1: Escribir el E2E `orders.spec.ts`.** Siembra un negocio, "Pan de campo" a $2.500 con stock 10 y una clienta "Ana" en venta.
  - La tarjeta de Ana tiene "Crear pedido";
  - una tarjeta en Consulta no lo tiene;
  - el selector de Ana muestra la opción `Postventa (requiere pedido entregado)` deshabilitada;
  - crear un pedido de 2 panes para hoy, con dirección "Av. Siempre Viva 742" → aparece en la sección Pedidos, grupo "Hoy", con total `$5.000`; en `/catalogo` el stock de Pan muestra 8;
  - "Marcar entregado" → Ana aparece en la columna Postventa;
  - otro pedido y después "Cancelar" con confirmación → el stock vuelve;
  - pedir 50 panes → error junto a la línea con "No hay stock suficiente de Pan de campo", conservando lo cargado;
  - sin pedidos → se ve el texto vacío exacto.
- [ ] **Step 2: Ver el FAIL.**
- [ ] **Step 3: Implementar** con la skill `impeccable`, respetando la dirección visual.
  - El formulario es un `<dialog>` nativo con líneas dinámicas (select de productos activos con precio y stock, más la cantidad), fecha (`<input type="date" min=hoy>`), dirección, localidad, notas y el total en vivo.
  - La sección Pedidos va debajo del tablero, con grupos y el filtro "Ver entregados y cancelados".
  - Los botones con transition y try/catch, como `reactivate-button.tsx`. `aria-label` con el nombre del cliente.
- [ ] **Step 4: `npx vitest run && npx playwright test`.** Esperado: PASS.
- [ ] **Step 5: Commit** `feat: add order form and orders section to the customer board`

### Task 4: Documentación y cierre

- [ ] **Step 1: README.** Sección "Pedidos":
  - se crean desde un cliente en Venta y descuentan stock;
  - cancelar devuelve el stock;
  - marcar entregado pasa a Postventa;
  - Postventa requiere un pedido entregado.

  Checklist manual con un pedido real.
- [ ] **Step 2: Verificación final.** `cd crm && npx vitest run && npx playwright test && npm run lint && npm run typecheck && npm audit --audit-level=high`; reconstruir el stack; `bash tests/static.sh && bash tests/smoke.sh && bash tests/db-isolation.sh && gitleaks detect --no-banner --redact`. Esperado: todo verde.
- [ ] **Step 3: Commit** `docs: document orders`
