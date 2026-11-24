import { afterAll, describe, expect, it } from "vitest";
import { listCustomerOrders, listCustomers, parseCustomerFilters } from "@/contacts/directory";
import { dropTenants, makeContact, makeTenant, ownerSql } from "@/test/db";

afterAll(async () => {
  await dropTenants();
  await ownerSql.end();
});

const all = parseCustomerFilters({});
const order = (tenantId: string, contactId: string, status: string, total = 100) =>
  ownerSql`insert into orders (tenant_id, contact_id, status, delivery_date, address, total)
    values (${tenantId}, ${contactId}, ${status}, current_date, 'Calle 1', ${total})`;
const touch = (id: string, ago = "1 minute") => ownerSql`update contacts set last_message_at = now() - ${ago}::interval where id = ${id}`;
const byName = (rows: { name: string | null }[]) => rows.map((r) => r.name);

describe("parseCustomerFilters", () => {
  it("ignores invalid values", () => {
    expect(parseCustomerFilters({ estado: "x", tablero: "tal vez", pagina: "-3", q: "  " })).toEqual({ pagina: 1 });
    expect(parseCustomerFilters({ estado: "compro", tablero: "no", pagina: "2", q: " Ana " })).toEqual({
      estado: "compro",
      tablero: "no",
      pagina: 2,
      q: "Ana",
    });
  });
});

describe("listCustomers", () => {
  it("classifies how far each customer got and what they spent", async () => {
    const t = await makeTenant();
    const bought = await makeContact(t.id, { name: "Compró" });
    const reached = await makeContact(t.id, { name: "Llegó" });
    const inVenta = await makeContact(t.id, { name: "En venta" });
    const pending = await makeContact(t.id, { name: "Pendiente" });
    const never = await makeContact(t.id, { name: "Nunca" });
    await order(t.id, bought.id, "delivered", 300);
    await order(t.id, bought.id, "delivered", 200);
    await order(t.id, bought.id, "cancelled", 999);
    await ownerSql`update contacts set reached_venta_at = now() where id = ${reached.id}`;
    await ownerSql`update contacts set stage = 'venta' where id = ${inVenta.id}`;
    await order(t.id, pending.id, "pending");
    for (const c of [bought, reached, inVenta, pending, never]) await touch(c.id);

    const { rows } = await listCustomers(t.id, all);
    const got = Object.fromEntries(rows.map((r) => [r.name, [r.outcome, Number(r.spent)]]));
    expect(got).toEqual({
      Compró: ["compro", 500],
      Llegó: ["venta", 0],
      "En venta": ["venta", 0],
      Pendiente: ["venta", 0],
      Nunca: ["consulta", 0],
    });
  });

  it("includes customers off the board", async () => {
    const t = await makeTenant();
    const closed = await makeContact(t.id, { name: "Cerrado" });
    const idle = await makeContact(t.id, { name: "Inactivo" });
    const active = await makeContact(t.id, { name: "Activo" });
    await ownerSql`update contacts set closed_at = now() where id = ${closed.id}`;
    await touch(idle.id, "3 days");
    await touch(active.id);
    const { rows } = await listCustomers(t.id, all);
    expect(Object.fromEntries(rows.map((r) => [r.name, r.onBoard]))).toEqual({ Cerrado: false, Inactivo: false, Activo: true });
    expect(byName((await listCustomers(t.id, parseCustomerFilters({ tablero: "no" }))).rows).sort()).toEqual(["Cerrado", "Inactivo"]);
    expect(byName((await listCustomers(t.id, parseCustomerFilters({ tablero: "si" }))).rows)).toEqual(["Activo"]);
  });

  it("searches name and phone, treating wildcards literally", async () => {
    const t = await makeTenant();
    await makeContact(t.id, { name: "Ana López", phone: "5491111111111" });
    await makeContact(t.id, { name: "Bruno", phone: "5492222222222" });
    expect(byName((await listCustomers(t.id, parseCustomerFilters({ q: "ana" }))).rows)).toEqual(["Ana López"]);
    expect(byName((await listCustomers(t.id, parseCustomerFilters({ q: "22222" }))).rows)).toEqual(["Bruno"]);
    expect((await listCustomers(t.id, parseCustomerFilters({ q: "%" }))).rows).toEqual([]);
  });

  it("filters by outcome", async () => {
    const t = await makeTenant();
    const a = await makeContact(t.id, { name: "A" });
    await makeContact(t.id, { name: "B" });
    await order(t.id, a.id, "delivered");
    expect(byName((await listCustomers(t.id, parseCustomerFilters({ estado: "compro" }))).rows)).toEqual(["A"]);
    expect(byName((await listCustomers(t.id, parseCustomerFilters({ estado: "consulta" }))).rows)).toEqual(["B"]);
  });

  it("pages by 50, newest message first", async () => {
    const t = await makeTenant();
    await ownerSql`insert into contacts (tenant_id, jid, name, last_message_at)
      select ${t.id}, 'p' || i || '@s.whatsapp.net', 'P' || i, now() - make_interval(mins => i)
      from generate_series(1, 51) i`;
    const first = await listCustomers(t.id, all);
    expect(first.rows).toHaveLength(50);
    expect(first.hasMore).toBe(true);
    expect(first.rows[0].name).toBe("P1");
    const second = await listCustomers(t.id, parseCustomerFilters({ pagina: "2" }));
    expect(byName(second.rows)).toEqual(["P51"]);
    expect(second.hasMore).toBe(false);
  });

  it("never lists another tenant's customers or orders", async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    const cb = await makeContact(b.id, { name: "Ajeno" });
    await order(b.id, cb.id, "delivered");
    expect((await listCustomers(a.id, all)).rows).toEqual([]);
    expect((await listCustomerOrders(a.id, [cb.id])).size).toBe(0);
  });
});

describe("listCustomerOrders", () => {
  it("groups every order by customer, newest first", async () => {
    const t = await makeTenant();
    const c = await makeContact(t.id);
    await order(t.id, c.id, "delivered", 100);
    await order(t.id, c.id, "cancelled", 50);
    const map = await listCustomerOrders(t.id, [c.id]);
    expect(map.get(c.id)?.map((o) => o.status)).toEqual(["cancelled", "delivered"]);
  });
});
