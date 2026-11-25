import { formatPrice } from "@/lib/money";
import type { OrderView } from "@/orders/orders";
import { OrderActions } from "./order-actions";
import { OrderFormButton, type OrderProduct } from "./order-form";

const dayLabel = new Intl.DateTimeFormat("es-AR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
export const fmtDay = (iso: string) => dayLabel.format(new Date(`${iso}T00:00:00Z`));

const STATUS_LABEL: Record<OrderView["status"], string> = { pending: "Pendiente", delivered: "Entregado", cancelled: "Cancelado" };

// readOnly: a record (customer history), so pending orders say so and get no actions.
// edit: the catalog and today, to edit a pending order. overdue: its delivery date passed.
export function OrderCard({
  order: o,
  slug,
  readOnly = false,
  edit,
  overdue = false,
}: {
  order: OrderView;
  slug: string;
  readOnly?: boolean;
  edit?: { products: OrderProduct[]; today: string };
  overdue?: boolean;
}) {
  const name = o.contactName ?? (o.contactPhone ? `+${o.contactPhone}` : "Cliente");
  return (
    <article className={`order-card status-${o.status}${overdue ? " overdue" : ""}`}>
      <div className="order-head">
        <span className="card-name">{name}</span>
        <span className="order-date">
          {overdue && <strong className="overdue-tag">Atrasado · </strong>}
          {o.status === "pending" && !readOnly ? `Entrega ${fmtDay(o.deliveryDate)}` : `${STATUS_LABEL[o.status]} · entrega ${fmtDay(o.deliveryDate)}`}
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
      {o.status === "pending" && !readOnly && (
        <OrderActions slug={slug} orderId={o.id} contactName={name}>
          {edit && (
            <OrderFormButton slug={slug} contactId={o.contactId} contactName={name} products={edit.products} today={edit.today} order={o} />
          )}
        </OrderActions>
      )}
    </article>
  );
}
