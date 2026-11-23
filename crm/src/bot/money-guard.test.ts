import { describe, expect, it } from "vitest";
import { mentionsMoney } from "@/bot/money-guard";

describe("mentionsMoney", () => {
  it.each(["$2.500", "$ 300", "cuesta 3000", "Sale 3.500 la docena", "tiene descuento", "en pesos", "te cobramos el envío", "USD 20", "el precio cambia",
    "Sí, 1.500 el envío", "Son 3500 la docena", "u$s 20", "2 lucas", "15 mangos", "en 3 cuotas sin interés",
    "seña del 50%", "10% off", "abonás 2000 al retirar", "el envío es gratis", "sin cargo"])(
    "flags %s",
    (t) => expect(mentionsMoney(t)).toBe(true),
  );
  it.each(["abrimos a las 8", "sí, hacemos envíos a Pilar", "salimos a las 9", "la venta es por mayor", "tenemos sin TACC", "valentina te atiende"])(
    "lets %s through",
    (t) => expect(mentionsMoney(t)).toBe(false),
  );
});
