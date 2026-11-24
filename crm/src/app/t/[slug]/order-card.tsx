import { formatPrice } from "@/lib/money";
import type { OrderView } from "@/orders/orders";
import { OrderActions } from "./order-actions";

const dayLabel = new Intl.DateTimeFormat("es-AR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
export const fmtDay = (iso: string) => dayLabel.format(new Date(`${iso}T00:00:00Z`));

const STATUS_LABEL: Record<OrderView["status"], string> = { pending: "Pendiente", delivered: "Entregado", cancelled: "Cancelado" };

export function OrderCard({ order: o, slug }: { order: OrderView; slug: string }) {
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
