import { describe, expect, it } from "vitest";
import { prefilter } from "./prefilter";

describe("prefilter", () => {
  it("silences trivial messages", () => {
    for (const t of ["ok", "Gracias!!", "👍", "dale"]) {
      expect(prefilter(t, "Sale $2.500.")).toEqual({ kind: "silence" });
    }
  });

  it("does not silence after a bot question", () => {
    expect(prefilter("dale", "¿Te lo reservo?")).toBeNull();
  });

  it("does not silence a batch with a real question", () => {
    expect(prefilter("gracias\ny cuánto sale el pan?", null)).toBeNull();
  });

  it("maps obvious questions", () => {
    expect(prefilter("a que hora abren?", null)).toEqual({ kind: "faq", fn: "hours", args: {} });
    expect(prefilter("dónde están?", null)).toMatchObject({ fn: "location" });
    expect(prefilter("aceptan mercadopago?", null)).toMatchObject({ fn: "payment_methods" });
    expect(prefilter("aceptan mercado pago?", null)).toMatchObject({ fn: "payment_methods" });
    expect(prefilter("hacen envios?", null)).toMatchObject({ fn: "shipping" });
  });

  it("paying is a handoff, not payment info", () => {
    expect(prefilter("pasame el alias", null)).toMatchObject({ fn: "handoff", args: { reason: "El cliente quiere pagar" } });
    expect(prefilter("cbu?", null)).toMatchObject({ fn: "handoff" });
    expect(prefilter("como pago con mercado pago?", null)).toMatchObject({ fn: "handoff" });
  });

  it("does not misfire on unrelated words", () => {
    expect(prefilter("quiero un aliasado", null)).toBeNull();
  });

  it("ignores long messages", () => {
    expect(prefilter("hola buenas tardes queria saber cual es el horario de atencion", null)).toBeNull();
  });

  it("never silences a question or an empty-after-trim check", () => {
    for (const t of ["listo?", "ok?", "??"]) expect(prefilter(t, null)).toBeNull();
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
