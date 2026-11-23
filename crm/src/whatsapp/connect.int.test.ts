import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureConnection } from "@/whatsapp/connect";
import { verifySecret } from "@/whatsapp/secret";
import { dropTenants, makeTenant, ownerSql } from "@/test/db";

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  vi.stubEnv("EVOLUTION_URL", "http://evo:8080");
  vi.stubEnv("EVOLUTION_API_KEY", "k");
  vi.stubEnv("CRM_INTERNAL_URL", "http://crm:3000");
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});
afterAll(async () => {
  await dropTenants();
  await ownerSql.end();
});

function evolution(state: "open" | "close" | "connecting") {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith("/instance/create")) return json({}, 201);
    if (url.includes("/instance/connectionState/")) return json({ instance: { state } });
    if (url.includes("/instance/connect/")) return json({ base64: "data:image/png;base64,QR" });
    return json({}, 404);
  });
}

describe("ensureConnection", () => {
  it("creates the instance once, stores only the secret hash, and returns the QR", async () => {
    const t = await makeTenant();
    evolution("close");
    expect(await ensureConnection(t)).toEqual({ status: "close", qrBase64: "data:image/png;base64,QR" });
    await ensureConnection(t);
    const creates = fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/instance/create"));
    expect(creates).toHaveLength(1);
    const sent = JSON.parse(creates[0][1].body).webhook.headers["x-crm-webhook-secret"];
    const [row] = await ownerSql<{ name: string; secret_hash: string }[]>`
      select name, secret_hash from whatsapp_instances where tenant_id = ${t.id}`;
    expect(row.name).toBe(t.slug);
    expect(row.secret_hash).not.toBe(sent);
    expect(verifySecret(sent, row.secret_hash)).toBe(true);
  });

  it("returns no QR and records the state once connected", async () => {
    const t = await makeTenant();
    evolution("open");
    expect(await ensureConnection(t)).toEqual({ status: "open", qrBase64: null });
    const [row] = await ownerSql<{ status: string }[]>`select status from whatsapp_instances where tenant_id = ${t.id}`;
    expect(row.status).toBe("open");
  });

  it("does not store an instance when Evolution rejects the creation", async () => {
    const t = await makeTenant();
    fetchMock.mockResolvedValue(json({}, 500));
    await expect(ensureConnection(t)).rejects.toThrow(/Evolution request failed/);
    const rows = await ownerSql`select 1 from whatsapp_instances where tenant_id = ${t.id}`;
    expect(rows).toHaveLength(0);
  });
});
