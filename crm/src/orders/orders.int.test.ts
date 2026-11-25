import { afterAll, describe, expect, it } from "vitest";
import { cancelOrder, createOrder, deliverOrder, listOrders, updateOrder } from "@/orders/orders";
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
    const [order] = await listOrders(t.id);
    expect(order.items.find((i) => i.productName === "Pan de campo")?.unitPrice).toBe("2500.00");
  });

  it("rolls everything back when a later line is out of stock", async () => {
    const t = await makeTenant();
    const pan = await product(t.id, "Pan de campo", 2500, 10);
    const med = await product(t.id, "Medialunas", 4800, 0);
    const c = await buyer(t.id);
    expect(await createOrder(t.id, input(c, [{ productId: pan, quantity: 2 }, { productId: med, quantity: 1 }]))).toEqual({
      success: false,
      error: { code: "OUT_OF_STOCK", message: "No hay stock suficiente de Medialunas (quedan 0)", details: { productId: med } },
    });
    expect(await stockOf(pan)).toBe(10);
    expect(await listOrders(t.id)).toEqual([]);
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

  it("delivering reactivates the bot for that chat", async () => {
    const t = await makeTenant();
    const pan = await product(t.id, "Pan de campo", 100, 5);
    const c = await buyer(t.id);
    await ownerSql`update contacts set bot_paused_until = now() + interval '10 hours' where id = ${c}`;
    const r = await createOrder(t.id, input(c, [{ productId: pan, quantity: 1 }]));
    if (!r.success) throw new Error("setup");
    await deliverOrder(t.id, r.data.id);
    const [row] = await ownerSql<{ bot_paused_until: Date | null }[]>`select bot_paused_until from contacts where id = ${c}`;
    expect(row.bot_paused_until).toBeNull();
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
    expect(await listOrders(a.id)).toEqual([]);
  });
});

describe("createOrder on a closed contact", () => {
  it("refuses a contact that left the board", async () => {
    const t = await makeTenant();
    const pan = await product(t.id, "Pan de campo", 2500, 10);
    const c = await buyer(t.id);
    await ownerSql`update contacts set closed_at = now() where id = ${c}`;
    expect(await createOrder(t.id, input(c, [{ productId: pan, quantity: 1 }]))).toMatchObject({
      success: false,
      error: { code: "VALIDATION", message: "Ese cliente ya no está en el tablero" },
    });
    expect(await stockOf(pan)).toBe(10);
  });
});

describe("updateOrder", () => {
  const edit = (items: { productId: string; quantity: number }[], over: object = {}) => ({
    items,
    deliveryDate: baDate(1),
    address: "Av. Siempre Viva 742",
    ...over,
  });
  const setup = async () => {
    const t = await makeTenant();
    const pan = await product(t.id, "Pan de campo", 2500, 10);
    const med = await product(t.id, "Medialunas", 4800, 5);
    const c = await buyer(t.id);
    const r = await createOrder(t.id, input(c, [{ productId: pan, quantity: 3 }]));
    if (!r.success) throw new Error("setup failed");
    return { t, pan, med, order: r.data };
  };

  it("changes date, address and notes", async () => {
    const { t, pan, order } = await setup();
    const r = await updateOrder(t.id, order.id, edit([{ productId: pan, quantity: 3 }], { deliveryDate: baDate(5), address: "Otra 1", notes: "timbre 2" }));
    expect(r).toMatchObject({ success: true, data: { id: order.id, deliveryDate: baDate(5), address: "Otra 1", notes: "timbre 2", total: "7500.00" } });
    expect(await stockOf(pan)).toBe(7);
  });

  it("lowering a quantity gives the difference back to the stock", async () => {
    const { t, pan, order } = await setup();
    expect(await updateOrder(t.id, order.id, edit([{ productId: pan, quantity: 1 }]))).toMatchObject({ success: true, data: { total: "2500.00" } });
    expect(await stockOf(pan)).toBe(9);
  });

  it("switching products gives back the old one and takes the new one", async () => {
    const { t, pan, med, order } = await setup();
    const r = await updateOrder(t.id, order.id, edit([{ productId: med, quantity: 2 }]));
    expect(r).toMatchObject({ success: true, data: { total: "9600.00", items: [{ productName: "Medialunas", quantity: 2 }] } });
    expect([await stockOf(pan), await stockOf(med)]).toEqual([10, 3]);
  });

  it("refuses when the stock is short and leaves the order and the stock as they were", async () => {
    const { t, pan, med, order } = await setup();
    const r = await updateOrder(t.id, order.id, edit([{ productId: pan, quantity: 2 }, { productId: med, quantity: 6 }]));
    expect(r).toMatchObject({ success: false, error: { code: "OUT_OF_STOCK", details: { productId: med } } });
    expect([await stockOf(pan), await stockOf(med)]).toEqual([7, 5]);
    const [after] = await listOrders(t.id);
    expect(after).toMatchObject({ total: "7500.00", items: [{ productName: "Pan de campo", quantity: 3 }] });
  });

  it("the stock the order already holds counts as available", async () => {
    const { t, pan, order } = await setup();
    expect(await updateOrder(t.id, order.id, edit([{ productId: pan, quantity: 10 }]))).toMatchObject({ success: true });
    expect(await stockOf(pan)).toBe(0);
  });

  it("does not touch products without stock control", async () => {
    const t = await makeTenant();
    const torta = await product(t.id, "Torta", 18000, null);
    const c = await buyer(t.id);
    const r0 = await createOrder(t.id, input(c, [{ productId: torta, quantity: 1 }]));
    if (!r0.success) throw new Error("setup failed");
    expect(await updateOrder(t.id, r0.data.id, edit([{ productId: torta, quantity: 4 }]))).toMatchObject({ success: true, data: { total: "72000.00" } });
    expect(await stockOf(torta)).toBeNull();
  });

  it("only edits pending orders", async () => {
    const { t, pan, order } = await setup();
    await deliverOrder(t.id, order.id);
    expect(await updateOrder(t.id, order.id, edit([{ productId: pan, quantity: 1 }]))).toEqual({
      success: false,
      error: { code: "VALIDATION", message: "Ese pedido ya no está pendiente" },
    });
    expect(await stockOf(pan)).toBe(7);
  });

  it("validates the input and the date like creating", async () => {
    const { t, pan, order } = await setup();
    expect(await updateOrder(t.id, order.id, edit([]))).toMatchObject({ success: false, error: { code: "VALIDATION" } });
    expect(await updateOrder(t.id, order.id, edit([{ productId: pan, quantity: 1 }], { deliveryDate: baDate(-1) }))).toMatchObject({
      success: false,
      error: { code: "VALIDATION", details: { deliveryDate: ["La fecha de entrega no puede ser anterior a hoy"] } },
    });
  });

  it("another tenant's order or a malformed id is NOT_FOUND", async () => {
    const { pan, order } = await setup();
    const other = await makeTenant();
    expect(await updateOrder(other.id, order.id, edit([{ productId: pan, quantity: 1 }]))).toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
    expect(await updateOrder(other.id, "nope", edit([{ productId: pan, quantity: 1 }]))).toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
  });
});
