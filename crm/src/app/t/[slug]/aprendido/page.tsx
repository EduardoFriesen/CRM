import { recentExamples, type Learnable } from "@/bot/faq/examples";
import { listFacts, listPendingEscalations } from "@/facts/facts";
import { relativeTime } from "@/lib/time";
import { getCurrentTenant } from "@/tenants/tenants";
import { DeleteExampleButton } from "./delete-example-button";
import { DismissButton } from "./dismiss-button";
import { FactsManager } from "./facts-manager";

export const dynamic = "force-dynamic";

const FN_LABELS: Record<Learnable, string> = {
  hours: "Horarios",
  location: "Dirección",
  payment_methods: "Medios de pago",
  shipping: "Envíos",
  greeting: "Saludo",
  farewell: "Despedida",
  catalog: "Catálogo",
  order_status: "Estado del pedido",
  learned: "Respuesta aprendida",
};

export default async function LearnedPage({ params }: { params: Promise<{ slug: string }> }) {
  const tenant = await getCurrentTenant((await params).slug);
  const [facts, pending, shortcuts] = await Promise.all([listFacts(tenant.id), listPendingEscalations(tenant.id), recentExamples(tenant.id, 200)]);
  const now = new Date();
  // A learned shortcut is only checkable with the question it answers.
  const questionOf = new Map(facts.map((f) => [f.id, f.question]));
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
      <section aria-labelledby="examples-title">
        <h2 id="examples-title">Atajos del bot ({shortcuts.length})</h2>
        <p className="meta-note">Mensajes que el bot responde sin IA porque ya sabe qué preguntan. Borrá los que estén mal.</p>
        {shortcuts.length === 0 ? (
          <p className="meta-note">Todavía no hay atajos: aparecen cuando el bot detecta preguntas frecuentes.</p>
        ) : (
          <ul className="pending-list">
            {shortcuts.map((s) => (
              <li key={s.id}>
                <span className="fact-q">{s.text}</span>
                <span className="meta-note">
                  {FN_LABELS[s.fn]}
                  {s.factId && questionOf.has(s.factId) ? `: ${questionOf.get(s.factId)}` : ""} · {relativeTime(s.createdAt, now)}
                </span>
                <DeleteExampleButton slug={tenant.slug} id={s.id} text={s.text} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
