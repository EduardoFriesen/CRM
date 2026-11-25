import type { HistoryTurn } from "@/bot/history";
import type { Stage } from "@/db/schema";
import { plain } from "@/lib/plain";
import { exampleKey } from "./examples";

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

// A number or a lone letter is a detail: "factura B", "talle 42". The conjunctions y/o/e/u are not.
const DETAIL = /^(?:\d+|[a-df-np-tv-xz])$/;
const details = (text: string) => new Set(exampleKey(text).split(" ").filter((w) => DETAIL.test(w)));

// The message and a learned question name different details, so they ask different things.
// Both ways: "factura B" vs "factura A" and "factura" vs "factura A" both differ.
// ponytail: catches letters and numbers only; different words ("Tigre" vs "Pilar") still pass.
// Upgrade: have the router quote the detail it matched, and compare that.
export function namesOtherDetail(message: string, question: string): boolean {
  const a = details(message);
  const b = details(question);
  return a.size !== b.size || [...a].some((d) => !b.has(d));
}

// Words of a complaint about an order: never answered with its status.
const COMPLAINT = /\b(rot[oa]s?|mal|no (me )?llego|todavia no|nunca|faltan?|faltaba|reclamo|queja)\b/;
export const isComplaint = (text: string) => COMPLAINT.test(plain(text));
