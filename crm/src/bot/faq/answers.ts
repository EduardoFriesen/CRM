import { getBusinessProfile } from "@/business/profile";
import { matchProducts, searchCatalog } from "@/catalog/catalog";
import { formatPrice } from "@/lib/money";
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
export async function answerFaq(tenantId: string, call: FaqCall, pick?: () => number): Promise<FaqAnswer | null> {
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
