import type { FaqName } from "./types";

// One line of `plain` text: a courtesy word and/or only emojis/punctuation.
export const TRIVIAL =
  /^[\s\p{P}\p{S}\p{M}\u200d]*(?:(?:ok|oka|okey|gracias|muchas gracias|dale|listo|joya|genial|perfecto|buenisimo)[\s\p{P}\p{S}\p{M}\u200d]*)?$/u;

// Order matters: paying must be a handoff before "mercado pago" reads as payment info.
export const RULES: { pattern: RegExp; fn: FaqName }[] = [
  { pattern: /\b(alias|cbu|cvu|te transfiero|como (te )?pago)\b/, fn: "handoff" },
  { pattern: /\b(horarios?|abren|cierran|atienden)\b/, fn: "hours" },
  { pattern: /\b(direccion|donde (estan|quedan|queda)|ubicacion)\b/, fn: "location" },
  { pattern: /\b(medios de pago|aceptan tarjeta|mercado ?pago|efectivo)\b/, fn: "payment_methods" },
  { pattern: /\b(envios?|envian|delivery)\b/, fn: "shipping" },
];

// Customer-given info or price questions: no rule fires (the router decides). Handoff is exempt.
export const NO_RULE = /\b(mi|mis|te paso|te mando|no llego|cuanto|cuesta|cuestan|sale|salen|precio|descuento)\b/;
