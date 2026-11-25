import { MockLanguageModelV4 } from "ai/test";
import { afterAll, describe, expect, it, vi } from "vitest";
import { saveBusinessProfile } from "@/business/profile";
import { createProduct } from "@/catalog/catalog";
import type { HistoryTurn } from "@/bot/history";
import { dropTenants, makeTenant, ownerSql } from "@/test/db";
import { fill } from "./templates";
import { answerTurn } from "./turn";

afterAll(async () => {
  await dropTenants();
  await ownerSql.end();
});

const usage = {
  inputTokens: { total: 7, noCache: 7, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 2, text: 2, reasoning: undefined },
};
const routerFor = (toolName: string, input: object) =>
  new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: "tool-call", toolCallId: "c1", toolName, input: JSON.stringify(input) }],
      finishReason: { unified: "tool-calls", raw: undefined },
      usage,
      warnings: [],
    },
  });
const customer = (text: string): HistoryTurn[] => [{ role: "user", text }];
const complexReply = { text: "respuesta compleja", usage: { inputTokens: 100, outputTokens: 10, cachedTokens: 0 } };

function input(turns: HistoryTurn[], router: MockLanguageModelV4 | null, extra: Partial<Parameters<typeof answerTurn>[1]> = {}) {
  return {
    turns,
    stage: "consulta" as const,
    introduce: false,
    tenantName: "Panadería",
    routerModel: router,
    runComplex: vi.fn(async () => complexReply),
    doHandoff: vi.fn(async () => {}),
    ...extra,
  };
}

describe("answerTurn", () => {
  it("silence sends nothing and calls no model", async () => {
    const t = await makeTenant();
    const router = routerFor("hours", {});
    const i = input(customer("gracias"), router);
    const r = await answerTurn(t.id, i);
    expect(r).toMatchObject({ path: "silence", text: null });
    expect(router.doGenerateCalls).toHaveLength(0);
    expect(i.runComplex).not.toHaveBeenCalled();
  });

  it("prefilter rule answers with zero tokens", async () => {
    const t = await makeTenant();
    await saveBusinessProfile(t.id, { hours: "de 8 a 20" });
    const router = routerFor("complex", {});
    const r = await answerTurn(t.id, input(customer("a que hora abren?"), router));
    expect(r).toMatchObject({ path: "prefilter", fn: "hours", routerModel: null });
    expect(typeof r !== "string" && r.text).toContain("de 8 a 20");
    expect(router.doGenerateCalls).toHaveLength(0);
  });

  it("router FAQ answers without the main model", async () => {
    const t = await makeTenant();
    await createProduct(t.id, { name: "Pan de campo", price: "2500" });
    const i = input(customer("che cuanto sale el pan"), routerFor("price", { product: "pan" }));
    const r = await answerTurn(t.id, i);
    expect(r).toMatchObject({ path: "faq", fn: "price", handoff: false, routerModel: "mock-model-id" });
    expect(typeof r !== "string" && r.text).toContain("Pan de campo");
    expect(typeof r !== "string" && r.routerUsage).toEqual({ inputTokens: 7, outputTokens: 2, cachedTokens: 0 });
    expect(i.runComplex).not.toHaveBeenCalled();
  });

  it("empty field goes to the complex path", async () => {
    const t = await makeTenant();
    const i = input(customer("me decis cuando atienden los domingos y feriados por favor gracias"), routerFor("hours", {}));
    const r = await answerTurn(t.id, i);
    expect(r).toMatchObject({ path: "complex", fn: "hours", text: "respuesta compleja", usage: complexReply.usage });
    expect(typeof r !== "string" && r.routerUsage.inputTokens).toBeGreaterThan(0);
    expect(i.runComplex).toHaveBeenCalledOnce();
  });

  it("handoff runs the handoff and answers with its template", async () => {
    const t = await makeTenant();
    const i = input(customer("quiero encargar dos docenas para el sabado"), routerFor("handoff", { reason: "Quiere encargar" }), { pick: () => 0 });
    const r = await answerTurn(t.id, i);
    expect(i.doHandoff).toHaveBeenCalledOnce();
    expect(i.doHandoff).toHaveBeenCalledWith("Quiere encargar");
    expect(r).toMatchObject({ path: "handoff", fn: "handoff", handoff: true });
    expect(typeof r !== "string" && r.text).toBe(fill("handoff", {}, () => 0));
  });

  it("outside consulta skips prefilter and router", async () => {
    const t = await makeTenant();
    await saveBusinessProfile(t.id, { hours: "de 8 a 20" });
    const router = routerFor("hours", {});
    const i = input(customer("a que hora abren?"), router, { stage: "postventa" });
    const r = await answerTurn(t.id, i);
    expect(r).toMatchObject({ path: "complex", fn: null, text: "respuesta compleja", routerModel: null });
    expect(router.doGenerateCalls).toHaveLength(0);
  });

  it("introduces itself on a template answer", async () => {
    const t = await makeTenant();
    await saveBusinessProfile(t.id, { hours: "de 8 a 20" });
    const r = await answerTurn(t.id, input(customer("a que hora abren?"), null, { introduce: true, pick: () => 0 }));
    expect(typeof r !== "string" && r.text).toBe(`${fill("intro", { tenant: "Panadería" }, () => 0)}\n${fill("hours", { hours: "de 8 a 20" }, () => 0)}`);
  });

  it("classifies the customer block after the last bot turn, and no router means complex", async () => {
    const t = await makeTenant();
    await saveBusinessProfile(t.id, { hours: "de 8 a 20" });
    // The bot asked something: "dale" is not trivial, and with no router it goes to the full bot.
    const turns: HistoryTurn[] = [{ role: "user", text: "hola" }, { role: "assistant", text: "¿Querés que te reserve uno?" }, { role: "user", text: "dale" }];
    const i = input(turns, null);
    expect(await answerTurn(t.id, i)).toMatchObject({ path: "complex" });
    expect(i.runComplex).toHaveBeenCalledOnce();
  });

  it("falls back to the full bot when the router model is unusable (unknown model, no tools)", async () => {
    const t = await makeTenant();
    const { APICallError } = await import("ai");
    const router = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new APICallError({ message: "bad", url: "https://x", requestBodyValues: {}, statusCode: 400, responseBody: "" });
      },
    });
    const i = input(customer("me contas como es el tema de los pedidos grandes para eventos"), router);
    expect(await answerTurn(t.id, i)).toMatchObject({ path: "complex", fn: null, text: "respuesta compleja", routerModel: "mock-model-id" });
    expect(i.runComplex).toHaveBeenCalledOnce();
  });
});
