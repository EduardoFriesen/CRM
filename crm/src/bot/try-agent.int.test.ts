import { APICallError } from "ai";
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
          content: [{ type: "tool-call", toolCallId: "c1", toolName: "set_stage", input: JSON.stringify({ stage: "consulta" }) }],
          finishReason: { unified: "tool-calls", raw: undefined },
          usage,
          warnings: [],
        },
        { content: [{ type: "text", text: "¡Genial!" }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] },
      ],
    });
    const r = await tryAgent(t.id, [{ role: "user", text: "Quiero comprar" }], { model });
    expect(r).toEqual({ success: true, data: { reply: "¡Genial!", stage: "consulta", adminNote: null, handoff: false } });
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

  it("only describes what it would ask the admin, without creating escalations", async () => {
    const t = await makeTenant();
    await saveAgentConfig(t.id, { agentName: "Sofi", provider: "anthropic", model: "m", apiKey: "sk-1234" }, async () => "valid");
    const model = new MockLanguageModelV4({
      doGenerate: [
        {
          content: [{ type: "tool-call", toolCallId: "a1", toolName: "ask_admin", input: JSON.stringify({ question: "¿Abren el domingo?", is_price: false, general: true }) }],
          finishReason: { unified: "tool-calls", raw: undefined },
          usage,
          warnings: [],
        },
        { content: [{ type: "text", text: "Lo consulto" }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] },
      ],
    });
    const r = await tryAgent(t.id, [{ role: "user", text: "¿Abren el domingo?" }], { model });
    expect(r).toMatchObject({ success: true, data: { adminNote: "(el bot consultaría al admin: ¿Abren el domingo?)" } });
    expect(await ownerSql`select 1 from escalations where tenant_id = ${t.id}`).toHaveLength(0);
  });

  it("reports a handoff so the test chat can replay it", async () => {
    const t = await makeTenant();
    await saveAgentConfig(t.id, { agentName: "Sofi", provider: "anthropic", model: "m", apiKey: "sk-1234" }, async () => "valid");
    const model = new MockLanguageModelV4({
      doGenerate: [
        {
          content: [{ type: "tool-call", toolCallId: "h1", toolName: "handoff_to_admin", input: JSON.stringify({ reason: "Quiere pagar" }) }],
          finishReason: { unified: "tool-calls", raw: undefined },
          usage,
          warnings: [],
        },
        { content: [{ type: "text", text: "Te atiende alguien" }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] },
      ],
    });
    const r = await tryAgent(t.id, [{ role: "user", text: "¿Cómo pago?" }], { model });
    expect(r).toMatchObject({ success: true, data: { handoff: true } });
  });

  it("explains an exhausted quota instead of a generic failure", async () => {
    const t = await makeTenant();
    await saveAgentConfig(t.id, { agentName: "Sofi", provider: "google", model: "m", apiKey: "sk-1234" }, async () => "valid");
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new APICallError({ message: "quota", url: "https://x", requestBodyValues: {}, statusCode: 429, responseBody: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" });
      },
    });
    expect(await tryAgent(t.id, [{ role: "user", text: "Hola" }], { model })).toMatchObject({
      success: false,
      error: { code: "QUOTA_EXCEEDED", message: expect.stringMatching(/cuota/i) },
    });
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

  it("replays a handoff turn of the test chat as a tool call", async () => {
    const t = await makeTenant();
    await saveAgentConfig(t.id, { agentName: "Sofi", provider: "anthropic", model: "m", apiKey: "sk-1234" }, async () => "valid");
    const model = new MockLanguageModelV4({
      doGenerate: { content: [{ type: "text", text: "Ok" }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] },
    });
    await tryAgent(
      t.id,
      [
        { role: "user", text: "Quiero 2" },
        { role: "assistant", text: "Te atiende alguien del equipo.", handoff: true },
        { role: "user", text: "Quiero 2 más" },
      ],
      { model },
    );
    expect(JSON.stringify(model.doGenerateCalls[0].prompt)).toMatch(/"type":"tool-call"[^}]*"toolName":"handoff_to_admin"/);
  });
});
