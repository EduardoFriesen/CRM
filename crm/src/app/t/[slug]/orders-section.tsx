import Link from "next/link";
import { formatPrice } from "@/lib/money";
import { groupOrders } from "@/orders/group";
import type { OrderView } from "@/orders/orders";
import { OrderActions } from "./order-actions";

const dayLabel = new Intl.DateTimeFormat("es-AR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const fmtDay = (iso: string) => dayLabel.format(new Date(`${iso}T00:00:00Z`));

const STATUS_LABEL: Record<OrderView["status"], string> = { pending: "Pendiente", delivered: "Entregado", cancelled: "Cancelado" };

export function OrdersSection({
  slug,
  pending,
  closed,
  showClosed,
  now,
}: {
  slug: string;
  pending: OrderView[];
  closed: OrderView[];
  showClosed: boolean;
  now: Date;
}) {
  const groups = groupOrders(pending, now);
  const sections: [string, OrderView[]][] = [
    ["Atrasados", groups.overdue],
    ["Hoy", groups.today],
    ["Mañana", groups.tomorrow],
    ["Próximos", groups.upcoming],
  ];
  return (
    <section className="orders" aria-labelledby="orders-title">
      <div className="page-head">
        <h2 id="orders-title">Pedidos ({pending.length})</h2>
        <Link href={showClosed ? `/t/${slug}` : `/t/${slug}?pedidos=cerrados`} scroll={false}>
          {showClosed ? "Ocultar entregados y cancelados" : "Ver entregados y cancelados"}
        </Link>
      </div>
      {pending.length === 0 && <p className="empty-note">Todavía no hay pedidos. Se crean desde un cliente en Venta.</p>}
      {sections
        .filter(([, list]) => list.length > 0)
        .map(([title, list]) => (
          <div key={title} className="order-group">
            <h3 className={title === "Atrasados" ? "overdue" : undefined}>
              {title} ({list.length})
            </h3>
            <ul className="order-cards">
              {list.map((o) => (
                <li key={o.id}>
                  <OrderCard order={o} slug={slug} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      {showClosed && (
        <div className="order-group">
          <h3>Entregados y cancelados ({closed.length})</h3>
          {closed.length === 0 ? (
            <p className="meta-note">Todavía no hay pedidos cerrados.</p>
          ) : (
            <ul className="order-cards">
              {closed.map((o) => (
                <li key={o.id}>
                  <OrderCard order={o} slug={slug} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function OrderCard({ order: o, slug }: { order: OrderView; slug: string }) {
  const name = o.contactName ?? (o.contactPhone ? `+${o.contactPhone}` : "Cliente");
  return (
    <article className={`order-card status-${o.status}`}>
      <div className="order-head">
        <span className="card-name">{name}</span>
        <span className="order-date">
          {o.status === "pending" ? `Entrega ${fmtDay(o.deliveryDate)}` : `${STATUS_LABEL[o.status]} · entrega ${fmtDay(o.deliveryDate)}`}
        </span>
      </div>
      <p className="order-address">
        {o.address}
        {o.locality ? `, ${o.locality}` : ""}
        {o.notes ? ` · ${o.notes}` : ""}
      </p>
      <ul className="order-lines-view">
        {o.items.map((i) => (
          <li key={i.id}>
            {i.quantity}× {i.productName} <span className="mono">{formatPrice(i.unitPrice)}</span> = {formatPrice(i.lineTotal)}
          </li>
        ))}
      </ul>
      <p className="order-total">Total {formatPrice(o.total)}</p>
      {o.status === "pending" && <OrderActions slug={slug} orderId={o.id} contactName={name} />}
    </article>
  );
}
