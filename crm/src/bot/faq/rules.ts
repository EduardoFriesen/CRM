import type { FaqName } from "./types";

// One line of `plain` text: a courtesy word and/or only emojis/punctuation.
export const TRIVIAL =
  /^[\s\p{P}\p{S}\p{M}‍]*(?:(?:ok|oka|okey|gracias|muchas gracias|dale|listo|joya|genial|perfecto|buenisimo)[\s\p{P}\p{S}\p{M}‍]*)?$/u;

// Order matters: paying must be a handoff before "mercado pago" reads as payment info.
export const RULES: { pattern: RegExp; fn: FaqName }[] = [
  { pattern: /\b(alias|cbu|cvu|te transfiero|como (te )?pago)\b/, fn: "handoff" },
  { pattern: /\b(horarios?|a que hora|abren|cierran)\b/, fn: "hours" },
  { pattern: /\b(direccion|donde (estan|quedan|queda)|ubicacion)\b/, fn: "location" },
  { pattern: /\b(medios de pago|aceptan tarjeta|mercado ?pago|efectivo)\b/, fn: "payment_methods" },
  { pattern: /\b(envios?|envian|delivery|mandan)\b/, fn: "shipping" },
];
