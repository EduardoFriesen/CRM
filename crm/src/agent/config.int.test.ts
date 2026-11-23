import { afterAll, describe, expect, it } from "vitest";
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
  businessInfo: "Abrimos de 8 a 20",
  provider: "anthropic",
  model: "claude-haiku-5-5",
  apiKey: "sk-xxxx1234",
  enabled: "on",
  discloseAi: "on",
};

describe("agent config", () => {
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
});
