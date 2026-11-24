import { plain } from "@/lib/plain";

// Conservative: a false positive only means an answer isn't learned; a false negative
// would let the bot learn (and repeat) a price. Matched on lowercase, accent-free text.
const MONEY_WORDS =
  /\b(precio|precios|cuesta|cuestan|sale|salen|vale|valen|costo|costos|cobr\w*|abon\w*|descuento|descuentos|recargo|recargos|pesos|ars|usd|dolar|dolares|lucas?|mangos?|cuotas?|interes|sena|gratis|cargo|off|promo\w*|oferta\w*)\b/;
const CURRENCY = /(\$\s?\d|u\$s|us\$|ar\$|%)/;
// "1.500", "12.000" (es-AR thousands), long bare amounts, or "3500 la docena".
const AMOUNTS = /(\b\d{1,3}(\.\d{3})+\b|\b\d{4,}\b|\b\d{3,}\s+(el|la|los|las|c\/u|cada|por|x)\b)/;

export function mentionsMoney(text: string): boolean {
  const p = plain(text);
  return CURRENCY.test(p) || MONEY_WORDS.test(p) || AMOUNTS.test(p);
}
