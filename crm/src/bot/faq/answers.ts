import { getBusinessProfile } from "@/business/profile";
import { searchCatalog } from "@/catalog/catalog";
import { fill, type TemplateKey } from "./templates";
import type { FaqCall } from "./types";

const MAX_LISTED = 3;

const BUSINESS_FIELDS = {
  hours: { field: "hours", key: "hours" },
  location: { field: "address", key: "address" },
  payment_methods: { field: "paymentMethods", key: "payment_methods" },
  shipping: { field: "shipping", key: "shipping" },
} as const;

/** Final customer text for a classified question, from real data and templates only. `null` = no data to answer. */
export async function answerFaq(tenantId: string, call: FaqCall, pick?: () => number): Promise<string | null> {
  switch (call.fn) {
    case "unclear":
    case "handoff":
      return fill(call.fn, {}, pick);
    case "price":
    case "stock":
      return answerProduct(tenantId, call, pick);
    default: {
      const { field, key } = BUSINESS_FIELDS[call.fn];
      const value = (await getBusinessProfile(tenantId))[field].trim();
      return value ? fill(call.fn as TemplateKey, { [key]: value }, pick) : null;
    }
  }
}

async function answerProduct(tenantId: string, call: FaqCall, pick?: () => number): Promise<string | null> {
  const query = call.args.product?.trim();
  if (!query) return null;
  const hits = await searchCatalog(tenantId, query);
  if (hits.length === 0) return null;

  if (call.fn === "stock") {
    // ponytail: with several matches, answers for the first (alphabetical) one.
    const [h] = hits;
    return fill("stock", { name: h.name, status: h.availability }, pick);
  }
  if (hits.length === 1) return fill("price_one", { name: hits[0].name, price: hits[0].price }, pick);

  const list = hits
    .slice(0, MAX_LISTED)
    .map((h) => `• ${h.name}: ${h.price}${h.availability === "sin stock" ? " (sin stock)" : ""}`)
    .join("\n");
  const text = fill("price_many", { list }, pick);
  return hits.length > MAX_LISTED ? `${text}\n${fill("price_more", {}, pick)}` : text;
}
