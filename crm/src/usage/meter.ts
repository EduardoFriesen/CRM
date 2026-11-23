const n = new Intl.NumberFormat("es-AR");

export type MeterLevel = "ok" | "warn" | "full";
export type Meter = { percent: number | null; level: MeterLevel | null; label: string | null };

// How close today's usage is to the tenant's own limits. With two limits, the one closer
// to running out wins. The bar is capped at 100 even when usage went past the limit.
export function usageMeter(
  u: { requests: number; inputTokens: number; outputTokens: number },
  limits: { requests: number | null; tokens: number | null },
): Meter {
  const tokens = u.inputTokens + u.outputTokens;
  const candidates: { ratio: number; label: string }[] = [];
  if (limits.requests) candidates.push({ ratio: u.requests / limits.requests, label: `${n.format(u.requests)} de ${n.format(limits.requests)} pedidos` });
  if (limits.tokens) candidates.push({ ratio: tokens / limits.tokens, label: `${n.format(tokens)} de ${n.format(limits.tokens)} tokens` });
  if (candidates.length === 0) return { percent: null, level: null, label: null };
  const worst = candidates.reduce((a, b) => (b.ratio > a.ratio ? b : a));
  const percent = Math.min(100, Math.round(worst.ratio * 100));
  const level: MeterLevel = worst.ratio >= 1 ? "full" : worst.ratio >= 0.8 ? "warn" : "ok";
  return { percent, level, label: worst.label };
}
