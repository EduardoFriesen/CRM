import Link from "next/link";
import { groupOrders } from "@/orders/group";
import type { OrderView } from "@/orders/orders";
import { OrderCard } from "./order-card";

export function OrdersSection({
  slug,
  pending,
  now,
}: {
  slug: string;
  pending: OrderView[];
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
        <Link href={`/t/${slug}/ventas`}>Ver ventas entregadas</Link>
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
    </section>
  );
}
