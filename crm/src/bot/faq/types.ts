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
  | "catalog";

export type FaqArgs = { product?: string; zone?: string; reason?: string };

export type FaqCall = { fn: FaqName; args: FaqArgs };

export type Decision = { kind: "silence" } | ({ kind: "faq" } & FaqCall);
