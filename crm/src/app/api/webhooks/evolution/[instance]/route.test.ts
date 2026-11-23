import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/whatsapp/webhook", () => ({
  handleEvolutionEvent: vi.fn(async () => {
    throw Object.assign(new Error('duplicate key: Key (jid)=(5491122334455@s.whatsapp.net)'), { code: "23505" });
  }),
}));

const { POST } = await import("./route");

afterEach(() => vi.restoreAllMocks());

describe("evolution webhook route", () => {
  it("answers a contract-shaped 500 and never logs error details", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(new Request("http://crm/api/webhooks/evolution/x", { method: "POST", body: "{}" }), {
      params: Promise.resolve({ instance: "x" }),
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: { code: "INTERNAL", message: "Internal error" } });
    const logged = log.mock.calls.flat().map(String).join(" ");
    expect(logged).not.toContain("5491122334455");
    expect(logged).toContain("23505");
  });
});
