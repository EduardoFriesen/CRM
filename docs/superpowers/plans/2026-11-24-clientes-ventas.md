# Clientes y Ventas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Pestañas Clientes (directorio con estado e historial) y Ventas (pedidos entregados con filtros y totales); el tablero deja de listar pedidos cerrados.

**Architecture:** Dos módulos de consulta (`src/contacts/directory.ts`, `src/orders/sales.ts`) que parsean filtros con Zod y filtran en SQL bajo `withTenant`. Páginas server component con `<form method="get">`; sin JS de cliente nuevo.

**Tech Stack:** Next.js 16, Drizzle + Postgres (RLS), Zod, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-24-clientes-ventas-design.md`

## Global Constraints

- Página de 50; parámetros inválidos se ignoran (nunca error 500 por la URL).
- `%`, `_` y `\` del texto de búsqueda se escapan antes de `ilike`.
- Totales de Ventas: sobre todo el resultado filtrado, solo entregados.
- Textos: pestañas "Tablero", "Clientes", "Ventas"; estados "Compró", "Llegó a Venta sin comprar", "Nunca pasó de Consulta"; vacío con filtros "Ningún resultado con estos filtros".
- Comandos (desde `crm/`): `npx vitest run <archivo>`, `npm test`, `npm run lint`, `npx tsc --noEmit`, `npx playwright test <archivo>`.

## Review Focus

1. `?pagina=-3`, `?min=abc`, `?desde=2026-13-45` → la página carga sin filtro roto → tests en Task 1 y 2.
2. Búsqueda con `%` o `_` no matchea todo → test en Task 1.
3. Un pedido con dos ítems que coinciden con `producto` no se cuenta dos veces en los totales → test en Task 2.
4. Cliente de otro negocio nunca aparece (ni sus pedidos) → tests en Task 1 y 2.
5. Cliente sin teléfono ni nombre se muestra igual ("Sin nombre") → E2E Task 3.

---

### Task 1: `listCustomers`

**Files:** Create `crm/src/contacts/directory.ts`, `crm/src/contacts/directory.int.test.ts`; Create `crm/src/lib/like.ts` (+ `like.test.ts`).

**Interfaces — Produces:**
- `escapeLike(s: string): string` en `lib/like.ts`.
- `type Outcome = "compro" | "venta" | "consulta"`.
- `type CustomerRow = { id; name: string | null; phone: string | null; lastMessageAt: Date | null; stage: Stage; onBoard: boolean; outcome: Outcome; spent: string }`.
- `parseCustomerFilters(params: Record<string, string | string[] | undefined>): CustomerFilters` (`{ q?: string; estado?: Outcome; tablero?: "si" | "no"; pagina: number }`, inválidos → undefined / pagina 1).
- `listCustomers(tenantId: string, f: CustomerFilters): Promise<{ rows: CustomerRow[]; hasMore: boolean }>`.
- `listCustomerOrders(tenantId: string, contactIds: string[]): Promise<Map<string, OrderView[]>>` (todos los estados, más recientes primero).

- [ ] Tests (RED): `escapeLike` escapa `%`, `_`, `\`; `parseCustomerFilters` ignora estado/tablero/pagina inválidos; `listCustomers`: clasifica compró / venta (por `reached_venta_at`, por etapa venta, por pedido pendiente) / consulta; incluye cerrados y Consulta inactiva con `onBoard=false`; filtra `q` por nombre y teléfono (y `q="%"` no matchea todo); filtra `estado` y `tablero`; `spent` suma solo entregados; pagina de a 50 (`hasMore`); no ve otro negocio. `listCustomerOrders` agrupa por contacto.
- [ ] Implementar; `npx vitest run src/contacts/directory.int.test.ts src/lib/like.test.ts` → PASS; `npm test`.
- [ ] Commit `feat: list every customer with how far they got`.

### Task 2: `listSales` y limpieza de pedidos cerrados

**Files:** Create `crm/src/orders/sales.ts`, `crm/src/orders/sales.int.test.ts`; Modify `crm/src/orders/orders.ts` (`listOrders(tenantId)` solo pendientes; exportar `loadViews` con `offset`), `crm/src/orders/orders.int.test.ts`.

**Interfaces — Produces:**
- `parseSalesFilters(params): SalesFilters` (`{ producto?; cliente?; desde?: string; hasta?: string; min?: number; max?: number; cancelados: boolean; pagina: number }`; fechas `z.iso.date()`, montos ≥ 0).
- `listSales(tenantId: string, f: SalesFilters): Promise<{ orders: OrderView[]; hasMore: boolean; totals: { count: number; sum: string; avg: string } }>`.

- [ ] Tests (RED): por defecto solo entregados; `cancelados` suma cancelados y los totales siguen contando solo entregados; filtros producto (una vez aunque coincidan 2 ítems), cliente, desde/hasta inclusive, min/max; totales sobre todo el filtro aunque haya más de 50; paginado; otro negocio aislado; `parseSalesFilters` ignora fecha y montos inválidos.
- [ ] Implementar (`exists` sobre `order_items` para producto). `listOrders(tenantId)` sin la variante cerrada; ajustar sus 3 llamadas en tests.
- [ ] PASS + `npm test`; commit `feat: query delivered sales with filters and totals`.

### Task 3: Páginas, navegación y tablero

**Files:** Create `crm/src/app/t/[slug]/clientes/{page,loading,error}.tsx`, `crm/src/app/t/[slug]/ventas/{page,loading,error}.tsx`, `crm/src/app/t/[slug]/order-card.tsx` (movida desde `orders-section.tsx`), `crm/src/app/t/[slug]/list-nav.tsx` (paginado y "Limpiar"); Modify `tenant-nav.tsx`, `page.tsx` (h1 "Tablero", sin `pedidos=cerrados`), `orders-section.tsx`, `globals.css`; Test `crm/e2e/records.spec.ts`.

- [ ] E2E (RED): nav tiene Tablero/Clientes/Ventas; Clientes filtra por texto y estado y despliega el historial con total gastado; "Sin nombre" para un contacto sin datos; Ventas filtra por producto y muestra totales; filtros sin resultados muestran "Ningún resultado con estos filtros" y "Limpiar filtros"; el tablero ya no tiene "Ver entregados y cancelados".
- [ ] Implementar; `npx playwright test` completo → PASS; revisión visual escritorio y 375 px sin scroll horizontal.
- [ ] README (pestañas Clientes y Ventas) + verificación final (lint, tsc, test, E2E, audit, gitleaks). Commit `feat: add Clientes and Ventas tabs` y `docs: describe the Clientes and Ventas tabs`.
