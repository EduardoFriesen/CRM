// The bot must never ask the customer for bank, card or identity data: it happened with a
// small model ("¿podés proporcionarme tus datos bancarios?"). Matched on lowercase,
// accent-free text. Sharing the business's own data ("nuestro alias") is not a request.
const YOUR_DATA =
  /\btus?\s+(datos\s+(bancarios|de\s+(la\s+)?tarjeta|de\s+pago|personales)|cbu|cvu|alias|cuenta(\s+bancaria)?|tarjeta|dni|cuit|cuil|clave|contrasena|pin|codigo|documento)\b/;
const CARD_DATA = /\b(datos|numero|vencimiento)\s+de\s+la\s+tarjeta\b|\b(cvv|cvc)\b|\bcodigo\s+de\s+seguridad\b/;

export function asksForSensitiveData(text: string): boolean {
  const plain = text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  return YOUR_DATA.test(plain) || CARD_DATA.test(plain);
}
