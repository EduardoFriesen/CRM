import { afterAll, describe, expect, it } from "vitest";
import { listBoard, setContactStage } from "@/contacts/contacts";
import { dropTenants, makeContact, makeTenant, ownerSql } from "@/test/db";

afterAll(async () => {
  await dropTenants();
  await ownerSql.end();
});

async function addMessage(tenantId: string, contactId: string, body: string, at: string) {
  await ownerSql`insert into messages (tenant_id, contact_id, direction, author, body, wa_message_id, sent_at)
    values (${tenantId}, ${contactId}, 'in', 'customer', ${body}, ${crypto.randomUUID()}, ${at})`;
  await ownerSql`update contacts set last_message_at = ${at} where id = ${contactId}`;
}

describe("listBoard", () => {
  it("groups by stage, newest first, with the last message cut to 80 chars", async () => {
    const t = await makeTenant();
    const old = await makeContact(t.id, { name: "Viejo" });
    const recent = await makeContact(t.id, { name: "Reciente", phone: "5491100000009" });
    const sold = await makeContact(t.id, { name: "Vendido" });
    await ownerSql`update contacts set stage = 'venta' where id = ${sold.id}`;
    await addMessage(t.id, old.id, "hola", "2026-11-01T10:00:00Z");
    await addMessage(t.id, recent.id, "primero", "2026-11-02T10:00:00Z");
    await addMessage(t.id, recent.id, "x".repeat(120), "2026-11-03T10:00:00Z");

    const board = await listBoard(t.id);
    expect(board.consulta.map((c) => c.name)).toEqual(["Reciente", "Viejo"]);
    expect(board.consulta[0]).toMatchObject({ phone: "5491100000009", lastMessage: "x".repeat(80) });
    expect(board.consulta[0].lastMessageAt).toEqual(new Date("2026-11-03T10:00:00Z"));
    expect(board.venta.map((c) => c.name)).toEqual(["Vendido"]);
    expect(board.postventa).toEqual([]);
  });

  it("never includes another tenant's contacts", async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    await makeContact(b.id, { name: "Ajeno" });
    const board = await listBoard(a.id);
    expect([...board.consulta, ...board.venta, ...board.postventa]).toEqual([]);
  });
});

describe("setContactStage", () => {
  it("moves a contact to a new stage", async () => {
    const t = await makeTenant();
    const c = await makeContact(t.id);
    expect(await setContactStage(t.id, c.id, "venta")).toEqual({ success: true, data: { id: c.id, stage: "venta" } });
  });

  it("returns NOT_FOUND for another tenant's contact and leaves it untouched", async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    const cb = await makeContact(b.id);
    expect(await setContactStage(a.id, cb.id, "venta")).toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
    const [row] = await ownerSql<{ stage: string }[]>`select stage from contacts where id = ${cb.id}`;
    expect(row.stage).toBe("consulta");
  });

  it("rejects an unknown stage or a malformed id with VALIDATION", async () => {
    const t = await makeTenant();
    const c = await makeContact(t.id);
    expect(await setContactStage(t.id, c.id, "cerrado")).toMatchObject({ success: false, error: { code: "VALIDATION" } });
    expect(await setContactStage(t.id, "not-a-uuid", "venta")).toMatchObject({ success: false, error: { code: "VALIDATION" } });
  });
});
