import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { saveAgentConfig } from "@/agent/config";
import { enqueueReply } from "@/bot/queue";
import { hashSecret } from "@/whatsapp/secret";
import { handleEvolutionEvent } from "@/whatsapp/webhook";

vi.mock("@/bot/queue", () => ({
  enqueueReply: vi.fn(async () => {}),
  enqueueRelay: vi.fn(async () => {}),
  enqueueCheckAdmin: vi.fn(async () => {}),
}));
const enqueue = vi.mocked(enqueueReply);
import { dropTenants, makeInstance, makeTenant, ownerSql } from "@/test/db";

const SECRET = "s3cret";
let tenant: { id: string; slug: string };

beforeAll(async () => {
  tenant = await makeTenant();
  await makeInstance(tenant.id, tenant.slug, hashSecret(SECRET));
});
afterAll(async () => {
  await dropTenants();
  await ownerSql.end();
});

let seq = 0;
function upsert(over: { remoteJid?: string; remoteJidAlt?: string; fromMe?: boolean; pushName?: string; text?: string; id?: string } = {}) {
  return {
    event: "messages.upsert",
    instance: tenant.slug,
    apikey: "instance-token",
    data: {
      key: {
        id: over.id ?? `MSG${++seq}`,
        remoteJid: over.remoteJid ?? "5491122334455@s.whatsapp.net",
        fromMe: over.fromMe ?? false,
        ...(over.remoteJidAlt ? { remoteJidAlt: over.remoteJidAlt } : {}),
      },
      pushName: over.pushName ?? "Ana",
      message: { conversation: over.text ?? "Hola, ¿tienen pan?" },
      messageType: "conversation",
      messageTimestamp: 1795430000,
    },
  };
}

const contactsOf = (jid: string) =>
  ownerSql<{ id: string; name: string | null; phone: string | null; stage: string; last_message_at: Date | null }[]>`
    select id, name, phone, stage, last_message_at from contacts where tenant_id = ${tenant.id} and jid = ${jid}`;
const messagesOf = (contactId: string) =>
  ownerSql<{ direction: string; body: string }[]>`select direction, body from messages where contact_id = ${contactId}`;
const authorsOf = (contactId: string) =>
  ownerSql<{ author: string }[]>`select author from messages where contact_id = ${contactId} order by sent_at, author`;

describe("handleEvolutionEvent", () => {
  it("creates a contact in consulta with its inbound message", async () => {
    const jid = "5491100000001@s.whatsapp.net";
    expect(await handleEvolutionEvent(tenant.slug, SECRET, upsert({ remoteJid: jid }))).toEqual({ status: 200 });
    const [c] = await contactsOf(jid);
    expect(c).toMatchObject({ name: "Ana", phone: "5491100000001", stage: "consulta" });
    expect(c.last_message_at).toEqual(new Date(1795430000 * 1000));
    expect(await messagesOf(c.id)).toEqual([{ direction: "in", body: "Hola, ¿tienen pan?" }]);
  });

  it("stores a redelivered message only once", async () => {
    const jid = "5491100000002@s.whatsapp.net";
    const body = upsert({ remoteJid: jid, id: "DUP1" });
    await handleEvolutionEvent(tenant.slug, SECRET, body);
    await handleEvolutionEvent(tenant.slug, SECRET, body);
    const [c] = await contactsOf(jid);
    expect(await messagesOf(c.id)).toHaveLength(1);
  });

  it("rejects a wrong or missing secret and an unknown instance with 401, writing nothing", async () => {
    const jid = "5491100000003@s.whatsapp.net";
    expect(await handleEvolutionEvent(tenant.slug, "wrong", upsert({ remoteJid: jid }))).toEqual({ status: 401 });
    expect(await handleEvolutionEvent(tenant.slug, null, upsert({ remoteJid: jid }))).toEqual({ status: 401 });
    expect(await handleEvolutionEvent("no-such-instance", SECRET, upsert({ remoteJid: jid }))).toEqual({ status: 401 });
    expect(await contactsOf(jid)).toHaveLength(0);
  });

  it("answers 400 to a malformed upsert", async () => {
    expect(await handleEvolutionEvent(tenant.slug, SECRET, { event: "messages.upsert", data: {} })).toEqual({ status: 400 });
    expect(await handleEvolutionEvent(tenant.slug, SECRET, "not json")).toEqual({ status: 400 });
  });

  it("ignores group messages", async () => {
    const jid = "120363000000@g.us";
    expect(await handleEvolutionEvent(tenant.slug, SECRET, upsert({ remoteJid: jid }))).toEqual({ status: 200 });
    expect(await contactsOf(jid)).toHaveLength(0);
  });

  it("stores a LID contact without a phone", async () => {
    const jid = "987654321@lid";
    await handleEvolutionEvent(tenant.slug, SECRET, upsert({ remoteJid: jid }));
    const [c] = await contactsOf(jid);
    expect(c.phone).toBeNull();
  });

  it("records outgoing messages without overwriting the contact's name", async () => {
    const jid = "5491100000004@s.whatsapp.net";
    await handleEvolutionEvent(tenant.slug, SECRET, upsert({ remoteJid: jid, pushName: "Ana" }));
    await handleEvolutionEvent(tenant.slug, SECRET, upsert({ remoteJid: jid, fromMe: true, pushName: "Mi Negocio", text: "¡Sí!" }));
    const [c] = await contactsOf(jid);
    expect(c.name).toBe("Ana");
    expect((await messagesOf(c.id)).map((m) => m.direction).sort()).toEqual(["in", "out"]);
    expect((await authorsOf(c.id)).map((m) => m.author).sort()).toEqual(["admin", "customer"]);
  });

  it("labels non-text messages by type", async () => {
    const jid = "5491100000005@s.whatsapp.net";
    const body = upsert({ remoteJid: jid });
    body.data.message = {} as never;
    body.data.messageType = "audioMessage";
    await handleEvolutionEvent(tenant.slug, SECRET, body);
    const [c] = await contactsOf(jid);
    expect(await messagesOf(c.id)).toEqual([{ direction: "in", body: "[audioMessage]" }]);
  });

  it("updates the instance status on connection.update", async () => {
    const body = { event: "connection.update", instance: tenant.slug, data: { instance: tenant.slug, state: "open" } };
    expect(await handleEvolutionEvent(tenant.slug, SECRET, body)).toEqual({ status: 200 });
    const [row] = await ownerSql<{ status: string }[]>`select status from whatsapp_instances where tenant_id = ${tenant.id}`;
    expect(row.status).toBe("open");
  });

  it("acknowledges other events without writing", async () => {
    expect(await handleEvolutionEvent(tenant.slug, SECRET, { event: "contacts.update", data: {} })).toEqual({ status: 200 });
  });

});

describe("webhook → bot queue", () => {
  let botTenant: { id: string; slug: string };
  const agent = (enabled: boolean) =>
    saveAgentConfig(
      botTenant.id,
      { agentName: "Sofi", provider: "anthropic", model: "m", apiKey: "sk-1234", enabled: enabled ? "on" : undefined },
      async () => "valid",
    );
  const incoming = (jid: string, fromMe = false) => {
    const body = upsert({ remoteJid: jid, fromMe });
    body.instance = botTenant.slug;
    return body;
  };

  beforeAll(async () => {
    botTenant = await makeTenant();
    await makeInstance(botTenant.id, botTenant.slug, hashSecret(SECRET));
  });
  beforeEach(() => enqueue.mockReset());

  it("queues a reply for an incoming message when the bot is on", async () => {
    await agent(true);
    await handleEvolutionEvent(botTenant.slug, SECRET, incoming("5491100000101@s.whatsapp.net"));
    const [c] = await ownerSql<{ id: string }[]>`select id from contacts where jid = '5491100000101@s.whatsapp.net'`;
    expect(enqueue).toHaveBeenCalledExactlyOnceWith(botTenant.id, c.id);
  });

  it("does not queue while the bot is off", async () => {
    await agent(false);
    await handleEvolutionEvent(botTenant.slug, SECRET, incoming("5491100000102@s.whatsapp.net"));
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("does not queue for a chat whose bot was turned off", async () => {
    await agent(true);
    const jid = "5491100000109@s.whatsapp.net";
    await ownerSql`insert into contacts (tenant_id, jid, last_message_at, bot_off) values (${botTenant.id}, ${jid}, now(), true)`;
    await handleEvolutionEvent(botTenant.slug, SECRET, incoming(jid));
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("never queues the business's own messages", async () => {
    await agent(true);
    await handleEvolutionEvent(botTenant.slug, SECRET, incoming("5491100000103@s.whatsapp.net", true));
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("keeps the message and answers 200 when the queue is down", async () => {
    await agent(true);
    enqueue.mockRejectedValueOnce(Object.assign(new Error("connect"), { code: "ECONNREFUSED" }));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await handleEvolutionEvent(botTenant.slug, SECRET, incoming("5491100000104@s.whatsapp.net"))).toEqual({ status: 200 });
    expect(log.mock.calls.flat().join(" ")).toContain("ECONNREFUSED");
    expect(await ownerSql`select 1 from contacts where tenant_id = ${botTenant.id} and jid = '5491100000104@s.whatsapp.net'`).toHaveLength(1);
    log.mockRestore();
  });
});

describe("reopening", () => {
  const state = async (jid: string) =>
    (
      await ownerSql<{ stage: string; closed_at: Date | null; reopened_at: Date | null; bot_paused_until: Date | null }[]>`
        select stage, closed_at, reopened_at, bot_paused_until from contacts where tenant_id = ${tenant.id} and jid = ${jid}`
    )[0];
  const seed = (jid: string, stage: string, extra: { closed?: boolean; idle?: string; paused?: boolean } = {}) =>
    ownerSql`insert into contacts (tenant_id, jid, stage, closed_at, last_message_at, bot_paused_until)
      values (${tenant.id}, ${jid}, ${stage}, ${extra.closed ? new Date() : null},
              now() - ${extra.idle ?? "1 minute"}::interval, ${extra.paused ? new Date(Date.now() + 3600_000) : null})`;

  it("a customer message reopens a closed contact as a new consulta", async () => {
    const jid = "5491100000101@s.whatsapp.net";
    await seed(jid, "postventa", { closed: true, paused: true });
    await ownerSql`update contacts set bot_off = true, attention_reason = 'reclamo', attention_at = now() where tenant_id = ${tenant.id} and jid = ${jid}`;
    await handleEvolutionEvent(tenant.slug, SECRET, upsert({ remoteJid: jid }));
    const [cleared] = await ownerSql`select bot_off, attention_reason, attention_at from contacts where tenant_id = ${tenant.id} and jid = ${jid}`;
    expect(cleared).toEqual({ bot_off: false, attention_reason: null, attention_at: null });
    expect(await state(jid)).toMatchObject({ stage: "consulta", closed_at: null, bot_paused_until: null });
    expect((await state(jid)).reopened_at).not.toBeNull();
    const [{ consulta_since }] = await ownerSql<{ consulta_since: Date | null }[]>`
      select consulta_since from contacts where tenant_id = ${tenant.id} and jid = ${jid}`;
    expect(consulta_since).not.toBeNull();
  });

  it("the reopening message belongs to the new conversation", async () => {
    const jid = "5491100000106@s.whatsapp.net";
    await seed(jid, "postventa", { closed: true });
    // WhatsApp timestamps have second precision, so the message is usually older than now().
    const msg = upsert({ remoteJid: jid });
    msg.data.messageTimestamp = Math.floor(Date.now() / 1000) - 1;
    await handleEvolutionEvent(tenant.slug, SECRET, msg);
    const [row] = await ownerSql<{ n: number }[]>`
      select count(*)::int as n from messages m join contacts c on c.id = m.contact_id
      where c.tenant_id = ${tenant.id} and c.jid = ${jid} and m.sent_at >= c.reopened_at`;
    expect(row.n).toBe(1);
  });

  it("a customer message reopens an idle consulta", async () => {
    const jid = "5491100000102@s.whatsapp.net";
    await seed(jid, "consulta", { idle: "2 days" });
    await handleEvolutionEvent(tenant.slug, SECRET, upsert({ remoteJid: jid }));
    expect((await state(jid)).reopened_at).not.toBeNull();
  });

  it("an active consulta is not reopened", async () => {
    const jid = "5491100000105@s.whatsapp.net";
    await seed(jid, "consulta");
    await handleEvolutionEvent(tenant.slug, SECRET, upsert({ remoteJid: jid }));
    expect((await state(jid)).reopened_at).toBeNull();
  });

  it("a message from the business number does not reopen", async () => {
    const jid = "5491100000103@s.whatsapp.net";
    await seed(jid, "postventa", { closed: true });
    await handleEvolutionEvent(tenant.slug, SECRET, upsert({ remoteJid: jid, fromMe: true }));
    expect(await state(jid)).toMatchObject({ stage: "postventa", reopened_at: null });
    expect((await state(jid)).closed_at).not.toBeNull();
  });

  it("an idle venta contact keeps its stage", async () => {
    const jid = "5491100000104@s.whatsapp.net";
    await seed(jid, "venta", { idle: "5 days" });
    await handleEvolutionEvent(tenant.slug, SECRET, upsert({ remoteJid: jid }));
    expect(await state(jid)).toMatchObject({ stage: "venta", reopened_at: null });
  });
});
