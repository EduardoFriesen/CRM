import Link from "next/link";
import { getAgentView } from "@/agent/config";
import { describeAgentError } from "@/agent/errors";
import { usageMeter } from "@/usage/meter";
import { relativeTime } from "@/lib/time";
import { getUsageToday } from "@/usage/usage";

const n = new Intl.NumberFormat("es-AR");
const NOTE = "Aproximado: tu proveedor puede reiniciar la cuota en otro horario (Google: medianoche del Pacífico).";
const LEVEL_TEXT = { ok: "", warn: "Cerca del límite", full: "Límite alcanzado" } as const;

// Thin always-visible strip under the tenant navigation: today's AI usage and, when the
// tenant entered its plan limits, how close it is to running out.
export async function UsageBar({ tenantId, slug }: { tenantId: string; slug: string }) {
  let data;
  try {
    data = await Promise.all([getUsageToday(tenantId), getAgentView(tenantId)]);
  } catch {
    // Never take the tenant screens down because of the usage strip.
    return (
      <section className="usage-bar" aria-label="Consumo de IA">
        <span className="usage-error">Consumo no disponible en este momento.</span>
      </section>
    );
  }
  const [u, agent] = data;
  const m = usageMeter(u, { requests: agent?.dailyRequestLimit ?? null, tokens: agent?.dailyTokenLimit ?? null });
  return (
    <section className="usage-bar" aria-label="Consumo de IA" title={NOTE}>
      <span className="usage-figures">
        <strong>IA hoy</strong> · {n.format(u.requests)} pedidos · {n.format(u.inputTokens + u.outputTokens)} tokens ·{" "}
        {n.format(u.replies)} respuestas
      </span>
      {m.percent !== null && m.level && (
        <span className={`usage-meter level-${m.level}`}>
          <span
            className="usage-track"
            role="progressbar"
            aria-label="Uso del límite diario"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={m.percent}
          >
            <span className="usage-fill" style={{ width: `${m.percent}%` }} />
          </span>
          {m.label}
          {LEVEL_TEXT[m.level] && <strong className="usage-level">{LEVEL_TEXT[m.level]}</strong>}
        </span>
      )}
      <span className="usage-error">
        Último error:{" "}
        {agent?.lastErrorCode
          ? `${describeAgentError(agent.lastErrorCode)} (${relativeTime(agent.lastErrorAt ? new Date(agent.lastErrorAt) : null)})`
          : "—"}
      </span>
      <span className="usage-note">{NOTE}</span>
      <Link href={`/t/${slug}/agente`}>Agente</Link>
    </section>
  );
}
