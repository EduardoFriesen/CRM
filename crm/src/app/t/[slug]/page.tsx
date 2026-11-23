import Link from "next/link";
import { getAgentView, type AgentView } from "@/agent/config";
import { listBoard, type BoardContact } from "@/contacts/contacts";
import { messagePreview } from "@/contacts/preview";
import { waLink } from "@/contacts/wa-link";
import { STAGES, type Stage } from "@/db/schema";
import { relativeTime } from "@/lib/time";
import { getCurrentTenant } from "@/tenants/tenants";
import { AutoRefresh } from "./auto-refresh";
import { StageSelect } from "./stage-select";
import { STAGE_LABELS } from "./stages";

export const dynamic = "force-dynamic";

export default async function BoardPage({ params }: { params: Promise<{ slug: string }> }) {
  const tenant = await getCurrentTenant((await params).slug);
  const [board, agent] = await Promise.all([listBoard(tenant.id), getAgentView(tenant.id)]);
  const total = STAGES.reduce((n, s) => n + board[s].length, 0);
  const now = new Date();

  return (
    <main className="page">
      <AutoRefresh />
      <div className="page-head">
        <h1>Clientes</h1>
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
            <Column key={stage} stage={stage} contacts={board[stage]} slug={tenant.slug} now={now} />
          ))}
        </div>
      )}
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
    <Link href={`/t/${slug}/agente`} className={`bot-status ${tone}`}>
      {label}
    </Link>
  );
}

function Column({ stage, contacts, slug, now }: { stage: Stage; contacts: BoardContact[]; slug: string; now: Date }) {
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
              <Card contact={c} stage={stage} slug={slug} now={now} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Card({ contact, stage, slug, now }: { contact: BoardContact; stage: Stage; slug: string; now: Date }) {
  const name = contact.name ?? (contact.phone ? `+${contact.phone}` : "Sin nombre");
  const href = waLink(contact.phone);
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

  return (
    <article className="card">
      {href ? (
        <a className="card-main" href={href} target="_blank" rel="noopener noreferrer">
          {body}
        </a>
      ) : (
        <div className="card-main">{body}</div>
      )}
      <div className="card-foot">
        <StageSelect slug={slug} contactId={contact.id} stage={stage} name={name} />
      </div>
    </article>
  );
}
