import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashSecret } from "@/whatsapp/secret";
import { handleEvolutionEvent } from "@/whatsapp/webhook";
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
