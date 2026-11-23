import { listFacts, listPendingEscalations } from "@/facts/facts";
import { relativeTime } from "@/lib/time";
import { getCurrentTenant } from "@/tenants/tenants";
import { DismissButton } from "./dismiss-button";
import { FactsManager } from "./facts-manager";

export const dynamic = "force-dynamic";

export default async function LearnedPage({ params }: { params: Promise<{ slug: string }> }) {
  const tenant = await getCurrentTenant((await params).slug);
  const [facts, pending] = await Promise.all([listFacts(tenant.id), listPendingEscalations(tenant.id)]);
  const now = new Date();
  return (
    <main className="page">
      <div className="page-head">
        <h1>Aprendido</h1>
        <p className="meta">Respuestas del equipo que el bot reutiliza. Los precios nunca se aprenden.</p>
      </div>
      <section aria-labelledby="pending-title">
        <h2 id="pending-title">Consultas sin responder ({pending.length})</h2>
        {pending.length === 0 ? (
          <p className="meta-note">No hay consultas pendientes.</p>
        ) : (
          <ul className="pending-list">
            {pending.map((p) => (
              <li key={p.id}>
                <span className="fact-q">{p.question}</span>
                <span className="meta-note">
                  {p.contactName ?? "Un cliente"} · {relativeTime(p.createdAt, now)} · respondé citando el mensaje en tu WhatsApp
                </span>
                <DismissButton slug={tenant.slug} id={p.id} question={p.question} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="facts-title">
        <h2 id="facts-title">Datos aprendidos ({facts.length})</h2>
        <FactsManager slug={tenant.slug} facts={facts} />
      </section>
    </main>
  );
}
