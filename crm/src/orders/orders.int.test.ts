import { afterAll, describe, expect, it } from "vitest";
import { cancelOrder, createOrder, deliverOrder, listOrders } from "@/orders/orders";
import { dropTenants, makeContact, makeTenant, ownerSql } from "@/test/db";

afterAll(async () => {
  await dropTenants();
  await ownerSql.end();
});

const baDate = (offsetDays = 0) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(Date.now() + offsetDays * 86_400_000));

const product = async (tenantId: string, name: string, price: number, stock: number | null, active = true) => {
  const [p] = await ownerSql<{ id: string }[]>`insert into products (tenant_id, name, price, stock, active)
    values (${tenantId}, ${name}, ${price}, ${stock}, ${active}) returning id`;
  return p.id;
};
const stockOf = async (id: string) => (await ownerSql<{ stock: number | null }[]>`select stock from products where id = ${id}`)[0].stock;
const buyer = async (tenantId: string, stage = "venta") => {
  const c = await makeContact(tenantId, { name: "Ana", phone: "5491122334455" });
  await ownerSql`update contacts set stage = ${stage} where id = ${c.id}`;
  return c.id;
};
const input = (contactId: string, items: { productId: string; quantity: number }[], over: object = {}) => ({
  contactId,
  items,
  deliveryDate: baDate(1),
  address: "Av. Siempre Viva 742",
  ...over,
});

describe("createOrder", () => {
  it("freezes prices, totals the lines and discounts stock", async () => {
    const t = await makeTenant();
    const pan = await product(t.id, "Pan de campo", 2500, 10);
    const med = await product(t.id, "Medialunas", 4800, 5);
    const torta = await product(t.id, "Torta", 18000, null);
    const c = await buyer(t.id);
    const r = await createOrder(t.id, input(c, [
      { productId: pan, quantity: 2 },
      { productId: med, quantity: 1 },
      { productId: torta, quantity: 1 },
    ]));
    expect(r).toMatchObject({ success: true, data: { total: "27800.00", status: "pending", contactName: "Ana" } });
    expect([await stockOf(pan), await stockOf(med), await stockOf(torta)]).toEqual([8, 4, null]);
    await ownerSql`update products set price = 9999 where id = ${pan}`;
    const [order] = await listOrders(t.id, { closed: false });
    expect(order.items.find((i) => i.productName === "Pan de campo")?.unitPrice).toBe("2500.00");
  });

  it("rolls everything back when a later line is out of stock", async () => {
    const t = await makeTenant();
    const pan = await product(t.id, "Pan de campo", 2500, 10);
    const med = await product(t.id, "Medialunas", 4800, 0);
    const c = await buyer(t.id);
    expect(await createOrder(t.id, input(c, [{ productId: pan, quantity: 2 }, { productId: med, quantity: 1 }]))).toEqual({
      success: false,
      error: { code: "OUT_OF_STOCK", message: "No hay stock suficiente de Medialunas (quedan 0)" },
    });
    expect(await stockOf(pan)).toBe(10);
    expect(await listOrders(t.id, { closed: false })).toEqual([]);
  });

  it("adds up repeated lines of the same product before checking stock", async () => {
    const t = await makeTenant();
    const pan = await product(t.id, "Pan de campo", 100, 5);
    const c = await buyer(t.id);
    expect(await createOrder(t.id, input(c, [{ productId: pan, quantity: 3 }, { productId: pan, quantity: 3 }]))).toMatchObject({
      error: { code: "OUT_OF_STOCK" },
    });
    await ownerSql`update products set stock = 6 where id = ${pan}`;
    const r = await createOrder(t.id, input(c, [{ productId: pan, quantity: 3 }, { productId: pan, quantity: 3 }]));
    expect(r.success && r.data.items.map((i) => i.quantity)).toEqual([6]);
  });

  it("sells the last unit only once under concurrency", async () => {
    const t = await makeTenant();
    const pan = await product(t.id, "Pan de campo", 100, 1);
    const c = await buyer(t.id);
    const results = await Promise.all([
      createOrder(t.id, input(c, [{ productId: pan, quantity: 1 }])),
      createOrder(t.id, input(c, [{ productId: pan, quantity: 1 }])),
    ]);
    expect(results.filter((r) => r.success)).toHaveLength(1);
    expect(await stockOf(pan)).toBe(0);
  });

  it("only takes orders for customers in venta, for today onwards and active products", async () => {
    const t = await makeTenant();
    const pan = await product(t.id, "Pan de campo", 100, 5);
    const paused = await product(t.id, "Pausado", 100, 5, false);
    const enConsulta = await buyer(t.id, "consulta");
    const c = await buyer(t.id);
    expect(await createOrder(t.id, input(enConsulta, [{ productId: pan, quantity: 1 }]))).toMatchObject({ error: { code: "VALIDATION" } });
    expect(await createOrder(t.id, input(c, [{ productId: pan, quantity: 1 }], { deliveryDate: baDate(-1) }))).toMatchObject({
      error: { code: "VALIDATION" },
    });
    expect(await createOrder(t.id, input(c, [{ productId: pan, quantity: 1 }], { deliveryDate: baDate(0) }))).toMatchObject({ success: true });
    expect(await createOrder(t.id, input(c, [{ productId: paused, quantity: 1 }]))).toMatchObject({ error: { code: "NOT_FOUND" } });
  });
});

describe("deliver and cancel", () => {
  it("delivering moves the customer to postventa", async () => {
    const t = await makeTenant();
    const pan = await product(t.id, "Pan de campo", 100, 5);
    const c = await buyer(t.id);
    const r = await createOrder(t.id, input(c, [{ productId: pan, quantity: 1 }]));
    if (!r.success) throw new Error("setup");
    expect(await deliverOrder(t.id, r.data.id)).toMatchObject({ success: true, data: { status: "delivered" } });
    const [row] = await ownerSql<{ stage: string }[]>`select stage from contacts where id = ${c}`;
    expect(row.stage).toBe("postventa");
  });

  it("cancelling returns the stock exactly once", async () => {
    const t = await makeTenant();
    const pan = await product(t.id, "Pan de campo", 100, 5);
    const c = await buyer(t.id);
    const r = await createOrder(t.id, input(c, [{ productId: pan, quantity: 2 }]));
    if (!r.success) throw new Error("setup");
    expect(await cancelOrder(t.id, r.data.id)).toMatchObject({ success: true, data: { status: "cancelled" } });
    expect(await cancelOrder(t.id, r.data.id)).toMatchObject({ error: { code: "VALIDATION" } });
    expect(await stockOf(pan)).toBe(5);
    expect(await deliverOrder(t.id, r.data.id)).toMatchObject({ error: { code: "VALIDATION" } });
  });

  it("only returns stock that the order actually took", async () => {
    const t = await makeTenant();
    const torta = await product(t.id, "Torta", 100, null);
    const c = await buyer(t.id);
    const r = await createOrder(t.id, input(c, [{ productId: torta, quantity: 2 }]));
    if (!r.success) throw new Error("setup");
    await ownerSql`update products set stock = 10 where id = ${torta}`;
    await cancelOrder(t.id, r.data.id);
    expect(await stockOf(torta)).toBe(10);
  });

  it("never shows another tenant's orders", async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    const pan = await product(b.id, "Pan", 100, 5);
    const c = await buyer(b.id);
    await createOrder(b.id, input(c, [{ productId: pan, quantity: 1 }]));
    expect(await listOrders(a.id, { closed: false })).toEqual([]);
  });
});
