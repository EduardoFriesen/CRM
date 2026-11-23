import { describe, expect, it } from "vitest";
import { escalationText, handoffText, HINT_TEXT, relayConfirmText, reminderText } from "@/bot/admin-messages";

const ana = { name: "Ana", phone: "5491122334455" };

describe("admin messages", () => {
  it("formats a question without doubling the final punctuation", () => {
    expect(escalationText(ana, "¿Hacen envíos a Pilar?")).toBe(
      "Consulta de Ana (+5491122334455): ¿Hacen envíos a Pilar? Respondé citando este mensaje.",
    );
    expect(escalationText(ana, "Horario del domingo")).toBe(
      "Consulta de Ana (+5491122334455): Horario del domingo. Respondé citando este mensaje.",
    );
  });

  it("falls back to 'un cliente' and omits a missing phone", () => {
    expect(escalationText({ name: null, phone: null }, "x")).toBe("Consulta de un cliente: x. Respondé citando este mensaje.");
  });

  it("prefixes reminders", () => {
    expect(reminderText(ana, "¿Envíos?")).toBe(`Recordatorio: ${escalationText(ana, "¿Envíos?")}`);
  });

  it("formats a handoff", () => {
    expect(handoffText(ana, "Quiere 3 docenas para el sábado")).toBe(
      "Traspaso: Ana (+5491122334455) quiere cerrar una compra. Quiere 3 docenas para el sábado. Atendelo desde el WhatsApp del negocio.",
    );
  });

  it("confirms a relay, noting when a price was not learned", () => {
    expect(relayConfirmText("Ana", false)).toBe("Listo, le respondí a Ana.");
    expect(relayConfirmText(null, true)).toBe("Listo, le respondí a un cliente. (no la guardé porque es de precios)");
  });

  it("has the quoting hint", () => {
    expect(HINT_TEXT).toBe("Para responder una consulta, citá el mensaje de la consulta.");
  });
});
