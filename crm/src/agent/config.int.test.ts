import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { getAgentRuntime, getAgentView, isBotActive, markKeyInvalid, saveAgentConfig } from "@/agent/config";
import { withTenant } from "@/db/client";
import { agentConfigs } from "@/db/schema";
import { dropTenants, makeTenant, ownerSql } from "@/test/db";

afterAll(async () => {
  await dropTenants();
  await ownerSql.end();
});

const valid = async () => "valid" as const;
const base = {
  agentName: "Sofi",
  tone: "Cálida y breve",
  provider: "anthropic",
  model: "claude-haiku-5-5",
  apiKey: "sk-xxxx1234",
  enabled: "on",
  discloseAi: "on",
};

describe("agent config", () => {
  it("saves the router model; blank means none", async () => {
    const t = await makeTenant();
    expect(await saveAgentConfig(t.id, { ...base, routerModel: "" }, valid)).toMatchObject({ success: true, data: { routerModel: null } });
    expect(await saveAgentConfig(t.id, { ...base, routerModel: "claude-haiku-5-5" }, valid)).toMatchObject({
      success: true,
      data: { routerModel: "claude-haiku-5-5" },
    });
    expect((await getAgentRuntime(t.id))?.routerModel).toBe("claude-haiku-5-5");
  });

  it("refuses a router model the provider does not recognize", async () => {
    const t = await makeTenant();
    const verify = vi.fn(async (s: { model: string }) =>
      s.model === "no-existe" ? { status: "unverified" as const, code: "HTTP_404" } : { status: "valid" as const, code: null },
    );
    expect(await saveAgentConfig(t.id, { ...base, routerModel: "no-existe" }, verify)).toMatchObject({
      success: false,
      error: { code: "VALIDATION", details: { routerModel: ["El proveedor no reconoce ese modelo"] } },
    });
    expect(await getAgentView(t.id)).toBeNull();
    // Saved once with a good router model, a later change to a bad one is checked too.
    expect(await saveAgentConfig(t.id, { ...base, routerModel: "claude-haiku-5-5" }, verify)).toMatchObject({ success: true });
    expect(await saveAgentConfig(t.id, { ...base, apiKey: "", routerModel: "no-existe" }, verify)).toMatchObject({ success: false });
    expect((await getAgentView(t.id))?.routerModel).toBe("claude-haiku-5-5");
  });

  it("does not recheck an unchanged router model", async () => {
    const t = await makeTenant();
    await saveAgentConfig(t.id, { ...base, routerModel: "r1" }, valid);
    const verify = vi.fn(valid);
    expect(await saveAgentConfig(t.id, { ...base, apiKey: "", routerModel: "r1", tone: "otro" }, verify)).toMatchObject({ success: true });
    expect(verify).not.toHaveBeenCalled();
  });

  it("stores the key encrypted and never returns it", async () => {
    const t = await makeTenant();
    const r = await saveAgentConfig(t.id, base, valid);
    expect(r).toMatchObject({ success: true, data: { apiKeyLast4: "1234", keyStatus: "valid", enabled: true, discloseAi: true } });
    const view = await getAgentView(t.id);
    expect(JSON.stringify(view)).not.toContain("sk-xxxx1234");
    expect(JSON.stringify(r)).not.toContain("sk-xxxx1234");
    const [row] = await ownerSql<{ api_key_enc: string }[]>`select api_key_enc from agent_configs where tenant_id = ${t.id}`;
    expect(row.api_key_enc).not.toContain("sk-xxxx1234");
    expect((await getAgentRuntime(t.id))?.apiKey).toBe("sk-xxxx1234");
  });

  it("refuses a key the provider rejects and stores nothing", async () => {
    const t = await makeTenant();
    expect(await saveAgentConfig(t.id, base, async () => "invalid")).toMatchObject({
      success: false,
      error: { code: "KEY_INVALID" },
    });
    expect(await getAgentView(t.id)).toBeNull();
  });

  it("saves an unverifiable key as unverified", async () => {
    const t = await makeTenant();
    expect(await saveAgentConfig(t.id, base, async () => "unverified")).toMatchObject({
      success: true,
      data: { keyStatus: "unverified" },
    });
  });

  it("keeps the previous key when saving without one, and requires one the first time", async () => {
    const t = await makeTenant();
    expect(await saveAgentConfig(t.id, { ...base, apiKey: "" }, valid)).toMatchObject({
      success: false,
      error: { code: "VALIDATION", details: { apiKey: expect.any(Array) } },
    });
    await saveAgentConfig(t.id, base, valid);
    expect(await saveAgentConfig(t.id, { ...base, apiKey: "", tone: "Formal" }, valid)).toMatchObject({ success: true });
    const rt = await getAgentRuntime(t.id);
    expect(rt).toMatchObject({ apiKey: "sk-xxxx1234", tone: "Formal" });
  });

  it("treats unchecked switches as off", async () => {
    const t = await makeTenant();
    expect(await saveAgentConfig(t.id, { ...base, enabled: undefined, discloseAi: undefined }, valid)).toMatchObject({ data: { enabled: false, discloseAi: false } });
  });

  it("rejects an internal base URL for OpenAI-compatible providers", async () => {
    const t = await makeTenant();
    const r = await saveAgentConfig(t.id, { ...base, provider: "openai-compatible", baseUrl: "https://10.0.0.5/v1" }, valid);
    expect(r).toMatchObject({ success: false, error: { code: "VALIDATION", details: { baseUrl: expect.any(Array) } } });
  });

  it("is isolated per tenant", async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    await saveAgentConfig(a.id, base, valid);
    expect(await withTenant(b.id, (tx) => tx.select().from(agentConfigs))).toEqual([]);
    expect(await getAgentView(b.id)).toBeNull();
  });

  it("reports the bot as active only while enabled with a usable key", async () => {
    const t = await makeTenant();
    expect(await isBotActive(t.id)).toBe(false);
    await saveAgentConfig(t.id, base, valid);
    expect(await isBotActive(t.id)).toBe(true);
    await markKeyInvalid(t.id);
    expect(await isBotActive(t.id)).toBe(false);
    expect((await getAgentView(t.id))?.keyStatus).toBe("invalid");
  });

  it("saves a key whose quota is exhausted as valid, flagging the quota", async () => {
    const t = await makeTenant();
    expect(await saveAgentConfig(t.id, base, async () => "quota")).toMatchObject({
      success: true,
      data: { keyStatus: "valid", lastErrorCode: "QUOTA_EXCEEDED" },
    });
  });

  it("clears the last error once a key verifies fine", async () => {
    const t = await makeTenant();
    await saveAgentConfig(t.id, base, valid);
    await ownerSql`update agent_configs set last_error_code = 'HTTP_429', last_error_at = now() where tenant_id = ${t.id}`;
    expect(await saveAgentConfig(t.id, { ...base, apiKey: "sk-otra-5678" }, valid)).toMatchObject({
      data: { lastErrorCode: null, lastErrorAt: null },
    });
  });

  it("records why a key could not be verified", async () => {
    const t = await makeTenant();
    expect(await saveAgentConfig(t.id, base, async () => ({ status: "unverified" as const, code: "HTTP_503" }))).toMatchObject({
      success: true,
      data: { keyStatus: "unverified", lastErrorCode: "VERIFY_HTTP_503" },
    });
  });

  it("stores optional daily limits and clears them with an empty field", async () => {
    const t = await makeTenant();
    expect(await saveAgentConfig(t.id, { ...base, dailyRequestLimit: "1000", dailyTokenLimit: "200000" }, valid)).toMatchObject({
      data: { dailyRequestLimit: 1000, dailyTokenLimit: 200000 },
    });
    expect(await saveAgentConfig(t.id, { ...base, apiKey: "", dailyRequestLimit: "", dailyTokenLimit: "" }, valid)).toMatchObject({
      data: { dailyRequestLimit: null, dailyTokenLimit: null },
    });
  });

  it("reads limits written the Argentine way", async () => {
    const t = await makeTenant();
    expect(await saveAgentConfig(t.id, { ...base, dailyRequestLimit: "1.000", dailyTokenLimit: "200.000" }, valid)).toMatchObject({
      data: { dailyRequestLimit: 1000, dailyTokenLimit: 200000 },
    });
    expect(await saveAgentConfig(t.id, { ...base, apiKey: "", dailyRequestLimit: "mil" }, valid)).toMatchObject({
      error: { code: "VALIDATION", details: { dailyRequestLimit: ["Escribí solo números (ej. 1000)"] } },
    });
  });

  describe("ollama (development only)", () => {
    afterEach(() => vi.unstubAllEnvs());
    const local = { ...base, provider: "ollama", model: "qwen3:8b", apiKey: "" };

    it("is refused when the server has no Ollama", async () => {
      vi.stubEnv("OLLAMA_URL", "");
      const t = await makeTenant();
      expect(await saveAgentConfig(t.id, local, valid)).toMatchObject({
        success: false,
        error: { code: "VALIDATION", details: { provider: ["Ollama no está disponible en este servidor"] } },
      });
      expect(await ownerSql`select 1 from agent_configs where tenant_id = ${t.id}`).toHaveLength(0);
    });

    it("needs no key and ignores a tenant-supplied URL", async () => {
      vi.stubEnv("OLLAMA_URL", "http://127.0.0.1:11434/v1");
      const t = await makeTenant();
      expect(await saveAgentConfig(t.id, { ...local, baseUrl: "http://evil.example" }, valid)).toMatchObject({
        success: true,
        data: { provider: "ollama", baseUrl: null, apiKeyLast4: "" },
      });
    });

    it("saves as unverified when Ollama is down", async () => {
      vi.stubEnv("OLLAMA_URL", "http://127.0.0.1:9/v1");
      const t = await makeTenant();
      expect(await saveAgentConfig(t.id, local)).toMatchObject({
        success: true,
        data: { keyStatus: "unverified", lastErrorCode: "VERIFY_HTTP_NETWORK" },
      });
    });

    it("asks for a real key when moving back to a cloud provider", async () => {
      vi.stubEnv("OLLAMA_URL", "http://127.0.0.1:11434/v1");
      const t = await makeTenant();
      await saveAgentConfig(t.id, local, valid);
      expect(await saveAgentConfig(t.id, { ...base, provider: "google", model: "gemini-3.5-flash", apiKey: "" }, valid)).toMatchObject({
        success: false,
        error: { details: { apiKey: ["Cargá la API key"] } },
      });
    });
  });
});
