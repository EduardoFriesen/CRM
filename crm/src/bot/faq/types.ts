export type FaqName =
  | "price"
  | "stock"
  | "hours"
  | "location"
  | "payment_methods"
  | "shipping"
  | "handoff"
  | "unclear"
  | "greeting"
  | "catalog"
  | "quote"
  | "farewell"
  | "order_status";

export type QuoteItem = { product: string; quantity: number };

export type FaqArgs = { product?: string; zone?: string; reason?: string; items?: QuoteItem[] };

export type FaqCall = { fn: FaqName; args: FaqArgs };

export type Decision = { kind: "silence" } | ({ kind: "faq" } & FaqCall);
