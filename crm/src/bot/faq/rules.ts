import type { FaqName } from "./types";

// One line of `plain` text: a courtesy word and/or only emojis/punctuation.
export const TRIVIAL =
  /^[\s\p{P}\p{S}\p{M}\u200d]*(?:(?:ok|oka|okey|gracias|muchas gracias|dale|listo|joya|genial|perfecto|buenisimo)[\s\p{P}\p{S}\p{M}\u200d]*)*$/u;

// One line of `plain` text that is only a greeting, with optional emojis/punctuation.
const SEP = String.raw`[\s\p{P}\p{S}\p{M}\u200d]*`;
export const GREETING = new RegExp(
  `^${SEP}(?:(?:hola+s?|holis|buenas (?:tardes|noches)|buenos dias|buen dia|buenas|que tal|como (?:andan|andas|estas|estan|va|anda))${SEP})+$`,
  "u",
);

// One line of `plain` text that is only a goodbye: at least one farewell word, courtesies allowed.
const BYE = "chau|chao|adios|hasta luego|hasta manana|hasta la proxima|nos vemos|me voy|saludos";
const COURTESY = "muchas gracias|gracias|ok|oka|dale|listo|bueno";
export const FAREWELL = new RegExp(
  `^${SEP}(?:(?:${COURTESY})${SEP})*(?:${BYE})${SEP}(?:(?:${BYE}|${COURTESY})${SEP})*$`,
  "u",
);

// Order matters: paying (asking how, saying they will or did) must be a handoff before
// "mercado pago" or "efectivo" reads as payment info.
export const RULES: { pattern: RegExp; fn: FaqName }[] = [
  {
    pattern: /\b(alias|cbu|cvu|te transfiero|como (te )?pago|pague|pagamos|quiero pagar|te pago|pago (con|en|por)|transferi|comprobante)\b/,
    fn: "handoff",
  },
  { pattern: /\b(horarios?|abren|cierran|atienden)\b/, fn: "hours" },
  { pattern: /\b(direccion|donde (estan|quedan|queda)|ubicacion|como llego)\b/, fn: "location" },
  { pattern: /\b(medios de pago|aceptan tarjeta|mercado ?pago|efectivo)\b/, fn: "payment_methods" },
  { pattern: /\b(envios?|envian|delivery)\b/, fn: "shipping" },
];

// Customer-given info or price questions: no rule fires (the router decides). Handoff is exempt.
export const NO_RULE = /\b(mi|mis|te paso|te mando|no llego|cuanto|cuesta|cuestan|sale|salen|precio|descuento)\b/;
