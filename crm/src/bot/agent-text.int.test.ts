import { MockLanguageModelV4 } from "ai/test";
import { afterAll, describe, expect, it } from "vitest";
import { tool } from "ai";
import { z } from "zod";
import { generateAgentText } from "@/bot/reply";
import { dropTenants, makeTenant, ownerSql } from "@/test/db";

afterAll(async () => {
  await dropTenants();
  await ownerSql.end();
});

const usage = {
  inputTokens: { total: 5, noCache: 5, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 2, text: 2, reasoning: undefined },
};

describe("generateAgentText with mark_faq", () => {
  it("keeps the reply written next to a mark_faq call and does not ask the model again", async () => {
    const t = await makeTenant();
    let calls = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        calls++;
        return calls === 1
          ? {
              content: [
                { type: "text" as const, text: "Atendemos de 8 a 20." },
                { type: "tool-call" as const, toolCallId: "m1", toolName: "mark_faq", input: JSON.stringify({ fn: "hours" }) },
              ],
              finishReason: { unified: "tool-calls" as const, raw: undefined },
              usage,
              warnings: [],
            }
          : { content: [], finishReason: { unified: "stop" as const, raw: undefined }, usage, warnings: [] };
      },
    });
    const tools = { mark_faq: tool({ description: "m", inputSchema: z.object({ fn: z.string() }), execute: async () => ({ ok: true }) }) };
    const r = await generateAgentText(t.id, model, { system: [], messages: [{ role: "user", content: "a que hora abren" }], tools });
    expect(r.text).toBe("Atendemos de 8 a 20.");
    expect(calls).toBe(1);
  });

  it("still asks again when mark_faq came without a reply", async () => {
    const t = await makeTenant();
    let calls = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        calls++;
        return calls === 1
          ? {
              content: [{ type: "tool-call" as const, toolCallId: "m1", toolName: "mark_faq", input: JSON.stringify({ fn: "hours" }) }],
              finishReason: { unified: "tool-calls" as const, raw: undefined },
              usage,
              warnings: [],
            }
          : { content: [{ type: "text" as const, text: "De 8 a 20." }], finishReason: { unified: "stop" as const, raw: undefined }, usage, warnings: [] };
      },
    });
    const tools = { mark_faq: tool({ description: "m", inputSchema: z.object({ fn: z.string() }), execute: async () => ({ ok: true }) }) };
    const r = await generateAgentText(t.id, model, { system: [], messages: [{ role: "user", content: "a que hora abren" }], tools });
    expect(r.text).toBe("De 8 a 20.");
  });
});
