import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connect, connectionState, createInstance, EvolutionError, sendText } from "@/whatsapp/evolution";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubEnv("EVOLUTION_URL", "http://evo:8080");
  vi.stubEnv("EVOLUTION_API_KEY", "global-key");
  vi.stubEnv("CRM_INTERNAL_URL", "http://crm:3000");
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("evolution client", () => {
  it("creates the instance with a per-instance webhook secret header", async () => {
    fetchMock.mockResolvedValue(json({ instance: { instanceName: "pepe" } }, 201));
    await createInstance("pepe", "s3");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://evo:8080/instance/create");
    expect(init.method).toBe("POST");
    expect(init.headers.apikey).toBe("global-key");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ instanceName: "pepe", integration: "WHATSAPP-BAILEYS", qrcode: true, groupsIgnore: true });
    expect(body.webhook).toEqual({
      enabled: true,
      url: "http://crm:3000/api/webhooks/evolution/pepe",
      byEvents: false,
      base64: false,
      headers: { "x-crm-webhook-secret": "s3" },
      events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"],
    });
  });

  it("returns the QR while connecting and null once open", async () => {
    fetchMock.mockResolvedValueOnce(json({ code: "2@x", base64: "data:image/png;base64,AAA", count: 1 }));
    expect(await connect("pepe")).toEqual({ qrBase64: "data:image/png;base64,AAA" });
    fetchMock.mockResolvedValueOnce(json({ instance: { instanceName: "pepe", state: "open" } }));
    expect(await connect("pepe")).toEqual({ qrBase64: null });
    expect(fetchMock.mock.calls[0][0]).toBe("http://evo:8080/instance/connect/pepe");
  });

  it("reads the connection state", async () => {
    fetchMock.mockResolvedValue(json({ instance: { instanceName: "pepe", state: "connecting" } }));
    expect(await connectionState("pepe")).toBe("connecting");
  });

  it("throws EvolutionError without leaking the response body", async () => {
    fetchMock.mockResolvedValue(json({ message: "secret internals" }, 500));
    const err = await connectionState("pepe").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EvolutionError);
    expect(String((err as Error).message)).not.toContain("secret internals");
  });

  it("sends a text and returns the WhatsApp message id", async () => {
    fetchMock.mockResolvedValue(json({ key: { id: "ABC", remoteJid: "x" }, status: "PENDING" }, 201));
    expect(await sendText("pepe", "5491122334455@s.whatsapp.net", "hola")).toEqual({ id: "ABC" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://evo:8080/message/sendText/pepe");
    expect(JSON.parse(init.body)).toEqual({ number: "5491122334455@s.whatsapp.net", text: "hola" });
  });
});
