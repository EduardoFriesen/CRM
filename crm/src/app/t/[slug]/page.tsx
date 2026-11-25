import Link from "next/link";
import { getAgentView, type AgentView } from "@/agent/config";
import { listBoard, type BoardContact } from "@/contacts/contacts";
import { messagePreview } from "@/contacts/preview";
import { waLink } from "@/contacts/wa-link";
import { STAGES, type Stage } from "@/db/schema";
import { relativeTime } from "@/lib/time";
import { listProducts } from "@/catalog/catalog";
import { listOrders } from "@/orders/orders";
import { todayInBuenosAires } from "@/orders/group";
import { getCurrentTenant } from "@/tenants/tenants";
import { OrderFormButton, type OrderProduct } from "./order-form";
import type { OrderView } from "@/orders/orders";
import { OrdersSection } from "./orders-section";
import { AutoRefresh } from "./auto-refresh";
import { CloseContactButton } from "./close-contact-button";
import { BotButton } from "./bot-button";
import { StageButton } from "./stage-button";
import { StageSelect } from "./stage-select";
import { STAGE_LABELS } from "./stages";

export const dynamic = "force-dynamic";

export default async function BoardPage({ params }: { params: Promise<{ slug: string }> }) {
  const tenant = await getCurrentTenant((await params).slug);
  const [board, agent, pendingOrders, catalog] = await Promise.all([
    listBoard(tenant.id),
    getAgentView(tenant.id),
    listOrders(tenant.id),
    listProducts(tenant.id),
  ]);
  const products: OrderProduct[] = catalog
    .filter((p) => p.active)
    .map((p) => ({ id: p.id, name: p.name, price: p.price, stock: p.stock }));
  const today = todayInBuenosAires();
  const total = STAGES.reduce((n, s) => n + board[s].length, 0);
  const now = new Date();

  return (
    <main className="page">
      <AutoRefresh />
      <div className="page-head">
        <h1>Tablero</h1>
        <p className="meta" aria-live="polite">
          {total === 1 ? "1 conversación" : `${total} conversaciones`} · se actualiza solo ·{" "}
          <BotStatus slug={tenant.slug} agent={agent} />
        </p>
      </div>

      {total === 0 ? (
        <div className="empty-board">
          <h2>Todavía no te escribió nadie</h2>
          <p>
            Cuando un cliente le escriba al WhatsApp del negocio, aparece acá en Consulta. Desde cada tarjeta abrís el
            chat y movés al cliente a Venta o Postventa.
          </p>
          <Link href={`/t/${tenant.slug}/whatsapp`}>Conectar WhatsApp</Link>
        </div>
      ) : (
        <div className="board">
          {STAGES.map((stage) => (
            <Column key={stage} stage={stage} contacts={board[stage]} slug={tenant.slug} now={now} products={products} today={today} orders={pendingOrders} />
          ))}
        </div>
      )}
      <OrdersSection slug={tenant.slug} pending={pendingOrders} now={now} products={products} today={today} />
    </main>
  );
}

function BotStatus({ slug, agent }: { slug: string; agent: AgentView | null }) {
  const [label, tone] = !agent
    ? ["Sin agente configurado", "warn"]
    : agent.keyStatus === "invalid"
      ? ["Key inválida: revisá el agente", "bad"]
      : agent.enabled
        ? ["Bot encendido", "ok"]
        : ["Bot apagado", "off"];
  return (
    <Link href={`/t/${slug}/configuracion/agente`} className={`bot-status ${tone}`}>
      {label}
    </Link>
  );
}

const pauseClock = new Intl.DateTimeFormat("es-AR", {
  timeZone: "America/Argentina/Buenos_Aires",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

type OrderContext = { products: OrderProduct[]; today: string; orders: OrderView[] };

function Column({
  stage,
  contacts,
  slug,
  now,
  products,
  today,
  orders,
}: { stage: Stage; contacts: BoardContact[]; slug: string; now: Date } & OrderContext) {
  const id = `col-${stage}`;
  return (
    <section className="column" data-stage={stage} aria-labelledby={id}>
      <h2 id={id} className="column-head">
        {STAGE_LABELS[stage]} <span className="count">{contacts.length}</span>
      </h2>
      {contacts.length === 0 ? (
        <p className="column-empty">Sin clientes en esta etapa</p>
      ) : (
        <ul className="cards">
          {contacts.map((c) => (
            <li key={c.id}>
              <Card contact={c} stage={stage} slug={slug} now={now} products={products} today={today} orders={orders} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Card({
  contact,
  stage,
  slug,
  now,
  products,
  today,
  orders,
}: { contact: BoardContact; stage: Stage; slug: string; now: Date } & OrderContext) {
  const name = contact.name ?? (contact.phone ? `+${contact.phone}` : "Sin nombre");
  const href = waLink(contact.phone);
  const paused = !!contact.botPausedUntil && contact.botPausedUntil > now;
  const quiet = paused || contact.botOff;
  const preview = contact.lastMessage === null ? null : messagePreview(contact.lastMessage);
  const body = (
    <>
      <span className="card-title">
        <span className="card-name">{name}</span>
        <time className="card-time" dateTime={contact.lastMessageAt?.toISOString()}>
          {relativeTime(contact.lastMessageAt, now)}
        </time>
      </span>
      <span className="card-phone">
        {contact.phone ? (
          <>
            <span className="mono">+{contact.phone}</span> · <span className="open">Abrir chat</span>
            <span className="visually-hidden"> en WhatsApp, en otra pestaña</span>
          </>
        ) : (
          "Sin número visible"
        )}
      </span>
      <span className={preview && !preview.media ? "card-message" : "card-message empty"}>
        {preview?.text ?? "Sin mensajes todavía"}
      </span>
    </>
  );

  const attention = contact.attentionReason;
  return (
    <article className={attention ? "card attention" : "card"}>
      {href ? (
        <a className="card-main" href={href} target="_blank" rel="noopener noreferrer">
          {body}
        </a>
      ) : (
        <div className="card-main">{body}</div>
      )}
      {stage !== "postventa" && (
        <CloseContactButton slug={slug} contactId={contact.id} name={name} variant="dismiss" confirm={stage === "venta"} />
      )}
      {attention && <p className="card-attention">Necesita atención: {attention}</p>}
      {contact.botOff && !attention && <p className="card-paused">Bot apagado</p>}
      {paused && !contact.botOff && (
        <p className="card-paused">
          Bot pausado hasta <time dateTime={contact.botPausedUntil!.toISOString()}>{pauseClock.format(contact.botPausedUntil!)}</time>
        </p>
      )}
      <div className="card-foot">
        {stage === "consulta" && <StageButton slug={slug} contactId={contact.id} name={name} to="venta" />}
        {stage === "venta" && (
          <>
            <StageButton slug={slug} contactId={contact.id} name={name} to="consulta" />
            <OrderFormButton
              slug={slug}
              contactId={contact.id}
              contactName={name}
              products={products}
              today={today}
              order={orders.find((o) => o.id === contact.pendingOrderId)}
            />
          </>
        )}
        {stage === "postventa" ? (
          <>
            <StageSelect slug={slug} contactId={contact.id} stage={stage} name={name} canPostventa={contact.hasDeliveredOrder} />
            <CloseContactButton slug={slug} contactId={contact.id} name={name} variant="sale" />
            {quiet ? (
              <BotButton slug={slug} contactId={contact.id} name={name} off={false} label="Activar bot" />
            ) : (
              <BotButton slug={slug} contactId={contact.id} name={name} off label="Desactivar bot" />
            )}
          </>
        ) : (
          quiet && <BotButton slug={slug} contactId={contact.id} name={name} off={false} label="Reactivar bot" />
        )}
      </div>
    </article>
  );
}
