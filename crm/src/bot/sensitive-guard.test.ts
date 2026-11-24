import { describe, expect, it } from "vitest";
import { asksForSensitiveData } from "@/bot/sensitive-guard";

describe("asksForSensitiveData", () => {
  it.each([
    "¿podés proporcionarme tus datos bancarios para la transferencia?",
    "Pasame tu CBU y te confirmo",
    "mandame tu alias",
    "Necesito el número de tu tarjeta",
    "decime los datos de la tarjeta",
    "¿Me pasás el código de seguridad?",
    "Indicame tu DNI por favor",
    "¿cuál es tu clave?",
    "enviame tu CVU",
  ])("flags %s", (t) => expect(asksForSensitiveData(t)).toBe(true));

  it.each([
    "Podés transferir a nuestro alias pasto.sur",
    "Aceptamos efectivo y transferencia",
    "¿A qué dirección te lo enviamos?",
    "Lo consulto y te aviso",
    "La tarjeta de crédito no la aceptamos",
  ])("lets %s through", (t) => expect(asksForSensitiveData(t)).toBe(false));
});
