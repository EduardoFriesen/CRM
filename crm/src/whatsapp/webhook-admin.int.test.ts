import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { saveAgentConfig } from "@/agent/config";
import { notifyAdmin } from "@/bot/admin-messages";
import { enqueueCheckAdmin, enqueueRelay, enqueueReply } from "@/bot/queue";
import { dropTenants, makeContact, makeInstance, makeTenant, ownerSql } from "@/test/db";
import { hashSecret } from "@/whatsapp/secret";
import { handleEvolutionEvent } from "@/whatsapp/webhook";

vi.mock("@/bot/queue", () => ({
  enqueueReply: vi.fn(async () => {}),
  enqueueRelay: vi.fn(async () => {}),
  enqueueCheckAdmin: vi.fn(async () => {}),
}));
vi.mock("@/bot/admin-messages", async (orig) => ({
  ...(await orig<typeof import("@/bot/admin-messages")>()),
  notifyAdmin: vi.fn(async () => ({ id: `N-${Math.random()}` })),
}));
const reply = vi.mocked(enqueueReply);
const relay = vi.mocked(enqueueRelay);
const checkAdmin = vi.mocked(enqueueCheckAdmin);
const notify = vi.mocked(notifyAdmin);

const SECRET = "s3cret";
const ADMIN = "5491100000000";
let t: { id: string; slug: string };

beforeAll(async () => {
  t = await makeTenant();
  await makeInstance(t.id, t.slug, hashSecret(SECRET));
  await saveAgentConfig(t.id, { agentName: "Sofi", provider: "anthropic", model: "m", apiKey: "sk-1234", enabled: "on" }, async () => "valid");
});
afterAll(async () => {
  await dropTenants();
  await ownerSql.end();
});
beforeEach(() => {
  reply.mockClear();
  relay.mockClear();
  checkAdmin.mockClear();
  notify.mockClear();
});

let seq = 0;
const event = (o: { jid: string; alt?: string; fromMe?: boolean; text: string; quoted?: string; id?: string }) => ({
  event: "messages.upsert",
  data: {
    key: { id: o.id ?? `W${++seq}-${Math.random()}`, remoteJid: o.jid, fromMe: o.fromMe ?? false, ...(o.alt ? { remoteJidAlt: o.alt } : {}) },
    pushName: "Admin",
    message: { conversation: o.text },
    messageType: "conversation",
    messageTimestamp: Math.floor(Date.now() / 1000),
    ...(o.quoted ? { contextInfo: { stanzaId: o.quoted } } : {}),
  },
});
const post = (body: unknown) => handleEvolutionEvent(t.slug, SECRET, body);
const pending = async (contactId: string, isPrice = false, general = true) => {
  const adminId = `ADM-${Math.random()}`;
  const [e] = await ownerSql<{ id: string }[]>`
    insert into escalations (tenant_id, contact_id, question, is_price, is_general, admin_message_id)
    values (${t.id}, ${contactId}, '¿Hacen envíos a Pilar?', ${isPrice}, ${general}, ${adminId}) returning id`;
  return { id: e.id, adminId };
};
const status = async (id: string) =>
  (await ownerSql<{ status: string; answer: string | null }[]>`select status, answer from escalations where id = ${id}`)[0];
const factsFor = (escalationId: string) => ownerSql`select 1 from business_facts where escalation_id = ${escalationId}`;

describe("admin channel", () => {
  it("never turns the admin into a customer; reminds to quote at most every 10 minutes", async () => {
    const ana = await makeContact(t.id, { name: "Ana", phone: "5491122334455" });
    await pending(ana.id);
    const before = (await ownerSql`select count(*)::int as n from messages where tenant_id = ${t.id}`)[0].n;
    expect(await post(event({ jid: `${ADMIN}@s.whatsapp.net`, text: "Sí, los martes" }))).toEqual({ status: 200 });
    await post(event({ jid: `${ADMIN}@s.whatsapp.net`, text: "¿me leés?" }));
    expect(await ownerSql`select 1 from contacts where tenant_id = ${t.id} and phone = ${ADMIN}`).toHaveLength(0);
    expect((await ownerSql`select count(*)::int as n from messages where tenant_id = ${t.id}`)[0].n).toBe(before);
    expect(notify).toHaveBeenCalledExactlyOnceWith(t.id, "Para responder una consulta, citá el mensaje de la consulta.");
    expect(reply).not.toHaveBeenCalled();
  });

  it("answers the quoted question, learns it and relays it", async () => {
    const ana = await makeContact(t.id, { name: "Ana", phone: "5491122334456" });
    const q = await pending(ana.id);
    await post(event({ jid: `${ADMIN}@s.whatsapp.net`, text: "Sí, los martes", quoted: q.adminId }));
    expect(await status(q.id)).toEqual({ status: "answered", answer: "Sí, los martes" });
    expect(await factsFor(q.id)).toHaveLength(1);
    expect(relay).toHaveBeenCalledExactlyOnceWith(t.id, q.id);
    expect(notify).toHaveBeenCalledWith(t.id, "Listo, le respondí a Ana.");
  });

  it("relays but never learns an answer that mentions money", async () => {
    const ana = await makeContact(t.id, { name: "Ana", phone: "5491122334457" });
    const q = await pending(ana.id, false);
    await post(event({ jid: `${ADMIN}@s.whatsapp.net`, text: "Sale $3.500", quoted: q.adminId }));
    expect((await status(q.id)).status).toBe("answered");
    expect(await factsFor(q.id)).toHaveLength(0);
    expect(relay).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith(t.id, "Listo, le respondí a Ana. (no la guardé porque es de precios)");
  });

  it("never learns answers to price questions", async () => {
    const ana = await makeContact(t.id, { name: "Ana", phone: "5491122334458" });
    const q = await pending(ana.id, true);
    await post(event({ jid: `${ADMIN}@s.whatsapp.net`, text: "Sí", quoted: q.adminId }));
    expect(await factsFor(q.id)).toHaveLength(0);
  });

  it("relays but never learns an answer that only applies to this customer", async () => {
    const ana = await makeContact(t.id, { name: "Ana", phone: "5491122334470" });
    const q = await pending(ana.id, false, false);
    await post(event({ jid: `${ADMIN}@s.whatsapp.net`, text: "Sí, ya está listo, pasá a retirarlo", quoted: q.adminId }));
    expect((await status(q.id)).status).toBe("answered");
    expect(await factsFor(q.id)).toHaveLength(0);
    expect(relay).toHaveBeenCalledOnce();
  });

  it("accepts an answer that quotes the reminder", async () => {
    const ana = await makeContact(t.id, { name: "Ana", phone: "5491122334471" });
    const q = await pending(ana.id);
    await ownerSql`update escalations set reminder_message_id = 'REM-1', reminded_at = now() where id = ${q.id}`;
    await post(event({ jid: `${ADMIN}@s.whatsapp.net`, text: "Sí, los martes", quoted: "REM-1" }));
    expect((await status(q.id)).status).toBe("answered");
  });

  it("tells the admin when a quoted message matches no pending question", async () => {
    await ownerSql`update agent_configs set admin_hint_at = null where tenant_id = ${t.id}`;
    await post(event({ jid: `${ADMIN}@s.whatsapp.net`, text: "Sí", quoted: "NOPE-1" }));
    expect(notify).toHaveBeenCalledWith(t.id, "Esa consulta ya fue respondida o no la encuentro.");
  });

  it("works when the admin uses the business number itself (answers arrive as fromMe)", async () => {
    const ana = await makeContact(t.id, { name: "Ana", phone: "5491122334472" });
    const q = await pending(ana.id);
    await post(event({ jid: `${ADMIN}@s.whatsapp.net`, fromMe: true, text: "Sí, los martes", quoted: q.adminId }));
    expect((await status(q.id)).status).toBe("answered");
  });

  it("ignores a second answer to the same question", async () => {
    const ana = await makeContact(t.id, { name: "Ana", phone: "5491122334459" });
    const q = await pending(ana.id);
    await post(event({ jid: `${ADMIN}@s.whatsapp.net`, text: "Sí", quoted: q.adminId }));
    relay.mockClear();
    await post(event({ jid: `${ADMIN}@s.whatsapp.net`, text: "Ah no, mejor no", quoted: q.adminId }));
    expect(relay).not.toHaveBeenCalled();
    expect((await status(q.id)).answer).toBe("Sí");
  });

  it("recognizes the admin behind a LID with a phone alternative", async () => {
    const ana = await makeContact(t.id, { name: "Ana", phone: "5491122334460" });
    const q = await pending(ana.id);
    await post(event({ jid: "998877@lid", alt: `${ADMIN}@s.whatsapp.net`, text: "Sí", quoted: q.adminId }));
    expect((await status(q.id)).status).toBe("answered");
    expect(await ownerSql`select 1 from contacts where tenant_id = ${t.id} and jid = '998877@lid'`).toHaveLength(0);
  });
});

describe("pause from the business number", () => {
  it("schedules an admin-typing check for messages sent from the business number", async () => {
    const jid = "5491122300001@s.whatsapp.net";
    await post(event({ jid, fromMe: true, text: "Hola, te atiendo yo", id: "BIZ-1" }));
    const [c] = await ownerSql<{ id: string }[]>`select id from contacts where tenant_id = ${t.id} and jid = ${jid}`;
    expect(checkAdmin).toHaveBeenCalledExactlyOnceWith(t.id, c.id, "BIZ-1");
  });

  it("does not wake the bot for a paused customer", async () => {
    const c = await makeContact(t.id, { name: "Bruno", jid: "5491122300002@s.whatsapp.net" });
    await ownerSql`update contacts set bot_paused_until = now() + interval '1 hour' where id = ${c.id}`;
    await post(event({ jid: c.jid, text: "¿Hola?" }));
    expect(reply).not.toHaveBeenCalled();
  });
});
