import { afterAll, describe, expect, it } from "vitest";
import { listSales, parseSalesFilters } from "@/orders/sales";
import { dropTenants, makeContact, makeTenant, ownerSql } from "@/test/db";

afterAll(async () => {
  await dropTenants();
  await ownerSql.end();
});

const sale = async (
  tenantId: string,
  contactId: string,
  o: { status?: string; total?: number; day?: string; items?: string[] } = {},
) => {
  const [row] = await ownerSql<{ id: string }[]>`insert into orders (tenant_id, contact_id, status, delivery_date, address, total)
    values (${tenantId}, ${contactId}, ${o.status ?? "delivered"}, ${o.day ?? "2026-11-10"}, 'Calle 1', ${o.total ?? 100}) returning id`;
  for (const name of o.items ?? ["Gramilla"])
    await ownerSql`insert into order_items (tenant_id, order_id, product_name, unit_price, quantity, line_total)
      values (${tenantId}, ${row.id}, ${name}, 10, 1, 10)`;
  return row.id;
};
const totals = (sum: number, count: number) => ({ count, sum: sum.toFixed(2), avg: (count ? sum / count : 0).toFixed(2) });

describe("parseSalesFilters", () => {
  it("ignores invalid dates and amounts", () => {
    expect(parseSalesFilters({ desde: "2026-13-45", min: "abc", max: "-5", pagina: "0", cancelados: "x" })).toEqual({ pagina: 1, cancelados: false });
    expect(parseSalesFilters({ desde: "2026-11-01", hasta: "2026-11-30", min: "100", max: "500", cancelados: "si", producto: "pan" })).toEqual({
      desde: "2026-11-01",
      hasta: "2026-11-30",
      min: 100,
      max: 500,
      cancelados: true,
      producto: "pan",
      pagina: 1,
    });
  });
});

describe("listSales", () => {
  it("lists delivered orders, newest delivery first, with totals", async () => {
    const t = await makeTenant();
    const c = await makeContact(t.id, { name: "Ana" });
    await sale(t.id, c.id, { total: 100, day: "2026-11-01" });
    await sale(t.id, c.id, { total: 300, day: "2026-11-05" });
    await sale(t.id, c.id, { status: "cancelled", total: 999 });
    await sale(t.id, c.id, { status: "pending", total: 999 });
    const r = await listSales(t.id, parseSalesFilters({}));
    expect(r.orders.map((o) => Number(o.total))).toEqual([300, 100]);
    expect(r.totals).toEqual(totals(400, 2));
  });

  it("adds cancelled orders on request, still totalling only delivered ones", async () => {
    const t = await makeTenant();
    const c = await makeContact(t.id);
    await sale(t.id, c.id, { total: 100 });
    await sale(t.id, c.id, { status: "cancelled", total: 999 });
    const r = await listSales(t.id, parseSalesFilters({ cancelados: "si" }));
    expect(r.orders.map((o) => o.status).sort()).toEqual(["cancelled", "delivered"]);
    expect(r.totals).toEqual(totals(100, 1));
  });

  it("filters by product once per order, by customer, dates and amounts", async () => {
    const t = await makeTenant();
    const ana = await makeContact(t.id, { name: "Ana", phone: "5491111111111" });
    const bruno = await makeContact(t.id, { name: "Bruno" });
    await sale(t.id, ana.id, { total: 100, day: "2026-11-01", items: ["Pan de campo", "Pan negro"] });
    await sale(t.id, bruno.id, { total: 500, day: "2026-11-20", items: ["Kikuyo"] });
    const names = async (p: Record<string, string>) => (await listSales(t.id, parseSalesFilters(p))).orders.map((o) => o.contactName);
    const prod = await listSales(t.id, parseSalesFilters({ producto: "pan" }));
    expect(prod.orders.map((o) => o.contactName)).toEqual(["Ana"]);
    expect(prod.totals).toEqual(totals(100, 1));
    expect(await names({ cliente: "bru" })).toEqual(["Bruno"]);
    expect(await names({ cliente: "11111" })).toEqual(["Ana"]);
    expect(await names({ desde: "2026-11-20" })).toEqual(["Bruno"]);
    expect(await names({ hasta: "2026-11-01" })).toEqual(["Ana"]);
    expect(await names({ min: "200" })).toEqual(["Bruno"]);
    expect(await names({ max: "100" })).toEqual(["Ana"]);
    expect(await names({ producto: "%" })).toEqual([]);
  });

  it("totals the whole filtered result while paging by 50", async () => {
    const t = await makeTenant();
    const c = await makeContact(t.id);
    await ownerSql`insert into orders (tenant_id, contact_id, status, delivery_date, address, total)
      select ${t.id}, ${c.id}, 'delivered', date '2026-11-01' + i, 'Calle', 10 from generate_series(1, 51) i`;
    const first = await listSales(t.id, parseSalesFilters({}));
    expect(first.orders).toHaveLength(50);
    expect(first.hasMore).toBe(true);
    expect(first.totals).toEqual(totals(510, 51));
    const second = await listSales(t.id, parseSalesFilters({ pagina: "2" }));
    expect(second.orders).toHaveLength(1);
    expect(second.hasMore).toBe(false);
  });

  it("never shows another tenant's sales", async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    await sale(b.id, (await makeContact(b.id)).id);
    const r = await listSales(a.id, parseSalesFilters({}));
    expect(r.orders).toEqual([]);
    expect(r.totals).toEqual(totals(0, 0));
  });
});
