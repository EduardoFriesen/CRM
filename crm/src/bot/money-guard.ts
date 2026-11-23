// Conservative: a false positive only means an answer isn't learned; a false negative
// would let the bot learn (and repeat) a price. Words are matched whole, without accents.
const MONEY_WORDS =
  /\b(precio|precios|cuesta|cuestan|sale|salen|vale|valen|costo|costos|cobr\w*|descuento|descuentos|recargo|recargos|pesos|ars|usd|dolar|dolares)\b/;
const CURRENCY_AMOUNT = /\$\s?\d/;

export function mentionsMoney(text: string): boolean {
  const plain = text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  return CURRENCY_AMOUNT.test(plain) || MONEY_WORDS.test(plain);
}
