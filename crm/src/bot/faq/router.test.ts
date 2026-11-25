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
      ["catalog", "complex", "farewell", "handoff", "hours", "location", "order_status", "payment_methods", "price", "quote", "shipping", "stock", "unclear"],
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

  it("a quote carries every product with its quantity", async () => {
    const items = [{ product: "kikuyo", quantity: 300 }, { product: "tornillos 5mm", quantity: 12.5 }];
    const model = new MockLanguageModelV4({ doGenerate: call("quote", { items }) });
    expect((await routeMessage(model, turns(1))).call).toEqual({ fn: "quote", args: { items } });
  });

  it("a quote without items or with a non-positive quantity falls back to complex", async () => {
    for (const items of [[], [{ product: "kikuyo", quantity: 0 }]]) {
      const model = new MockLanguageModelV4({ doGenerate: call("quote", { items }) });
      expect((await routeMessage(model, turns(1))).call.fn).toBe("complex");
    }
  });

  const sysOf = (m: MockLanguageModelV4) => m.doGenerateCalls[0].prompt.filter((p) => p.role === "system").map((p) => p.content).join("");

  it("offers learned only when there are facts, numbered in the prompt", async () => {
    const none = new MockLanguageModelV4({ doGenerate: call("hours", {}) });
    await routeMessage(none, turns(1));
    expect(none.doGenerateCalls[0].tools?.map((t) => t.name)).not.toContain("learned");
    const some = new MockLanguageModelV4({ doGenerate: call("learned", { n: 2 }) });
    const r = await routeMessage(some, turns(1), { facts: [{ question: "¿Hacen factura A?" }, { question: "¿Tienen estacionamiento?" }] });
    expect(r.call).toEqual({ fn: "learned", args: { n: 2 } });
    expect(sysOf(some)).toContain("1. ¿Hacen factura A?");
    expect(sysOf(some)).toContain("2. ¿Tienen estacionamiento?");
    expect(sysOf(some)).toContain("Si cambia un dato");
  });

  it("learned with n out of range falls back to complex", async () => {
    const m = new MockLanguageModelV4({ doGenerate: call("learned", { n: 3 }) });
    expect((await routeMessage(m, turns(1), { facts: [{ question: "a" }, { question: "b" }] })).call.fn).toBe("complex");
  });

  it("sends at most 30 facts", async () => {
    const m = new MockLanguageModelV4({ doGenerate: call("hours", {}) });
    const facts = Array.from({ length: 35 }, (_, i) => ({ question: `pregunta ${i + 1}` }));
    await routeMessage(m, turns(1), { facts });
    expect(sysOf(m)).toContain("30. pregunta 30");
    expect(sysOf(m)).not.toContain("31. pregunta 31");
  });

  it("lists the tenant's shortcuts as guidance, learned ones by their fact number", async () => {
    const m = new MockLanguageModelV4({ doGenerate: call("hours", {}) });
    await routeMessage(m, turns(1), {
      facts: [{ id: "f1", question: "¿Hacen factura A?" }],
      examples: [
        { text: "a que hora cierran", fn: "hours", factId: null },
        { text: "emiten factura a", fn: "learned", factId: "f1" },
        { text: "y el estacionamiento", fn: "learned", factId: "gone" },
      ],
    });
    expect(sysOf(m)).toContain('"a que hora cierran" → hours');
    expect(sysOf(m)).toContain('"emiten factura a" → learned 1');
    expect(sysOf(m)).not.toContain("y el estacionamiento");
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
