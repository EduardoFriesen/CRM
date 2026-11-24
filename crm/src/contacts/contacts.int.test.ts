import { afterAll, describe, expect, it } from "vitest";
import { closeContact, listBoard, setContactStage } from "@/contacts/contacts";
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
    await ownerSql`update tenants set consulta_idle_days = 30 where id = ${t.id}`; // fixed dates below
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

describe("postventa needs a delivered order", () => {
  const withOrder = async (tenantId: string, contactId: string, status: string) => {
    await ownerSql`insert into orders (tenant_id, contact_id, status, delivery_date, address, total)
      values (${tenantId}, ${contactId}, ${status}, current_date, 'Calle 1', 100)`;
  };

  it("refuses postventa without a delivered order", async () => {
    const t = await makeTenant();
    const c = await makeContact(t.id);
    expect(await setContactStage(t.id, c.id, "postventa")).toEqual({
      success: false,
      error: { code: "NEEDS_DELIVERED_ORDER", message: "Para pasar a Postventa el cliente necesita un pedido entregado" },
    });
    await withOrder(t.id, c.id, "cancelled");
    expect(await setContactStage(t.id, c.id, "postventa")).toMatchObject({ error: { code: "NEEDS_DELIVERED_ORDER" } });
    await withOrder(t.id, c.id, "delivered");
    expect(await setContactStage(t.id, c.id, "postventa")).toMatchObject({ success: true });
  });

  it("tells the board who already has a delivered order", async () => {
    const t = await makeTenant();
    const c = await makeContact(t.id, { name: "Con pedido" });
    await makeContact(t.id, { name: "Sin pedido" });
    await withOrder(t.id, c.id, "delivered");
    const board = await listBoard(t.id);
    const all = [...board.consulta, ...board.venta, ...board.postventa];
    expect(Object.fromEntries(all.map((x) => [x.name, x.hasDeliveredOrder]))).toEqual({ "Con pedido": true, "Sin pedido": false });
  });
});

const setStage = (id: string, stage: string) => ownerSql`update contacts set stage = ${stage} where id = ${id}`;
const lastMessageAgo = (id: string, interval: string) =>
  ownerSql`update contacts set last_message_at = now() - ${interval}::interval where id = ${id}`;
const closedAt = async (id: string) => (await ownerSql<{ closed_at: Date | null }[]>`select closed_at from contacts where id = ${id}`)[0].closed_at;
const names = (board: Awaited<ReturnType<typeof listBoard>>) => [...board.consulta, ...board.venta, ...board.postventa].map((c) => c.name);

describe("closeContact", () => {
  it("closes a postventa contact and hides it from the board", async () => {
    const t = await makeTenant();
    const c = await makeContact(t.id, { name: "Cerrado" });
    await setStage(c.id, "postventa");
    expect(await closeContact(t.id, c.id)).toEqual({ success: true, data: { id: c.id } });
    expect((await listBoard(t.id)).postventa).toEqual([]);
    expect(await closedAt(c.id)).not.toBeNull();
  });

  it("closes a consulta contact", async () => {
    const t = await makeTenant();
    const c = await makeContact(t.id);
    expect(await closeContact(t.id, c.id)).toMatchObject({ success: true });
    expect((await listBoard(t.id)).consulta).toEqual([]);
  });

  it("refuses a venta contact with NOT_CLOSABLE", async () => {
    const t = await makeTenant();
    const c = await makeContact(t.id);
    await setStage(c.id, "venta");
    expect(await closeContact(t.id, c.id)).toMatchObject({ success: false, error: { code: "NOT_CLOSABLE" } });
    expect(await closedAt(c.id)).toBeNull();
  });

  it("returns NOT_CLOSABLE when already closed", async () => {
    const t = await makeTenant();
    const c = await makeContact(t.id);
    await closeContact(t.id, c.id);
    expect(await closeContact(t.id, c.id)).toMatchObject({ success: false, error: { code: "NOT_CLOSABLE" } });
  });

  it("returns NOT_FOUND for another tenant's contact or a malformed id", async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    const cb = await makeContact(b.id);
    expect(await closeContact(a.id, cb.id)).toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
    expect(await closedAt(cb.id)).toBeNull();
    expect(await closeContact(a.id, "not-a-uuid")).toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
  });
});

describe("idle consultas", () => {
  it("hides consulta contacts idle longer than the tenant's consulta_idle_days", async () => {
    const t = await makeTenant();
    const idle = await makeContact(t.id, { name: "Inactiva" });
    const fresh = await makeContact(t.id, { name: "Reciente" });
    const venta = await makeContact(t.id, { name: "Venta vieja" });
    await lastMessageAgo(idle.id, "2 days");
    await lastMessageAgo(fresh.id, "1 hour");
    await setStage(venta.id, "venta");
    await lastMessageAgo(venta.id, "5 days");
    expect(names(await listBoard(t.id)).sort()).toEqual(["Reciente", "Venta vieja"]);
  });

  it("shows them again when consulta_idle_days grows", async () => {
    const t = await makeTenant();
    const idle = await makeContact(t.id, { name: "Inactiva" });
    await lastMessageAgo(idle.id, "2 days");
    expect(names(await listBoard(t.id))).toEqual([]);
    await ownerSql`update tenants set consulta_idle_days = 3 where id = ${t.id}`;
    expect(names(await listBoard(t.id))).toEqual(["Inactiva"]);
  });
});
