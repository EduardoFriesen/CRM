import { MockLanguageModelV4 } from "ai/test";
import { afterAll, describe, expect, it, vi } from "vitest";
import { saveBusinessProfile } from "@/business/profile";
import { createProduct } from "@/catalog/catalog";
import type { HistoryTurn } from "@/bot/history";
import { dropTenants, makeContact, makeTenant, ownerSql } from "@/test/db";
import { saveExample } from "./examples";
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
    stage: "consulta" as "consulta" | "venta" | "postventa",
    contactId: "",
    introduce: false,
    tenantName: "Panadería",
    routerModel: router,
    runComplex: vi.fn(async () => complexReply),
    doHandoff: vi.fn(async () => {}),
    doAttention: vi.fn(async () => {}),
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

  it("a quote over the stock asks a person for attention, without a sale", async () => {
    const t = await makeTenant();
    const r0 = await createProduct(t.id, { name: "Kikuyo", price: "10000", stock: "10" });
    if (!r0.success) throw new Error("setup failed");
    const i = input(customer("quiero 300 m2 de kikuyo"), routerFor("quote", { items: [{ product: "kikuyo", quantity: 300 }] }), { pick: () => 0 });
    const r = await answerTurn(t.id, i);
    expect(r).toMatchObject({ path: "handoff", fn: "quote", handoff: true });
    expect(i.doAttention).toHaveBeenCalledWith(expect.stringContaining("Kikuyo"));
    expect(i.doHandoff).not.toHaveBeenCalled();
    expect(typeof r !== "string" && r.text).toBe(fill("quote_short", {}, () => 0));
  });

  it("a quote answers with the total and no handoff", async () => {
    const t = await makeTenant();
    const r0 = await createProduct(t.id, { name: "Kikuyo", price: "10000" });
    if (!r0.success) throw new Error("setup failed");
    const i = input(customer("cuanto serian 300 m2 de kikuyo"), routerFor("quote", { items: [{ product: "kikuyo", quantity: 300 }] }));
    const r = await answerTurn(t.id, i);
    expect(r).toMatchObject({ path: "faq", fn: "quote", handoff: false });
    expect(typeof r !== "string" && r.text).toContain("$3.000.000");
    expect(i.doHandoff).not.toHaveBeenCalled();
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

  it("attention asks a person with its reason and answers with the handoff template", async () => {
    const t = await makeTenant();
    const i = input(customer("mi pedido llego roto"), routerFor("attention", { reason: "Reclamo: llegó roto" }), { pick: () => 0 });
    const r = await answerTurn(t.id, i);
    expect(i.doAttention).toHaveBeenCalledExactlyOnceWith("Reclamo: llegó roto");
    expect(i.doHandoff).not.toHaveBeenCalled();
    expect(r).toMatchObject({ path: "handoff", fn: "attention", handoff: true });
    expect(typeof r !== "string" && r.text).toBe(fill("handoff", {}, () => 0));
  });

  it("in postventa attention stays cheap and a sale handoff goes to the main model", async () => {
    const t = await makeTenant();
    const a = input(customer("mi pedido llego roto"), routerFor("attention", { reason: "Reclamo" }), { stage: "postventa" });
    expect(await answerTurn(t.id, a)).toMatchObject({ fn: "attention" });
    expect(a.doAttention).toHaveBeenCalledOnce();
    const h = input(customer("quiero comprar otra"), routerFor("handoff", { reason: "Compra" }), { stage: "postventa" });
    expect(await answerTurn(t.id, h)).toMatchObject({ path: "complex" });
    expect(h.doHandoff).not.toHaveBeenCalled();
  });

  it("venta always goes to the main model, skipping prefilter and router", async () => {
    const t = await makeTenant();
    await saveBusinessProfile(t.id, { hours: "de 8 a 20" });
    const router = routerFor("hours", {});
    const i = input(customer("a que hora abren?"), router, { stage: "venta" });
    const r = await answerTurn(t.id, i);
    expect(r).toMatchObject({ path: "complex", fn: null, text: "respuesta compleja", routerModel: null });
    expect(router.doGenerateCalls).toHaveLength(0);
  });

  it("in postventa the router answers order status", async () => {
    const t = await makeTenant();
    const c = await makeContact(t.id);
    await ownerSql`insert into orders (tenant_id, contact_id, delivery_date, address, total) values (${t.id}, ${c.id}, '2099-11-28', 'Av. Siempre Viva 123', 100)`;
    const i = input(customer("cuando me llega?"), routerFor("order_status", {}), { stage: "postventa", contactId: c.id, pick: () => 0 });
    const r = await answerTurn(t.id, i);
    expect(r).toMatchObject({ path: "faq", fn: "order_status", text: fill("order_pending", { date: "sábado 28/11", address: "Av. Siempre Viva 123" }, () => 0) });
  });

  it("in postventa a product question goes to the main model", async () => {
    const t = await makeTenant();
    const i = input(customer("cuanto sale el pan?"), routerFor("price", { product: "pan" }), { stage: "postventa" });
    expect(await answerTurn(t.id, i)).toMatchObject({ path: "complex", routerModel: "mock-model-id" });
    expect(i.runComplex).toHaveBeenCalledOnce();
  });

  it("in postventa the rules still answer", async () => {
    const t = await makeTenant();
    await saveBusinessProfile(t.id, { hours: "de 8 a 20" });
    const r = await answerTurn(t.id, input(customer("a que hora abren?"), null, { stage: "postventa" }));
    expect(r).toMatchObject({ path: "prefilter", fn: "hours" });
  });

  it("in consulta order_status goes to the main model", async () => {
    const t = await makeTenant();
    const c = await makeContact(t.id);
    await ownerSql`insert into orders (tenant_id, contact_id, delivery_date, address, total) values (${t.id}, ${c.id}, '2099-11-28', 'X', 100)`;
    const i = input(customer("cuando me llega?"), routerFor("order_status", {}), { contactId: c.id });
    expect(await answerTurn(t.id, i)).toMatchObject({ path: "complex" });
  });

  it("the router's learned number maps to the fact id", async () => {
    const t = await makeTenant();
    await ownerSql`insert into business_facts (tenant_id, question, answer, updated_at) values
      (${t.id}, 'vieja', 'respuesta vieja', '2026-10-01'), (${t.id}, 'nueva', 'respuesta nueva', '2026-11-01')`;
    const r = await answerTurn(t.id, input(customer("eso de la nueva?"), routerFor("learned", { n: 1 })));
    expect(r).toMatchObject({ path: "faq", fn: "learned", text: "respuesta nueva" });
  });

  it("an exact shortcut answers without the router", async () => {
    const t = await makeTenant();
    await saveBusinessProfile(t.id, { hours: "de 8 a 20" });
    await saveExample(t.id, { text: "che cuando estan abiertos", fn: "hours" });
    const router = routerFor("complex", {});
    const r = await answerTurn(t.id, input(customer("Che, ¿cuándo están abiertos?"), router, { pick: () => 0 }));
    expect(r).toMatchObject({ path: "example", fn: "hours", text: fill("hours", { hours: "de 8 a 20" }, () => 0) });
    expect(router.doGenerateCalls).toHaveLength(0);
  });

  it("a shortcut whose function has no data falls through to the router", async () => {
    const t = await makeTenant();
    await saveExample(t.id, { text: "che cuando estan abiertos", fn: "hours" });
    const router = routerFor("complex", {});
    expect(await answerTurn(t.id, input(customer("che cuando estan abiertos"), router))).toMatchObject({ path: "complex" });
    expect(router.doGenerateCalls).toHaveLength(1);
  });

  it("a shortcut not allowed in the stage falls through to the router", async () => {
    const t = await makeTenant();
    const c = await makeContact(t.id);
    await ownerSql`insert into orders (tenant_id, contact_id, delivery_date, address, total) values (${t.id}, ${c.id}, '2099-11-28', 'X', 100)`;
    await saveExample(t.id, { text: "y lo mio para cuando", fn: "order_status" });
    const router = routerFor("complex", {});
    await answerTurn(t.id, input(customer("y lo mio para cuando"), router, { contactId: c.id }));
    expect(router.doGenerateCalls).toHaveLength(1);
  });

  it("a learned shortcut answers its fact", async () => {
    const t = await makeTenant();
    const [f] = await ownerSql<{ id: string }[]>`insert into business_facts (tenant_id, question, answer) values (${t.id}, '¿Hacen factura A?', 'Sí, factura A.') returning id`;
    await saveExample(t.id, { text: "emiten factura a", fn: "learned", factId: f.id });
    const r = await answerTurn(t.id, input(customer("emiten factura A?"), routerFor("complex", {})));
    expect(r).toMatchObject({ path: "example", fn: "learned", text: "Sí, factura A." });
  });

  it("a learned pick is dropped when the message names a letter or number the question does not", async () => {
    const t = await makeTenant();
    await ownerSql`insert into business_facts (tenant_id, question, answer) values (${t.id}, '¿Hacen factura A?', 'Sí, factura A.')`;
    for (const text of ["hacen factura B?", "y factura 2?"]) {
      expect(await answerTurn(t.id, input(customer(text), routerFor("learned", { n: 1 }))), text).toMatchObject({ path: "complex" });
    }
    expect(await answerTurn(t.id, input(customer("emiten factura A?"), routerFor("learned", { n: 1 })))).toMatchObject({ path: "faq", text: "Sí, factura A." });
  });

  it("a learned pick is dropped when the question names a letter the message does not", async () => {
    const t = await makeTenant();
    await ownerSql`insert into business_facts (tenant_id, question, answer) values (${t.id}, '¿Hacen factura B?', 'Sí, factura B.')`;
    for (const text of ["hacen factura A?", "hacen factura?"]) {
      expect(await answerTurn(t.id, input(customer(text), routerFor("learned", { n: 1 }))), text).toMatchObject({ path: "complex" });
    }
  });

  it("introduces itself on a template answer", async () => {
    const t = await makeTenant();
    await saveBusinessProfile(t.id, { hours: "de 8 a 20" });
    const r = await answerTurn(t.id, input(customer("a que hora abren?"), null, { introduce: true, pick: () => 0 }));
    expect(typeof r !== "string" && r.text).toBe(`${fill("intro", { tenant: "Panadería" }, () => 0)}\n${fill("hours", { hours: "de 8 a 20" }, () => 0)}`);
  });

  it("introducing itself on an unclear message sends only the introduction", async () => {
    const t = await makeTenant();
    const r = await answerTurn(t.id, input(customer("eso"), routerFor("unclear", {}), { introduce: true, pick: () => 0 }));
    expect(r).toMatchObject({ path: "faq", fn: "unclear", text: fill("intro", { tenant: "Panadería" }, () => 0) });
  });

  it("a greeting skips the router: introduction on first contact, a short hello later", async () => {
    const t = await makeTenant();
    const first = await answerTurn(t.id, input(customer("hola"), null, { introduce: true, pick: () => 0 }));
    expect(first).toMatchObject({ path: "prefilter", fn: "greeting", text: fill("intro", { tenant: "Panadería" }, () => 0) });
    const later = await answerTurn(t.id, input(customer("hola"), null, { introduce: false, pick: () => 0 }));
    expect(later).toMatchObject({ path: "prefilter", fn: "greeting", text: fill("greeting", {}, () => 0) });
  });

  it("a farewell on first contact sends only the farewell, no introduction", async () => {
    const t = await makeTenant();
    const r = await answerTurn(t.id, input(customer("chau"), null, { introduce: true, pick: () => 0 }));
    expect(r).toMatchObject({ path: "prefilter", fn: "farewell", text: fill("farewell", {}, () => 0) });
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
  it("a skipped main call keeps what the router did", async () => {
    const t = await makeTenant();
    const i = input(customer("me contas como es el tema de los pedidos grandes para eventos"), routerFor("complex", {}), {
      runComplex: vi.fn(async () => "skipped:quota" as const),
    });
    expect(await answerTurn(t.id, i)).toMatchObject({
      path: "complex",
      skip: "skipped:quota",
      routerModel: "mock-model-id",
      routerUsage: { inputTokens: 7, outputTokens: 2, cachedTokens: 0 },
    });
  });

  it("a skipped turn names no router model when the router was not called", async () => {
    const t = await makeTenant();
    const router = routerFor("hours", {});
    // A prefilter rule with no data behind it goes to the full bot without the router.
    const i = input(customer("a que hora abren?"), router, { runComplex: vi.fn(async () => "skipped:model-error" as const) });
    expect(await answerTurn(t.id, i)).toMatchObject({ path: "complex", fn: "hours", skip: "skipped:model-error", routerModel: null });
    expect(router.doGenerateCalls).toHaveLength(0);
  });

  it("a skipped router call is recorded on the faq path", async () => {
    const t = await makeTenant();
    const { APICallError } = await import("ai");
    const router = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new APICallError({ message: "quota", url: "https://x", requestBodyValues: {}, statusCode: 429, responseBody: "PerDay" });
      },
    });
    const i = input(customer("me contas como es el tema de los pedidos grandes para eventos"), router);
    expect(await answerTurn(t.id, i)).toMatchObject({ path: "faq", skip: "skipped:quota", routerModel: "mock-model-id", text: null });
    expect(i.runComplex).not.toHaveBeenCalled();
  });
});
