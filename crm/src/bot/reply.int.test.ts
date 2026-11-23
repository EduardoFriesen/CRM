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
const toolCall = (toolName: string, input: object) => ({
  content: [{ type: "tool-call" as const, toolCallId: `c-${toolName}`, toolName, input: JSON.stringify(input) }],
  finishReason: { unified: "tool-calls" as const, raw: undefined },
  usage,
  warnings: [],
});
const ADMIN_JID = "5491100000000@s.whatsapp.net";
// What a tool returned to the model on the follow-up step.
const toolOutput = (model: MockLanguageModelV4) =>
  JSON.stringify(model.doGenerateCalls[1]?.prompt.filter((m) => m.role === "tool") ?? []);
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
        throw new APICallError({ message: "overloaded", url: "https://x", requestBodyValues: {}, statusCode: 529, isRetryable: true });
      },
    });
    await expect(runConversation(t.id, c.id, { model, send: sendOk() })).rejects.toThrow();
    expect((await getAgentView(t.id))?.lastErrorCode).toBe("HTTP_529");
  });

  it("still answers a message the customer sent while the previous reply was being generated", async () => {
    const { t, c } = await setup();
    await say(t.id, c.id, "customer", "Hola", 1);
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        await say(t.id, c.id, "customer", "Ah, y ¿hacen envíos?");
        return text("¡Hola!");
      },
    });
    expect(await runConversation(t.id, c.id, { model, send: sendOk() })).toBe("sent");
    expect(
      await runConversation(t.id, c.id, { model: new MockLanguageModelV4({ doGenerate: text("Sí, hacemos envíos") }), send: sendOk() }),
    ).toBe("sent");
  });

  it("does not send if the admin answered while the reply was being generated", async () => {
    const { t, c } = await setup();
    await say(t.id, c.id, "customer", "Hola", 1);
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        await say(t.id, c.id, "admin", "Hola Ana, te atiendo yo");
        return text("¡Hola!");
      },
    });
    const send = sendOk();
    expect(await runConversation(t.id, c.id, { model, send })).toBe("skipped:not-customer-last");
    expect(send).not.toHaveBeenCalled();
  });

  it("starts the model history with a customer turn even when the window opens with the bot", async () => {
    const { t, c } = await setup();
    for (let i = 0; i < 12; i++) {
      await say(t.id, c.id, "customer", `pregunta ${i}`, 60 + 24 - 2 * i);
      await say(t.id, c.id, "bot", `respuesta ${i}`, 60 + 23 - 2 * i);
    }
    await say(t.id, c.id, "customer", "última", 0);
    const model = new MockLanguageModelV4({ doGenerate: text("ok") });
    await runConversation(t.id, c.id, { model, send: sendOk() });
    const roles = model.doGenerateCalls[0].prompt.map((m) => m.role).filter((r) => r !== "system");
    expect(roles[0]).toBe("user");
  });

  it("stops on an exhausted daily quota instead of retrying", async () => {
    const { t, c } = await setup();
    await say(t.id, c.id, "customer", "Hola");
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new APICallError({
          message: "You exceeded your current quota",
          url: "https://x",
          requestBodyValues: {},
          statusCode: 429,
          responseBody: '{"error":{"details":[{"violations":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]}]}}',
        });
      },
    });
    const send = sendOk();
    expect(await runConversation(t.id, c.id, { model, send })).toBe("skipped:quota");
    expect(send).not.toHaveBeenCalled();
    expect(model.doGenerateCalls).toHaveLength(1);
    expect((await getAgentView(t.id))?.lastErrorCode).toBe("QUOTA_EXCEEDED");
  });

  it("does not retry permanent model errors and records them", async () => {
    const { t, c } = await setup();
    await say(t.id, c.id, "customer", "Hola");
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new APICallError({ message: "model not found", url: "https://x", requestBodyValues: {}, statusCode: 404, isRetryable: false });
      },
    });
    const send = sendOk();
    expect(await runConversation(t.id, c.id, { model, send })).toBe("skipped:model-error");
    expect(send).not.toHaveBeenCalled();
    expect((await getAgentView(t.id))?.lastErrorCode).toBe("HTTP_404");
  });

  it("cannot move a customer to postventa without a delivered order", async () => {
    const { t, c } = await setup();
    await say(t.id, c.id, "customer", "Ya me llegó todo, gracias");
    const model = new MockLanguageModelV4({ doGenerate: [stageCall("postventa"), text("¡Qué bueno!")] });
    await runConversation(t.id, c.id, { model, send: sendOk() });
    const [row] = await ownerSql<{ stage: string }[]>`select stage from contacts where id = ${c.id}`;
    expect(row.stage).toBe("consulta");
  });

  describe("2b: admin questions, handoff and pause", () => {
    it("asks the admin, records the escalation, schedules a reminder and answers the customer", async () => {
      const { t, c } = await setup();
      await say(t.id, c.id, "customer", "¿Hacen envíos a Pilar?");
      const model = new MockLanguageModelV4({
        doGenerate: [toolCall("ask_admin", { question: "¿Hacen envíos a Pilar?", is_price: false, general: true }), text("Lo consulto y te aviso.")],
      });
      const send = vi.fn(async (_i: string, jid: string) => ({ id: jid === ADMIN_JID ? "ADM-1" : "CUS-1" }));
      const scheduleReminder = vi.fn(async () => {});
      expect(await runConversation(t.id, c.id, { model, send, scheduleReminder })).toBe("sent");
      expect(send).toHaveBeenCalledWith(t.slug, ADMIN_JID, "Consulta de Ana (+5491122334455): ¿Hacen envíos a Pilar? Respondé citando este mensaje.");
      expect(send).toHaveBeenCalledWith(t.slug, c.jid, "Lo consulto y te aviso.");
      const [esc] = await ownerSql<{ id: string; status: string; admin_message_id: string; is_price: boolean; is_general: boolean }[]>`
        select id, status, admin_message_id, is_price, is_general from escalations where contact_id = ${c.id}`;
      expect(esc).toMatchObject({ status: "pending", admin_message_id: "ADM-1", is_price: false, is_general: true });
      expect(scheduleReminder).toHaveBeenCalledWith(esc.id);
    });

    it("stops asking after 3 pending questions for the same contact", async () => {
      const { t, c } = await setup();
      for (let i = 0; i < 3; i++) {
        await ownerSql`insert into escalations (tenant_id, contact_id, question, is_price, admin_message_id)
          values (${t.id}, ${c.id}, ${"q" + i}, false, ${"pend-" + i + Math.random()})`;
      }
      await say(t.id, c.id, "customer", "¿Y los domingos?");
      const model = new MockLanguageModelV4({
        doGenerate: [toolCall("ask_admin", { question: "¿Abren los domingos?", is_price: false, general: true }), text("No tengo ese dato.")],
      });
      const send = vi.fn(async (...[, jid]: [string, string]) => ({ id: `X-${jid}-${Math.random()}` }));
      await runConversation(t.id, c.id, { model, send, scheduleReminder: async () => {} });
      expect(send.mock.calls.some(([, jid]) => jid === ADMIN_JID)).toBe(false);
      expect(toolOutput(model)).toContain('"ok":false');
      expect(toolOutput(model)).toContain("no tengo ese dato");
    });

    it("does not count questions older than 48 h against the limit", async () => {
      const { t, c } = await setup();
      for (let i = 0; i < 3; i++) {
        await ownerSql`insert into escalations (tenant_id, contact_id, question, is_price, admin_message_id, created_at)
          values (${t.id}, ${c.id}, ${"vieja" + i}, false, ${"old-" + i + Math.random()}, now() - interval '3 days')`;
      }
      await say(t.id, c.id, "customer", "¿Abren los domingos?");
      const model = new MockLanguageModelV4({
        doGenerate: [toolCall("ask_admin", { question: "¿Abren los domingos?", is_price: false, general: true }), text("Lo consulto.")],
      });
      const send = vi.fn(async (...[, jid]: [string, string]) => ({ id: `${jid}-${Math.random()}` }));
      await runConversation(t.id, c.id, { model, send, scheduleReminder: async () => {} });
      expect(send.mock.calls.some(([, jid]) => jid === ADMIN_JID)).toBe(true);
    });

    it("does not record an escalation when the admin cannot be reached", async () => {
      const { t, c } = await setup();
      await say(t.id, c.id, "customer", "¿Envíos?");
      const model = new MockLanguageModelV4({
        doGenerate: [toolCall("ask_admin", { question: "¿Envíos?", is_price: false, general: true }), text("No tengo ese dato.")],
      });
      const send = vi.fn(async (_i: string, jid: string) => {
        if (jid === ADMIN_JID) throw new Error("evolution down");
        return { id: "CUS" };
      });
      await runConversation(t.id, c.id, { model, send, scheduleReminder: async () => {} });
      expect(await ownerSql`select 1 from escalations where contact_id = ${c.id}`).toHaveLength(0);
      expect(toolOutput(model)).toContain('"ok":false');
    });

    it("hands off: pauses the chat, moves it to venta and tells the admin", async () => {
      const { t, c } = await setup();
      await say(t.id, c.id, "customer", "Dale, lo quiero. ¿Cómo pago?");
      const model = new MockLanguageModelV4({
        doGenerate: [toolCall("handoff_to_admin", { reason: "Quiere 3 docenas para el sábado" }), text("Te atiende alguien del equipo.")],
      });
      const send = vi.fn(async (_i: string, jid: string) => ({ id: `${jid}-${Math.random()}` }));
      await runConversation(t.id, c.id, { model, send, scheduleReminder: async () => {} });
      const [row] = await ownerSql<{ stage: string; bot_paused_until: Date }[]>`select stage, bot_paused_until from contacts where id = ${c.id}`;
      expect(row.stage).toBe("venta");
      expect(Math.abs(row.bot_paused_until.getTime() - (Date.now() + 12 * 3600_000))).toBeLessThan(60_000);
      expect(send).toHaveBeenCalledWith(
        t.slug,
        ADMIN_JID,
        "Traspaso: Ana (+5491122334455) quiere cerrar una compra. Quiere 3 docenas para el sábado. Atendelo desde el WhatsApp del negocio.",
      );
    });

    it("stays quiet while the conversation is paused, and answers new messages once the pause is over", async () => {
      const { t, c } = await setup();
      await ownerSql`update contacts set bot_paused_until = now() + interval '1 hour' where id = ${c.id}`;
      await say(t.id, c.id, "customer", "Hola");
      const send = sendOk();
      expect(await runConversation(t.id, c.id, { model: new MockLanguageModelV4({ doGenerate: text("x") }), send })).toBe("skipped:paused");
      expect(send).not.toHaveBeenCalled();
      await ownerSql`update contacts set bot_paused_until = now() - interval '1 minute' where id = ${c.id}`;
      await say(t.id, c.id, "customer", "¿Siguen ahí?");
      expect(await runConversation(t.id, c.id, { model: new MockLanguageModelV4({ doGenerate: text("Sí") }), send })).toBe("sent");
    });

    it("gives the model what the team already answered", async () => {
      const { t, c } = await setup();
      await ownerSql`insert into business_facts (tenant_id, question, answer) values (${t.id}, '¿Envían a Pilar?', 'Sí, los martes')`;
      await say(t.id, c.id, "customer", "¿Envían a Pilar?");
      const model = new MockLanguageModelV4({ doGenerate: text("Sí, los martes") });
      await runConversation(t.id, c.id, { model, send: sendOk() });
      expect(JSON.stringify(model.doGenerateCalls[0].prompt)).toContain("Sí, los martes");
    });
  });
});
