import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { describe, expect, it } from "vitest";
import type { HistoryTurn } from "@/bot/history";
import { routeMessage } from "./router";

const mkUsage = (i = 1, o = 1) => ({
  inputTokens: { total: i, noCache: i, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: o, text: o, reasoning: undefined },
});
const call = (toolName: string, input: object, usage = mkUsage()) => ({
  content: [{ type: "tool-call" as const, toolCallId: "c1", toolName, input: JSON.stringify(input) }],
  finishReason: { unified: "tool-calls" as const, raw: undefined },
  usage,
  warnings: [],
});
const turns = (n: number): HistoryTurn[] =>
  Array.from({ length: n }, (_, i) => ({ role: i % 2 === 0 ? "user" : "assistant", text: `t${i}` }));

describe("routeMessage", () => {
  it("returns the tool the model picked with its args", async () => {
    const model = new MockLanguageModelV4({ doGenerate: call("price", { product: "pan" }) });
    const r = await routeMessage(model, turns(1));
    expect(r.call).toEqual({ fn: "price", args: { product: "pan" } });
  });

  it("forces a tool and caps output", async () => {
    const model = new MockLanguageModelV4({ doGenerate: call("hours", {}) });
    await routeMessage(model, turns(1));
    const c = model.doGenerateCalls[0];
    expect(c.toolChoice?.type).toBe("required");
    expect(c.maxOutputTokens).toBe(200);
    expect(c.tools?.map((t) => t.name).sort()).toEqual(
      ["catalog", "complex", "greeting", "handoff", "hours", "location", "payment_methods", "price", "shipping", "stock", "unclear"],
    );
  });

  it("sends only the last 3 turns and no business data", async () => {
    const model = new MockLanguageModelV4({ doGenerate: call("hours", {}) });
    await routeMessage(model, turns(5));
    const p = model.doGenerateCalls[0].prompt;
    expect(p.filter((m) => m.role !== "system")).toHaveLength(3);
    const sys = p.filter((m) => m.role === "system").map((m) => m.content).join("");
    expect(sys.length).toBeLessThan(1500);
  });

  it("invalid args fall back to complex", async () => {
    const model = new MockLanguageModelV4({ doGenerate: call("price", { product: "" }) });
    expect((await routeMessage(model, turns(1))).call).toEqual({ fn: "complex", args: {} });
  });

  it("unknown tool or plain text falls back to complex", async () => {
    const unknown = new MockLanguageModelV4({ doGenerate: call("nope", {}, mkUsage(10, 2)) });
    const u = await routeMessage(unknown, turns(1));
    expect(u.call.fn).toBe("complex");
    expect(u.usage).toEqual({ inputTokens: 10, outputTokens: 2, cachedTokens: 0 });
    const plain = new MockLanguageModelV4({
      doGenerate: { content: [{ type: "text", text: "hola" }], finishReason: { unified: "stop", raw: undefined }, usage: mkUsage(10, 2), warnings: [] },
    });
    const p = await routeMessage(plain, turns(1));
    expect(p.call.fn).toBe("complex");
    expect(p.usage).toEqual({ inputTokens: 10, outputTokens: 2, cachedTokens: 0 });
  });

  it("reports usage", async () => {
    const model = new MockLanguageModelV4({ doGenerate: call("hours", {}, mkUsage(10, 2)) });
    expect((await routeMessage(model, turns(1))).usage).toEqual({ inputTokens: 10, outputTokens: 2, cachedTokens: 0 });
  });

  it("rethrows provider errors", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new APICallError({ message: "bad key", url: "u", requestBodyValues: {}, statusCode: 401 });
      },
    });
    await expect(routeMessage(model, turns(1))).rejects.toBeInstanceOf(APICallError);
  });

  it("works with openai-compatible / ollama models", async () => {
    const fetch = async () =>
      Response.json({
        id: "r1",
        created: 0,
        model: "m",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "hours", arguments: "{}" } }] },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
      });
    const model = createOpenAICompatible({ name: "ollama", baseURL: "http://localhost:1/v1", fetch })("qwen3:8b");
    const r = await routeMessage(model, turns(1));
    expect(r.call).toEqual({ fn: "hours", args: {} });
    expect(r.usage).toMatchObject({ inputTokens: 12, outputTokens: 3 });
  });
});
