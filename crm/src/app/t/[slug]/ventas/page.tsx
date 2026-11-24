import { formatPrice } from "@/lib/money";
import type { Params } from "@/lib/params";
import { listSales, parseSalesFilters } from "@/orders/sales";
import { getCurrentTenant } from "@/tenants/tenants";
import { EmptyList, FilterActions, Pager } from "../list-nav";
import { OrderCard } from "../order-card";

export const dynamic = "force-dynamic";

export default async function SalesPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Params> }) {
  const tenant = await getCurrentTenant((await params).slug);
  const f = parseSalesFilters(await searchParams);
  const { orders, hasMore, totals } = await listSales(tenant.id, f);
  const base = `/t/${tenant.slug}/ventas`;
  const { pagina, ...query } = f;
  const filtered = Object.entries(query).some(([, v]) => v !== undefined && v !== false);

  return (
    <main className="page">
      <div className="page-head">
        <h1>Ventas</h1>
        <p className="meta">Pedidos entregados. Los pendientes están en el Tablero.</p>
      </div>
      <form method="get" action={base} className="filters" role="search" aria-label="Filtrar ventas">
        <div className="field">
          <label htmlFor="producto">Producto</label>
          <input id="producto" name="producto" type="search" defaultValue={f.producto ?? ""} autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="cliente">Cliente</label>
          <input id="cliente" name="cliente" type="search" defaultValue={f.cliente ?? ""} placeholder="Nombre o teléfono" autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="desde">Entrega desde</label>
          <input id="desde" name="desde" type="date" defaultValue={f.desde ?? ""} />
        </div>
        <div className="field">
          <label htmlFor="hasta">Entrega hasta</label>
          <input id="hasta" name="hasta" type="date" defaultValue={f.hasta ?? ""} />
        </div>
        <div className="field">
          <label htmlFor="min">Monto mínimo</label>
          <input id="min" name="min" type="number" min={0} step="any" inputMode="decimal" defaultValue={f.min ?? ""} />
        </div>
        <div className="field">
          <label htmlFor="max">Monto máximo</label>
          <input id="max" name="max" type="number" min={0} step="any" inputMode="decimal" defaultValue={f.max ?? ""} />
        </div>
        <label className="check">
          <input type="checkbox" name="cancelados" value="si" defaultChecked={f.cancelados} /> Incluir cancelados
        </label>
        <FilterActions clearHref={base} active={filtered} />
      </form>

      <dl className="totals" aria-label="Totales de las ventas filtradas">
        <div>
          <dt>Ventas</dt>
          <dd>{totals.count === 1 ? "1 venta" : `${totals.count} ventas`}</dd>
        </div>
        <div>
          <dt>Monto</dt>
          <dd>Total {formatPrice(totals.sum)}</dd>
        </div>
        <div>
          <dt>Ticket promedio</dt>
          <dd>{formatPrice(totals.avg)}</dd>
        </div>
      </dl>

      {orders.length === 0 ? (
        <EmptyList filtered={filtered}>
          Todavía no hay ventas entregadas. Aparecen acá cuando marcás un pedido como entregado.
        </EmptyList>
      ) : (
        <ul className="order-cards">
          {orders.map((o) => (
            <li key={o.id}>
              <OrderCard order={o} slug={tenant.slug} />
            </li>
          ))}
        </ul>
      )}
      <Pager base={base} query={query} page={pagina} hasMore={hasMore} />
    </main>
  );
}
