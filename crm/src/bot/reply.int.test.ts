import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, describe, expect, it, vi } from "vitest";
import { getAgentView, saveAgentConfig } from "@/agent/config";
import { runConversation } from "@/bot/reply";
import { dropTenants, makeContact, makeInstance, makeTenant, ownerSql } from "@/test/db";

afterAll(async () => {
  await dropTenants();
  await ownerSql.end();
});

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }], finishReason: { unified: "stop" as const, raw: undefined }, usage, warnings: [] });
const stageCall = (stage: string) => ({
  content: [{ type: "tool-call" as const, toolCallId: "c1", toolName: "set_stage", input: JSON.stringify({ stage }) }],
  finishReason: { unified: "tool-calls" as const, raw: undefined },
  usage,
  warnings: [],
});

async function setup(opts: { enabled?: boolean; discloseAi?: boolean } = {}) {
  const t = await makeTenant();
  await makeInstance(t.id, t.slug, "h");
  await saveAgentConfig(
    t.id,
    {
      agentName: "Sofi",
      provider: "anthropic",
      model: "m",
      apiKey: "sk-test-1234",
      enabled: opts.enabled === false ? undefined : "on",
      discloseAi: opts.discloseAi === false ? undefined : "on",
    },
    async () => "valid",
  );
  const c = await makeContact(t.id, { name: "Ana", phone: "5491122334455", jid: `549${Date.now() % 1e10}@s.whatsapp.net` });
  return { t, c };
}

let seq = 0;
const say = (tenantId: string, contactId: string, author: "customer" | "bot" | "admin", body: string, minutesAgo = 0) =>
  ownerSql`insert into messages (tenant_id, contact_id, direction, author, body, wa_message_id, sent_at)
    values (${tenantId}, ${contactId}, ${author === "customer" ? "in" : "out"}, ${author}, ${body}, ${"seed-" + ++seq + "-" + Math.random()}, now() - make_interval(mins => ${minutesAgo}))`;

const sendOk = () => vi.fn(async () => ({ id: `BOT-${Math.random()}` }));

describe("runConversation", () => {
  it("answers, stores the reply as the bot and applies the stage the model picked", async () => {
    const { t, c } = await setup();
    await say(t.id, c.id, "customer", "Quiero 2 docenas de medialunas");
    const model = new MockLanguageModelV4({ doGenerate: [stageCall("venta"), text("¡Dale! Te las preparo.")] });
    const send = vi.fn(async () => ({ id: "BOT1" }));
    expect(await runConversation(t.id, c.id, { model, send })).toBe("sent");
    expect(send).toHaveBeenCalledWith(t.slug, c.jid, "¡Dale! Te las preparo.");
    const [row] = await ownerSql<{ author: string; direction: string }[]>`select author, direction from messages where wa_message_id = 'BOT1'`;
    expect(row).toEqual({ author: "bot", direction: "out" });
    const [contact] = await ownerSql<{ stage: string }[]>`select stage from contacts where id = ${c.id}`;
    expect(contact.stage).toBe("venta");
  });

  it("claims its own message when the webhook echo stored it first as admin", async () => {
    const { t, c } = await setup();
    await say(t.id, c.id, "customer", "Hola");
    const send = vi.fn(async () => {
      await ownerSql`insert into messages (tenant_id, contact_id, direction, author, body, wa_message_id, sent_at)
        values (${t.id}, ${c.id}, 'out', 'admin', 'Hola!', 'ECHO1', now())`;
      return { id: "ECHO1" };
    });
    await runConversation(t.id, c.id, { model: new MockLanguageModelV4({ doGenerate: text("Hola!") }), send });
    const rows = await ownerSql<{ author: string }[]>`select author from messages where wa_message_id = 'ECHO1'`;
    expect(rows).toEqual([{ author: "bot" }]);
  });

  it("stays quiet when the last message is not from the customer", async () => {
    const { t, c } = await setup();
    await say(t.id, c.id, "customer", "Hola", 2);
    await say(t.id, c.id, "admin", "Hola Ana, te atiendo yo", 1);
    const send = sendOk();
    expect(await runConversation(t.id, c.id, { model: new MockLanguageModelV4({ doGenerate: text("x") }), send })).toBe(
      "skipped:not-customer-last",
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("stops after 20 bot replies to the same contact in an hour", async () => {
    const { t, c } = await setup();
    for (let i = 0; i < 20; i++) await say(t.id, c.id, "bot", `r${i}`, 30);
    await say(t.id, c.id, "customer", "otra vez");
    const send = sendOk();
    expect(await runConversation(t.id, c.id, { model: new MockLanguageModelV4({ doGenerate: text("x") }), send })).toBe(
      "skipped:rate-limit",
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("marks the key invalid on 401, sends nothing and stops answering", async () => {
    const { t, c } = await setup();
    await say(t.id, c.id, "customer", "Hola");
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new APICallError({ message: "unauthorized", url: "https://x", requestBodyValues: {}, statusCode: 401 });
      },
    });
    const send = sendOk();
    expect(await runConversation(t.id, c.id, { model, send })).toBe("skipped:key-invalid");
    expect(send).not.toHaveBeenCalled();
    expect((await getAgentView(t.id))?.keyStatus).toBe("invalid");
    expect(await runConversation(t.id, c.id, { model, send })).toBe("skipped:disabled");
  });

  it("does nothing while the bot is off", async () => {
    const { t, c } = await setup({ enabled: false });
    await say(t.id, c.id, "customer", "Hola");
    const send = sendOk();
    expect(await runConversation(t.id, c.id, { model: new MockLanguageModelV4({ doGenerate: text("x") }), send })).toBe(
      "skipped:disabled",
    );
  });

  it("introduces itself on a fresh conversation only", async () => {
    const { t, c } = await setup();
    await say(t.id, c.id, "customer", "Hola");
    const first = new MockLanguageModelV4({ doGenerate: text("Hola!") });
    await runConversation(t.id, c.id, { model: first, send: sendOk() });
    expect(JSON.stringify(first.doGenerateCalls[0].prompt)).toContain("asistente virtual");

    await say(t.id, c.id, "customer", "¿Tienen pan?");
    const second = new MockLanguageModelV4({ doGenerate: text("Sí") });
    await runConversation(t.id, c.id, { model: second, send: sendOk() });
    expect(JSON.stringify(second.doGenerateCalls[0].prompt)).not.toContain("asistente virtual de");
  });

  it("records the error code and rethrows transient failures so the queue retries", async () => {
    const { t, c } = await setup();
    await say(t.id, c.id, "customer", "Hola");
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new APICallError({ message: "overloaded", url: "https://x", requestBodyValues: {}, statusCode: 529, isRetryable: false });
      },
    });
    await expect(runConversation(t.id, c.id, { model, send: sendOk() })).rejects.toThrow();
    expect((await getAgentView(t.id))?.lastErrorCode).toBe("HTTP_529");
  });
});
