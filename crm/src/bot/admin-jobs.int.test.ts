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
const escalation = async (tenantId: string, contactId: string, fields: { status?: string; answer?: string | null } = {}) => {
  const [e] = await ownerSql<{ id: string }[]>`
    insert into escalations (tenant_id, contact_id, question, is_price, admin_message_id, status, answer)
    values (${tenantId}, ${contactId}, '¿Hacen envíos a Pilar?', false, ${"adm-" + Math.random()}, ${fields.status ?? "pending"}, ${fields.answer ?? null})
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
    const send = vi.fn(async () => ({ id: "RELAY-1" }));
    expect(await runRelay(t.id, id, { model, send })).toBe("sent");
    expect(send).toHaveBeenCalledWith(t.slug, c.jid, "¡Te confirmo que sí, los martes!");
    expect(JSON.stringify(model.doGenerateCalls[0].prompt)).toContain("Sí, los martes");
    const [row] = await ownerSql<{ author: string }[]>`select author from messages where wa_message_id = 'RELAY-1'`;
    expect(row.author).toBe("bot");
  });

  it("does not relay while the admin is handling the chat", async () => {
    const { t, c } = await setup();
    await ownerSql`update contacts set bot_paused_until = now() + interval '1 hour' where id = ${c.id}`;
    const id = await escalation(t.id, c.id, { status: "answered", answer: "Sí" });
    const send = vi.fn();
    expect(await runRelay(t.id, id, { model: new MockLanguageModelV4({ doGenerate: text("x") }), send })).toBe("skipped:paused");
    expect(send).not.toHaveBeenCalled();
  });

  it("does nothing for a question that has no answer yet", async () => {
    const { t, c } = await setup();
    const id = await escalation(t.id, c.id);
    expect(await runRelay(t.id, id, { model: new MockLanguageModelV4({ doGenerate: text("x") }), send: vi.fn() })).toBe(
      "skipped:not-answered",
    );
  });
});
