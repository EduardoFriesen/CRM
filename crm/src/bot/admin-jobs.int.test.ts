import { MockLanguageModelV4 } from "ai/test";
import { afterAll, describe, expect, it, vi } from "vitest";
import { saveAgentConfig } from "@/agent/config";
import { checkAdminPause, sendReminder } from "@/bot/admin-jobs";
import { runRelay } from "@/bot/reply";
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
const ADMIN_JID = "5491100000000@s.whatsapp.net";

async function setup() {
  const t = await makeTenant();
  await makeInstance(t.id, t.slug, "h");
  await saveAgentConfig(t.id, { agentName: "Sofi", provider: "anthropic", model: "m", apiKey: "sk-1234", enabled: "on" }, async () => "valid");
  const c = await makeContact(t.id, { name: "Ana", phone: "5491122334455", jid: `549${Date.now() % 1e10}@s.whatsapp.net` });
  return { t, c };
}
const escalation = async (
  tenantId: string,
  contactId: string,
  fields: { status?: string; answer?: string | null; isPrice?: boolean } = {},
) => {
  const [e] = await ownerSql<{ id: string }[]>`
    insert into escalations (tenant_id, contact_id, question, is_price, admin_message_id, status, answer)
    values (${tenantId}, ${contactId}, '¿Hacen envíos a Pilar?', ${fields.isPrice ?? false}, ${"adm-" + Math.random()}, ${fields.status ?? "pending"}, ${fields.answer ?? null})
    returning id`;
  return e.id;
};
const message = (tenantId: string, contactId: string, author: string, waId: string) =>
  ownerSql`insert into messages (tenant_id, contact_id, direction, author, body, wa_message_id, sent_at)
    values (${tenantId}, ${contactId}, 'out', ${author}, 'x', ${waId}, now())`;

describe("checkAdminPause", () => {
  it("ignores a message the bot already claimed", async () => {
    const { t, c } = await setup();
    await message(t.id, c.id, "bot", "W-BOT");
    expect(await checkAdminPause(t.id, c.id, "W-BOT")).toBe("bot-message");
    const [row] = await ownerSql<{ bot_paused_until: Date | null }[]>`select bot_paused_until from contacts where id = ${c.id}`;
    expect(row.bot_paused_until).toBeNull();
  });

  it("pauses the chat when the admin really wrote from the business number", async () => {
    const { t, c } = await setup();
    await message(t.id, c.id, "admin", "W-ADM");
    expect(await checkAdminPause(t.id, c.id, "W-ADM")).toBe("paused");
    const [row] = await ownerSql<{ bot_paused_until: Date }[]>`select bot_paused_until from contacts where id = ${c.id}`;
    expect(Math.abs(row.bot_paused_until.getTime() - (Date.now() + 12 * 3600_000))).toBeLessThan(60_000);
  });
});

describe("sendReminder", () => {
  it("reminds the admin once while the question is pending", async () => {
    const { t, c } = await setup();
    const id = await escalation(t.id, c.id);
    const send = vi.fn(async () => ({ id: "R1" }));
    expect(await sendReminder(t.id, id, { send })).toBe("sent");
    expect(send).toHaveBeenCalledWith(
      t.slug,
      ADMIN_JID,
      "Recordatorio: Consulta de Ana (+5491122334455): ¿Hacen envíos a Pilar? Respondé citando este mensaje.",
    );
    expect(await sendReminder(t.id, id, { send })).toBe("skipped");
    expect(send).toHaveBeenCalledTimes(1);
    const [row] = await ownerSql<{ reminder_message_id: string }[]>`select reminder_message_id from escalations where id = ${id}`;
    expect(row.reminder_message_id).toBe("R1");
  });

  it("does not remind about answered questions", async () => {
    const { t, c } = await setup();
    const id = await escalation(t.id, c.id, { status: "answered", answer: "Sí" });
    expect(await sendReminder(t.id, id, { send: vi.fn() })).toBe("skipped");
  });
});

describe("runRelay", () => {
  it("tells the customer what the team answered and stores it as the bot", async () => {
    const { t, c } = await setup();
    const id = await escalation(t.id, c.id, { status: "answered", answer: "Sí, los martes" });
    const model = new MockLanguageModelV4({ doGenerate: text("¡Te confirmo que sí, los martes!") });
    const send = vi.fn(async (...[, jid]: [string, string]) => ({ id: jid === ADMIN_JID ? `ADM-${Math.random()}` : "RELAY-1" }));
    expect(await runRelay(t.id, id, { model, send })).toBe("sent");
    expect(send).toHaveBeenCalledWith(t.slug, c.jid, "¡Te confirmo que sí, los martes!");
    expect(send).toHaveBeenCalledWith(t.slug, ADMIN_JID, "Listo, le respondí a Ana.");
    expect(JSON.stringify(model.doGenerateCalls[0].prompt)).toContain("Sí, los martes");
    const [row] = await ownerSql<{ author: string }[]>`select author from messages where wa_message_id = 'RELAY-1'`;
    expect(row.author).toBe("bot");
    const events = await ownerSql`select path, outcome, model from bot_events where tenant_id = ${t.id}`;
    expect(events).toEqual([{ path: "relay", outcome: "sent", model: "m" }]);
  });

  it("relays without tool calls in the history, even after a handoff", async () => {
    const { t, c } = await setup();
    await ownerSql`insert into messages (tenant_id, contact_id, direction, author, body, wa_message_id, sent_at, handoff) values
      (${t.id}, ${c.id}, 'in', 'customer', 'Quiero 2', ${"h-c-" + Math.random()}, now() - interval '5 minutes', false),
      (${t.id}, ${c.id}, 'out', 'bot', 'Te atiende alguien del equipo.', ${"h-b-" + Math.random()}, now() - interval '4 minutes', true)`;
    const id = await escalation(t.id, c.id, { status: "answered", answer: "Sí, los martes" });
    const model = new MockLanguageModelV4({ doGenerate: text("Sí, los martes") });
    await runRelay(t.id, id, { model, send: vi.fn(async () => ({ id: `R-${Math.random()}` })) });
    expect(JSON.stringify(model.doGenerateCalls[0].prompt)).not.toContain("tool-call");
  });

  it("does not relay while the admin is handling the chat", async () => {
    const { t, c } = await setup();
    await ownerSql`update contacts set bot_paused_until = now() + interval '1 hour' where id = ${c.id}`;
    const id = await escalation(t.id, c.id, { status: "answered", answer: "Sí" });
    const send = vi.fn(async () => ({ id: `N-${Math.random()}` }));
    expect(await runRelay(t.id, id, { model: new MockLanguageModelV4({ doGenerate: text("x") }), send })).toBe("skipped:paused");
    expect(send).not.toHaveBeenCalledWith(t.slug, c.jid, expect.anything());
    expect(send).toHaveBeenCalledWith(
      t.slug,
      ADMIN_JID,
      "No le pude mandar la respuesta a Ana: el bot está pausado o apagado en esa charla. Respondele vos desde el WhatsApp del negocio.",
    );
  });

  it("does nothing for a question that has no answer yet", async () => {
    const { t, c } = await setup();
    const id = await escalation(t.id, c.id);
    expect(await runRelay(t.id, id, { model: new MockLanguageModelV4({ doGenerate: text("x") }), send: vi.fn() })).toBe(
      "skipped:not-answered",
    );
  });

  it("says in the confirmation when a price answer was not learned", async () => {
    const { t, c } = await setup();
    const id = await escalation(t.id, c.id, { status: "answered", answer: "Sale $3.500", isPrice: false });
    const send = vi.fn(async (...[, jid]: [string, string]) => ({ id: `${jid}-${Math.random()}` }));
    await runRelay(t.id, id, { model: new MockLanguageModelV4({ doGenerate: text("Sale $3.500") }), send });
    expect(send).toHaveBeenCalledWith(t.slug, ADMIN_JID, "Listo, le respondí a Ana. (no la guardé porque es de precios)");
  });

  it("does not talk over the admin who wrote while the relay was being generated", async () => {
    const { t, c } = await setup();
    const id = await escalation(t.id, c.id, { status: "answered", answer: "Sí" });
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        await ownerSql`insert into messages (tenant_id, contact_id, direction, author, body, wa_message_id, sent_at)
          values (${t.id}, ${c.id}, 'out', 'admin', 'Te escribo yo', ${"A-" + Math.random()}, now())`;
        return text("Sí");
      },
    });
    const send = vi.fn(async () => ({ id: `N-${Math.random()}` }));
    expect(await runRelay(t.id, id, { model, send })).toBe("skipped:not-customer-last");
    expect(send).not.toHaveBeenCalledWith(t.slug, c.jid, expect.anything());
  });

  it("leaves a customer message sent during the relay as the last one, so it gets answered", async () => {
    const { t, c } = await setup();
    await ownerSql`insert into messages (tenant_id, contact_id, direction, author, body, wa_message_id, sent_at)
      values (${t.id}, ${c.id}, 'in', 'customer', '¿Envían a Pilar?', ${"C-" + Math.random()}, now() - interval '1 minute')`;
    const id = await escalation(t.id, c.id, { status: "answered", answer: "Sí" });
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        await ownerSql`insert into messages (tenant_id, contact_id, direction, author, body, wa_message_id, sent_at)
          values (${t.id}, ${c.id}, 'in', 'customer', 'Y otra cosa', ${"C-" + Math.random()}, now())`;
        return text("Sí, a Pilar enviamos");
      },
    });
    await runRelay(t.id, id, { model, send: vi.fn(async () => ({ id: `R-${Math.random()}` })) });
    const [last] = await ownerSql<{ author: string }[]>`select author from messages where contact_id = ${c.id} order by sent_at desc limit 1`;
    expect(last.author).toBe("customer");
  });
});
