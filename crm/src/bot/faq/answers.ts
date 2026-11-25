import { and, eq, inArray } from "drizzle-orm";
import { getBusinessProfile } from "@/business/profile";
import { matchProducts, searchCatalog } from "@/catalog/catalog";
import { withTenant } from "@/db/client";
import { businessFacts, orders } from "@/db/schema";
import { z } from "zod";
import { formatPrice } from "@/lib/money";
import { todayInBuenosAires } from "@/orders/group";
import { plain } from "@/lib/plain";
import { fill, type TemplateKey } from "./templates";
import type { FaqCall, QuoteItem } from "./types";

/** Customer text, or text plus the reason to hand the conversation to a person. */
export type FaqAnswer = string | { text: string; handoff: string };

const MAX_LISTED = 3;
const MAX_CATALOG = 10;

const BUSINESS_FIELDS = {
  hours: { field: "hours", key: "hours", template: "hours" },
  location: { field: "address", key: "address", template: "location" },
  payment_methods: { field: "paymentMethods", key: "payment_methods", template: "payment_methods" },
  shipping: { field: "shipping", key: "shipping", template: "shipping" },
} as const satisfies Record<string, { field: string; key: string; template: TemplateKey }>;

/** Final customer text for a classified question, from real data and templates only. `null` = no data to answer. */
export async function answerFaq(tenantId: string, call: FaqCall, pick?: () => number, contactId?: string): Promise<FaqAnswer | null> {
  switch (call.fn) {
    case "unclear":
    case "greeting":
    case "farewell":
    case "handoff":
      return fill(call.fn, {}, pick);
    case "price":
    case "stock":
      return answerProduct(tenantId, call, pick);
    case "catalog":
      return answerCatalog(tenantId, pick);
    case "learned":
      return answerLearned(tenantId, call.args.factId);
    case "order_status":
      return contactId ? answerOrder(tenantId, contactId, pick) : null;
    case "quote":
      return answerQuote(tenantId, call.args.items ?? [], pick);
    default: {
      const { field, key, template } = BUSINESS_FIELDS[call.fn];
      const value = (await getBusinessProfile(tenantId))[field].trim();
      return value ? fill(template, { [key]: value }, pick) : null;
    }
  }
}

type Hit = Awaited<ReturnType<typeof searchCatalog>>[number];

const priceLine = (h: Hit) => `• ${h.name}: ${h.price}${h.availability === "sin stock" ? " (sin stock)" : ""}`;

// The first `max` hits as a list, plus an offer when more were found.
function listing(hits: Hit[], max: number, line: (h: Hit) => string, pick?: () => number): string {
  const text = fill("price_many", { list: hits.slice(0, max).map(line).join("\n") }, pick);
  return hits.length > max ? `${text}\n${fill("price_more", {}, pick)}` : text;
}

async function answerCatalog(tenantId: string, pick?: () => number): Promise<string | null> {
  // One extra hit tells whether there are more than we list.
  const hits = await searchCatalog(tenantId, "", MAX_CATALOG + 1);
  return hits.length === 0 ? null : listing(hits, MAX_CATALOG, priceLine, pick);
}

const quantity = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });

// The exact name wins over partial matches ("tornillo" vs "tornillo 6mm"); otherwise only a single match.
async function findProduct(tenantId: string, query: string) {
  const hits = await matchProducts(tenantId, query);
  const q = plain(query).trim();
  return hits.find((h) => plain(h.name).trim() === q) ?? (hits.length === 1 ? hits[0] : null);
}

// Totals in cents so "3 × $50,50" is exactly $151,50.
async function answerQuote(tenantId: string, items: QuoteItem[], pick?: () => number): Promise<FaqAnswer | null> {
  if (items.length === 0) return null;
  const lines: string[] = [];
  let total = 0;
  for (const item of items) {
    const p = await findProduct(tenantId, item.product);
    if (!p) return null;
    const qty = quantity.format(item.quantity);
    if (p.stock !== null && item.quantity > p.stock) {
      return { text: fill("quote_short", {}, pick), handoff: `Pidió ${qty} de ${p.name} y no hay stock suficiente.` };
    }
    const cents = Math.round(Number(p.price) * 100 * item.quantity);
    total += cents;
    lines.push(`• ${p.name}: ${qty} × ${formatPrice(p.price)} = ${formatPrice(cents / 100)}`);
  }
  return fill("quote", { lines: lines.join("\n"), total: formatPrice(total / 100) }, pick);
}

// The admin's own words, as they wrote them: no template around them.
async function answerLearned(tenantId: string, factId: string | undefined): Promise<string | null> {
  if (!z.uuid().safeParse(factId).success) return null;
  const [row] = await withTenant(tenantId, (tx) =>
    tx.select({ answer: businessFacts.answer }).from(businessFacts).where(eq(businessFacts.id, factId!)),
  );
  return row?.answer.trim() || null;
}

const day = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });
// "sábado 28/11": built from parts, es-AR alone would give "sábado, 28-11".
const formatDay = (d: Date) => {
  const p = Object.fromEntries(day.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.day}/${p.month}`;
};

// The pending order due soonest, else the last one delivered. Cancelled orders never answer.
async function answerOrder(tenantId: string, contactId: string, pick?: () => number): Promise<string | null> {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({ status: orders.status, deliveryDate: orders.deliveryDate, deliveredAt: orders.deliveredAt, address: orders.address })
      .from(orders)
      .where(and(eq(orders.contactId, contactId), inArray(orders.status, ["pending", "delivered"]))),
  );
  const pendings = rows.filter((o) => o.status === "pending");
  // A late order (delivery date already past) needs a person, not a date that already went by.
  const [pending] = pendings.filter((o) => o.deliveryDate >= todayInBuenosAires()).sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate));
  if (pendings.length > 0 && !pending) return null;
  // A `date` column: noon UTC keeps the same calendar day in Buenos Aires.
  if (pending) return fill("order_pending", { date: formatDay(new Date(`${pending.deliveryDate}T12:00:00Z`)), address: pending.address }, pick);
  const [delivered] = rows
    .flatMap((o) => (o.status === "delivered" && o.deliveredAt ? [o.deliveredAt] : []))
    .sort((a, b) => b.getTime() - a.getTime());
  return delivered ? fill("order_delivered", { date: formatDay(delivered) }, pick) : null;
}

async function answerProduct(tenantId: string, call: FaqCall, pick?: () => number): Promise<string | null> {
  const query = call.args.product?.trim();
  if (!query) return null;
  const hits = await searchCatalog(tenantId, query);
  if (hits.length === 0) return null;

  if (hits.length === 1) {
    const [h] = hits;
    const out = h.availability === "sin stock";
    if (call.fn === "stock") return fill(out ? "stock_out" : "stock_available", { name: h.name }, pick);
    return fill("price_one", { name: h.name, price: h.price, note: out ? " (por ahora sin stock)" : "" }, pick);
  }

  const line = call.fn === "price" ? priceLine : (h: Hit) => `• ${h.name}: ${h.availability}`;
  return listing(hits, MAX_LISTED, line, pick);
}
