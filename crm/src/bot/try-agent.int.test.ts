import { MockLanguageModelV4 } from "ai/test";
import { afterAll, describe, expect, it } from "vitest";
import { saveAgentConfig } from "@/agent/config";
import { tryAgent } from "@/bot/try-agent";
import { dropTenants, makeContact, makeTenant, ownerSql } from "@/test/db";

afterAll(async () => {
  await dropTenants();
  await ownerSql.end();
});

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

describe("tryAgent", () => {
  it("answers with the real config and reports the stage without moving anyone", async () => {
    const t = await makeTenant();
    await saveAgentConfig(t.id, { agentName: "Sofi", provider: "anthropic", model: "m", apiKey: "sk-1234" }, async () => "valid");
    await makeContact(t.id, { name: "Ana" });
    const model = new MockLanguageModelV4({
      doGenerate: [
        {
          content: [{ type: "tool-call", toolCallId: "c1", toolName: "set_stage", input: JSON.stringify({ stage: "venta" }) }],
          finishReason: { unified: "tool-calls", raw: undefined },
          usage,
          warnings: [],
        },
        { content: [{ type: "text", text: "¡Genial!" }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] },
      ],
    });
    const r = await tryAgent(t.id, [{ role: "user", text: "Quiero comprar" }], { model });
    expect(r).toEqual({ success: true, data: { reply: "¡Genial!", stage: "venta" } });
    const stages = await ownerSql<{ stage: string }[]>`select stage from contacts where tenant_id = ${t.id}`;
    expect(stages).toEqual([{ stage: "consulta" }]);
  });

  it("works while the bot is switched off", async () => {
    const t = await makeTenant();
    await saveAgentConfig(t.id, { agentName: "Sofi", provider: "anthropic", model: "m", apiKey: "sk-1234" }, async () => "valid");
    const model = new MockLanguageModelV4({
      doGenerate: { content: [{ type: "text", text: "Hola" }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] },
    });
    expect(await tryAgent(t.id, [{ role: "user", text: "Hola" }], { model })).toMatchObject({ success: true });
  });

  it("opens the model history with a user turn", async () => {
    const t = await makeTenant();
    await saveAgentConfig(t.id, { agentName: "Sofi", provider: "anthropic", model: "m", apiKey: "sk-1234" }, async () => "valid");
    const model = new MockLanguageModelV4({
      doGenerate: { content: [{ type: "text", text: "ok" }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] },
    });
    await tryAgent(t.id, [{ role: "assistant", text: "Hola" }, { role: "user", text: "¿Precio?" }], { model });
    expect(model.doGenerateCalls[0].prompt.filter((m) => m.role !== "system")[0].role).toBe("user");
  });

  it("rejects an oversized history", async () => {
    const t = await makeTenant();
    const history = Array.from({ length: 21 }, () => ({ role: "user" as const, text: "hola" }));
    expect(await tryAgent(t.id, history)).toMatchObject({ success: false, error: { code: "VALIDATION" } });
  });

  it("asks for a key when there is no agent yet", async () => {
    const t = await makeTenant();
    expect(await tryAgent(t.id, [{ role: "user", text: "Hola" }])).toMatchObject({
      success: false,
      error: { code: "NO_KEY", message: "Cargá una API key para probar el agente" },
    });
  });
});
