import type { HistoryTurn } from "@/bot/history";
import type { Stage } from "@/db/schema";

// Postventa: what a customer who already bought may ask. Product questions go to the full bot,
// which can move them back to Consulta.
const POSTVENTA_FNS = new Set(["order_status", "hours", "location", "payment_methods", "shipping", "greeting", "farewell", "learned", "handoff", "unclear"]);

export function allowedIn(stage: Stage, fn: string): boolean {
  if (stage === "venta") return false;
  return stage === "postventa" ? POSTVENTA_FNS.has(fn) : fn !== "order_status";
}

/** The customer's messages after the last bot or admin turn, one per line. */
export function customerBlock(turns: HistoryTurn[]): string {
  const lastOther = turns.findLastIndex((t) => t.role !== "user");
  return turns.slice(lastOther + 1).map((t) => t.text).join("\n");
}
