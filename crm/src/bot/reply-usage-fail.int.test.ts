import { MockLanguageModelV4 } from "ai/test";
import { afterAll, describe, expect, it, vi } from "vitest";
import { saveAgentConfig } from "@/agent/config";
import { runConversation } from "@/bot/reply";
import { dropTenants, makeContact, makeInstance, makeTenant, ownerSql } from "@/test/db";

vi.mock("@/usage/usage", () => ({ recordUsage: vi.fn(async () => Promise.reject(new Error("db down"))) }));

afterAll(async () => {
  await dropTenants();
  await ownerSql.end();
});

describe("usage metering never blocks a reply", () => {
  it("still sends the reply when recording usage fails", async () => {
    const t = await makeTenant();
    await makeInstance(t.id, t.slug, "h");
    await saveAgentConfig(t.id, { agentName: "Sofi", provider: "anthropic", model: "m", apiKey: "sk-1234", enabled: "on" }, async () => "valid");
    const c = await makeContact(t.id, { name: "Ana", phone: "5491100000123" });
    await ownerSql`insert into messages (tenant_id, contact_id, direction, author, body, wa_message_id, sent_at)
      values (${t.id}, ${c.id}, 'in', 'customer', 'Hola', ${"U-" + Math.random()}, now())`;
    const usage = {
      inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 1, text: 1, reasoning: undefined },
    };
    const model = new MockLanguageModelV4({
      doGenerate: { content: [{ type: "text", text: "Hola!" }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await runConversation(t.id, c.id, { model, send: vi.fn(async () => ({ id: "U1" })) })).toBe("sent");
  });
});
