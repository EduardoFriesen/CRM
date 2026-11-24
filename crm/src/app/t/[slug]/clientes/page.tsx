import { listCustomerOrders, listCustomers, parseCustomerFilters, type CustomerRow, type Outcome } from "@/contacts/directory";
import { waLink } from "@/contacts/wa-link";
import { formatPrice } from "@/lib/money";
import type { Params } from "@/lib/params";
import { relativeTime } from "@/lib/time";
import type { OrderView } from "@/orders/orders";
import { getCurrentTenant } from "@/tenants/tenants";
import { EmptyList, FilterActions, Pager } from "../list-nav";
import { OrderCard } from "../order-card";
import { STAGE_LABELS } from "../stages";

export const dynamic = "force-dynamic";

const OUTCOME_LABELS: Record<Outcome, string> = {
  compro: "Compró",
  venta: "Llegó a Venta sin comprar",
  consulta: "Nunca pasó de Consulta",
};

export default async function CustomersPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Params> }) {
  const tenant = await getCurrentTenant((await params).slug);
  const f = parseCustomerFilters(await searchParams);
  const { rows, hasMore } = await listCustomers(tenant.id, f);
  const history = await listCustomerOrders(tenant.id, rows.map((r) => r.id));
  const base = `/t/${tenant.slug}/clientes`;
  const { pagina, ...query } = f;
  const filtered = Object.keys(query).length > 0;
  const now = new Date();

  return (
    <main className="page">
      <div className="page-head">
        <h1>Clientes</h1>
        <p className="meta">Todos los que escribieron, también los que ya no están en el tablero.</p>
      </div>
      <form method="get" action={base} className="filters" role="search" aria-label="Filtrar clientes">
        <div className="field">
          <label htmlFor="q">Buscar</label>
          <input id="q" name="q" type="search" defaultValue={f.q ?? ""} placeholder="Nombre o teléfono" autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="estado">Estado</label>
          <select id="estado" name="estado" defaultValue={f.estado ?? ""}>
            <option value="">Todos</option>
            {Object.entries(OUTCOME_LABELS).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="tablero">Tablero</label>
          <select id="tablero" name="tablero" defaultValue={f.tablero ?? ""}>
            <option value="">Todos</option>
            <option value="si">En el tablero</option>
            <option value="no">Fuera del tablero</option>
          </select>
        </div>
        <FilterActions clearHref={base} active={filtered} />
      </form>

      {rows.length === 0 ? (
        <EmptyList filtered={filtered}>
          Todavía no te escribió nadie. Los clientes aparecen acá cuando le escriben al WhatsApp del negocio.
        </EmptyList>
      ) : (
        <ul className="customers">
          {rows.map((c) => (
            <li key={c.id}>
              <Customer c={c} orders={history.get(c.id) ?? []} slug={tenant.slug} now={now} />
            </li>
          ))}
        </ul>
      )}
      <Pager base={base} query={query} page={pagina} hasMore={hasMore} />
    </main>
  );
}

function Customer({ c, orders, slug, now }: { c: CustomerRow; orders: OrderView[]; slug: string; now: Date }) {
  const name = c.name ?? (c.phone ? `+${c.phone}` : "Sin nombre");
  const chat = waLink(c.phone);
  return (
    <details className="customer">
      <summary>
        <span className="customer-who">
          <span className="card-name">{name}</span>
          <span className="card-phone mono">{c.phone ? `+${c.phone}` : "Sin número visible"}</span>
        </span>
        <time className="card-time" dateTime={c.lastMessageAt?.toISOString()}>
          {relativeTime(c.lastMessageAt, now)}
        </time>
        <span className={`tag ${c.onBoard ? `stage-${c.stage}` : "off"}`}>{c.onBoard ? STAGE_LABELS[c.stage] : "Fuera del tablero"}</span>
        <span className={`tag outcome-${c.outcome}`}>{OUTCOME_LABELS[c.outcome]}</span>
        <span className="customer-spent">{Number(c.spent) > 0 ? formatPrice(c.spent) : ""}</span>
      </summary>
      <div className="customer-body">
        <p className="meta">
          Total gastado {formatPrice(c.spent)}
          {chat && (
            <>
              {" · "}
              <a href={chat} target="_blank" rel="noopener noreferrer">
                Abrir chat<span className="visually-hidden"> en WhatsApp, en otra pestaña</span>
              </a>
            </>
          )}
        </p>
        {orders.length === 0 ? (
          <p className="meta-note">Todavía no tiene pedidos.</p>
        ) : (
          <ul className="order-cards">
            {orders.map((o) => (
              <li key={o.id}>
                <OrderCard order={o} slug={slug} readOnly />
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
