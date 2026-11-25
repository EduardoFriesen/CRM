import { describe, expect, it } from "vitest";
import { prefilter } from "./prefilter";
import { TEMPLATES } from "./templates";

describe("prefilter", () => {
  it("silences trivial messages", () => {
    for (const t of ["ok", "Gracias!!", "👍", "dale"]) {
      expect(prefilter(t, "Sale $2.500.")).toEqual({ kind: "silence" });
    }
  });

  it("silences courtesy-only lines with several words", () => {
    for (const t of ["ok gracias", "dale gracias", "listo, gracias!", "joya 👍"]) {
      expect(prefilter(t, "Sale $2.500.")).toEqual({ kind: "silence" });
    }
    expect(prefilter("ok gracias, y cuanto sale el pan", "Sale $2.500.")).not.toEqual({ kind: "silence" });
  });

  it("does not silence after a bot question", () => {
    expect(prefilter("dale", "¿Te lo reservo?")).toBeNull();
    expect(prefilter("dale", "¿Lo querés? Avisame 😊")).toBeNull();
    expect(prefilter("dale", "¿Te lo reservo? 😊")).toBeNull();
  });

  it("does not silence a batch with a real question", () => {
    expect(prefilter("gracias\ny cuánto sale el pan?", null)).toBeNull();
  });

  it("maps obvious questions", () => {
    expect(prefilter("a que hora abren?", null)).toEqual({ kind: "faq", fn: "hours", args: {} });
    expect(prefilter("dónde están?", null)).toMatchObject({ fn: "location" });
    expect(prefilter("como llego a su local", null)).toMatchObject({ fn: "location" });
    expect(prefilter("aceptan mercadopago?", null)).toMatchObject({ fn: "payment_methods" });
    expect(prefilter("aceptan mercado pago?", null)).toMatchObject({ fn: "payment_methods" });
    expect(prefilter("hacen envios?", null)).toMatchObject({ fn: "shipping" });
  });

  it("paying is a handoff, not payment info", () => {
    expect(prefilter("pasame el alias", null)).toMatchObject({ fn: "handoff", args: { reason: "El cliente quiere pagar" } });
    expect(prefilter("cbu?", null)).toMatchObject({ fn: "handoff" });
    expect(prefilter("como pago con mercado pago?", null)).toMatchObject({ fn: "handoff" });
  });

  it("a customer paying or about to pay is a handoff", () => {
    for (const t of ["listo ya te pague por mercado pago", "quiero pagar con mercadopago", "pago en efectivo", "lo pago en efectivo cuando lo retiro", "ya transferi", "te mando el comprobante"]) {
      expect(prefilter(t, null), t).toMatchObject({ fn: "handoff" });
    }
    expect(prefilter("aceptan mercado pago?", null)).toMatchObject({ fn: "payment_methods" });
    expect(prefilter("medios de pago?", null)).toMatchObject({ fn: "payment_methods" });
  });

  it("answers a bare greeting without the router", () => {
    for (const t of ["hola", "Hola!!", "buenas", "buen día", "Buenas tardes 😊", "hola buenas", "holaa", "holis", "hola\nbuenas noches", "holaa como andan", "hola, ¿cómo estás?", "buenas, que tal"]) {
      expect(prefilter(t, null), t).toEqual({ kind: "faq", fn: "greeting", args: {} });
    }
    expect(prefilter("hola", "¿En qué te puedo ayudar?")).toMatchObject({ fn: "greeting" });
  });

  it("a greeting with a question or request is not a bare greeting", () => {
    for (const t of ["hola, cuanto sale el kikuyo?", "hola\nme interesa", "buenas, hacen envios?", "que tal el kikuyo"]) {
      expect(prefilter(t, null), t).not.toMatchObject({ fn: "greeting" });
    }
  });

  it("answers a bare farewell without the router", () => {
    for (const t of ["chau", "Chau!!", "gracias, chau", "hasta luego", "nos vemos 👋", "adiós", "saludos", "ok dale, hasta mañana", "bueno me voy, hasta la próxima"]) {
      expect(prefilter(t, null), t).toEqual({ kind: "faq", fn: "farewell", args: {} });
    }
    expect(prefilter("buenas noches", null)).toMatchObject({ fn: "greeting" });
  });

  it("a second farewell in a row is silenced", () => {
    for (const v of TEMPLATES.farewell) expect(prefilter("chau", v)).toEqual({ kind: "silence" });
  });

  it("a farewell with a question is not a bare farewell", () => {
    expect(prefilter("chau, mañana abren?", null)).not.toMatchObject({ fn: "farewell" });
  });

  it("does not misfire on unrelated words", () => {
    expect(prefilter("quiero un aliasado", null)).toBeNull();
  });

  it("ignores long messages", () => {
    expect(prefilter("hola buenas tardes queria saber cual es el horario de atencion", null)).toBeNull();
  });

  it("never silences a question or an empty-after-trim check", () => {
    for (const t of ["listo?", "ok?", "??", "ok gracias?", "dale?"]) expect(prefilter(t, null)).toBeNull();
    expect(prefilter("", null)).toEqual({ kind: "silence" });
    expect(prefilter("  ", null)).toEqual({ kind: "silence" });
  });

  it("does not match rules when the customer gives info or asks prices", () => {
    for (const t of [
      "mi direccion es Belgrano 123",
      "te paso mi ubicacion",
      "mi envio no llego",
      "me mandan foto?",
      "a que hora me lo mandan",
      "hacen descuento por efectivo?",
      "cuanto sale con mercado pago",
    ]) {
      expect(prefilter(t, null), t).toBeNull();
    }
  });

  it("keeps matching plain questions", () => {
    expect(prefilter("atienden los sabados?", null)).toMatchObject({ fn: "hours" });
    expect(prefilter("mi alias?", null)).toMatchObject({ fn: "handoff" });
  });
});
