import { afterAll, describe, expect, it } from "vitest";
import { saveBusinessProfile } from "@/business/profile";
import { createProduct } from "@/catalog/catalog";
import { dropTenants, makeContact, makeTenant, ownerSql } from "@/test/db";
import { fill } from "./templates";
import { answerFaq } from "./answers";

afterAll(async () => {
  await dropTenants();
  await ownerSql.end();
});

const add = async (tenantId: string, name: string, price: string, stock?: string) => {
  const r = await createProduct(tenantId, { name, price, ...(stock !== undefined ? { stock } : {}) });
  if (!r.success) throw new Error("setup failed");
};

describe("answerFaq", () => {
  it("price of one product", async () => {
    const t = await makeTenant();
    await add(t.id, "Pan de campo", "2500", "5");
    const out = await answerFaq(t.id, { fn: "price", args: { product: "pan de campo" } });
    expect(out).toContain("Pan de campo");
    expect(out).toContain("$2.500");
  });

  it("lists 3 and offers more when there are more", async () => {
    const t = await makeTenant();
    await add(t.id, "Pan A", "100", "0");
    await add(t.id, "Pan B", "200", "3");
    await add(t.id, "Pan C", "300", "0");
    await add(t.id, "Pan D", "400", "3");
    await add(t.id, "Pan E", "500", "3");
    const out = (await answerFaq(t.id, { fn: "price", args: { product: "pan" } })) as string;
    for (const n of ["Pan A", "Pan B", "Pan C"]) expect(out).toContain(n);
    expect(out).not.toContain("Pan D");
    const lines = out.split("\n");
    expect(lines.find((l) => l.includes("Pan A"))).toContain("sin stock");
    expect(lines.find((l) => l.includes("Pan C"))).toContain("sin stock");
    expect(lines.find((l) => l.includes("Pan B"))).not.toContain("sin stock");
    expect(out).toMatch(/más opciones/);
    expect(out).not.toMatch(/\d+\s*unidades/);
  });

  it("stock says only available or not", async () => {
    const t = await makeTenant();
    await add(t.id, "Pan de campo", "2500", "7");
    const out = (await answerFaq(t.id, { fn: "stock", args: { product: "pan" } })) as string;
    expect(out).toContain("disponible");
    expect(out).not.toContain("7");
  });

  it("stock with several matches lists each one's availability", async () => {
    const t = await makeTenant();
    await add(t.id, "Pan A", "100", "0");
    await add(t.id, "Pan B", "200", "5");
    const out = (await answerFaq(t.id, { fn: "stock", args: { product: "pan" } })) as string;
    const lines = out.split("\n");
    expect(lines.find((l) => l.includes("Pan A"))).toContain("sin stock");
    expect(lines.find((l) => l.includes("Pan B"))).not.toContain("sin stock");
    expect(out).not.toMatch(/\d+\s*unidades|5/);
  });

  it("price of a single out-of-stock product mentions it", async () => {
    const t = await makeTenant();
    await add(t.id, "Pan de campo", "2500", "0");
    const out = (await answerFaq(t.id, { fn: "price", args: { product: "pan" } })) as string;
    expect(out).toContain("sin stock");
    expect(out).not.toMatch(/reserv/);
  });

  it("stock says sin stock when there is none", async () => {
    const t = await makeTenant();
    await add(t.id, "Pan de campo", "2500", "0");
    expect(await answerFaq(t.id, { fn: "stock", args: { product: "pan" } })).toContain("sin stock");
  });

  it("null when no product matches or the product is blank", async () => {
    const t = await makeTenant();
    await add(t.id, "Pan", "100");
    expect(await answerFaq(t.id, { fn: "price", args: { product: "torta" } })).toBeNull();
    expect(await answerFaq(t.id, { fn: "price", args: {} })).toBeNull();
    expect(await answerFaq(t.id, { fn: "stock", args: { product: "  " } })).toBeNull();
  });

  it("business fields fill their template", async () => {
    const t = await makeTenant();
    await saveBusinessProfile(t.id, {
      hours: "Lun a vie 9 a 18",
      address: "Mitre 123",
      paymentMethods: "Efectivo y transferencia",
      shipping: "Envíos a todo el país",
    });
    expect(await answerFaq(t.id, { fn: "hours", args: {} })).toContain("Lun a vie 9 a 18");
    expect(await answerFaq(t.id, { fn: "location", args: {} })).toContain("Mitre 123");
    expect(await answerFaq(t.id, { fn: "payment_methods", args: {} })).toContain("Efectivo y transferencia");
    expect(await answerFaq(t.id, { fn: "shipping", args: { zone: "Rosario" } })).toContain("Envíos a todo el país");
  });

  it("null when the field is empty or blank", async () => {
    const t = await makeTenant();
    expect(await answerFaq(t.id, { fn: "hours", args: {} })).toBeNull();
    await saveBusinessProfile(t.id, { hours: "   " });
    expect(await answerFaq(t.id, { fn: "hours", args: {} })).toBeNull();
  });

  it("catalog lists every product with its price and marks the ones out of stock", async () => {
    const t = await makeTenant();
    await add(t.id, "Kikuyo", "10000", "5");
    await add(t.id, "Gramilla", "8000", "0");
    const out = (await answerFaq(t.id, { fn: "catalog", args: {} })) as string;
    const lines = out.split("\n");
    expect(lines.find((l) => l.includes("Kikuyo"))).toContain("$10.000");
    expect(lines.find((l) => l.includes("Kikuyo"))).not.toContain("sin stock");
    expect(lines.find((l) => l.includes("Gramilla"))).toContain("sin stock");
    expect(out).not.toMatch(/más opciones/);
  });

  it("catalog lists 10 and offers more when there are more", async () => {
    const t = await makeTenant();
    for (let i = 0; i < 11; i++) await add(t.id, `Producto ${String(i).padStart(2, "0")}`, "100", "1");
    const out = (await answerFaq(t.id, { fn: "catalog", args: {} })) as string;
    expect(out).toContain("Producto 09");
    expect(out).not.toContain("Producto 10");
    expect(out).toMatch(/más opciones/);
  });

  it("catalog is null when the catalog is empty", async () => {
    const t = await makeTenant();
    expect(await answerFaq(t.id, { fn: "catalog", args: {} })).toBeNull();
  });

  it("quote multiplies quantity by price, adds the lines and says shipping is not included", async () => {
    const t = await makeTenant();
    await add(t.id, "Kikuyo", "10000", "500");
    await add(t.id, "Tornillos 5mm", "50.50");
    const out = (await answerFaq(t.id, { fn: "quote", args: { items: [{ product: "kikuyo", quantity: 300 }, { product: "tornillos", quantity: 3 }] } })) as string;
    const lines = out.split("\n");
    expect(lines.find((l) => l.includes("Kikuyo"))).toContain("300 × $10.000 = $3.000.000");
    expect(lines.find((l) => l.includes("Tornillos 5mm"))).toContain("3 × $50,50 = $151,50");
    expect(out).toMatch(/Total: \$3\.000\.151,50/);
    expect(out).toMatch(/sin envío/);
    expect(out).not.toContain("500");
  });

  it("quote accepts decimal quantities", async () => {
    const t = await makeTenant();
    await add(t.id, "Kikuyo", "10000");
    const out = (await answerFaq(t.id, { fn: "quote", args: { items: [{ product: "kikuyo", quantity: 12.5 }] } })) as string;
    expect(out).toContain("12,5 × $10.000 = $125.000");
  });

  it("quote prefers the exact name and is null when a product is unknown or ambiguous", async () => {
    const t = await makeTenant();
    await add(t.id, "Tornillo", "50");
    await add(t.id, "Tornillo 6mm", "60");
    await add(t.id, "Clavo 1 pulgada", "10");
    await add(t.id, "Clavo 2 pulgadas", "20");
    expect(await answerFaq(t.id, { fn: "quote", args: { items: [{ product: "tornillo", quantity: 2 }] } })).toContain("$100");
    expect(await answerFaq(t.id, { fn: "quote", args: { items: [{ product: "clavo", quantity: 2 }] } })).toBeNull();
    expect(await answerFaq(t.id, { fn: "quote", args: { items: [{ product: "tornillo", quantity: 2 }, { product: "torta", quantity: 1 }] } })).toBeNull();
    expect(await answerFaq(t.id, { fn: "quote", args: { items: [] } })).toBeNull();
  });

  it("quote over the stock hands off without revealing the quantity", async () => {
    const t = await makeTenant();
    await add(t.id, "Kikuyo", "10000", "120");
    await add(t.id, "Gramilla", "8000", "0");
    for (const product of ["kikuyo", "gramilla"]) {
      const out = await answerFaq(t.id, { fn: "quote", args: { items: [{ product, quantity: 300 }] } }, () => 0);
      expect(out).toMatchObject({ attention: expect.stringContaining("300") });
      const text = (out as { text: string }).text;
      expect(text).toMatch(/no tenemos esa cantidad/i);
      expect(text).not.toMatch(/120|\b0\b/);
    }
  });

  const order = (tenantId: string, contactId: string, date: string, status = "pending", address = "Av. Siempre Viva 123", deliveredAt: string | null = null) =>
    ownerSql`insert into orders (tenant_id, contact_id, delivery_date, address, total, status, delivered_at)
             values (${tenantId}, ${contactId}, ${date}, ${address}, 100, ${status}, ${deliveredAt})`;

  it("order_status answers the nearest pending order of that contact", async () => {
    const t = await makeTenant();
    const c = await makeContact(t.id);
    await order(t.id, c.id, "2099-12-05", "pending", "Otra 1");
    await order(t.id, c.id, "2099-11-28");
    await order(t.id, c.id, "2099-11-27", "cancelled", "Cancelada 9");
    const out = await answerFaq(t.id, { fn: "order_status", args: {} }, () => 0, c.id);
    expect(out).toBe(fill("order_pending", { date: "sábado 28/11", address: "Av. Siempre Viva 123" }, () => 0));
  });

  it("order_status does not announce a delivery date that already passed", async () => {
    const t = await makeTenant();
    const c = await makeContact(t.id);
    await order(t.id, c.id, "2020-01-10");
    expect(await answerFaq(t.id, { fn: "order_status", args: {} }, () => 0, c.id)).toBeNull();
  });

  it("order_status falls back to the latest delivered order", async () => {
    const t = await makeTenant();
    const c = await makeContact(t.id);
    await order(t.id, c.id, "2026-11-10", "delivered", "X", "2026-11-11T15:00:00Z");
    await order(t.id, c.id, "2026-11-20", "delivered", "X", "2026-11-21T15:00:00Z");
    const out = await answerFaq(t.id, { fn: "order_status", args: {} }, () => 0, c.id);
    expect(out).toBe(fill("order_delivered", { date: "sábado 21/11" }, () => 0));
  });

  it("order_status is null without pending or delivered orders, or for another contact's orders", async () => {
    const t = await makeTenant();
    const c = await makeContact(t.id);
    const other = await makeContact(t.id);
    await order(t.id, other.id, "2099-11-28");
    await order(t.id, c.id, "2099-11-28", "cancelled");
    expect(await answerFaq(t.id, { fn: "order_status", args: {} }, () => 0, c.id)).toBeNull();
    expect(await answerFaq(t.id, { fn: "order_status", args: {} }, () => 0)).toBeNull();
  });

  const fact = async (tenantId: string, question: string, answer: string, updatedAt = "2026-11-01T00:00:00Z") => {
    const [row] = await ownerSql<{ id: string }[]>`insert into business_facts (tenant_id, question, answer, updated_at)
      values (${tenantId}, ${question}, ${answer}, ${updatedAt}) returning id`;
    return row.id;
  };

  it("learned answers the admin's answer verbatim", async () => {
    const t = await makeTenant();
    const id = await fact(t.id, "¿Hacen factura A?", "Sí, hacemos factura A con tu CUIT.");
    expect(await answerFaq(t.id, { fn: "learned", args: { factId: id } })).toBe("Sí, hacemos factura A con tu CUIT.");
  });

  it("learned is null for a deleted, unknown or malformed fact", async () => {
    const t = await makeTenant();
    const id = await fact(t.id, "q", "a");
    await ownerSql`delete from business_facts where id = ${id}`;
    expect(await answerFaq(t.id, { fn: "learned", args: { factId: id } })).toBeNull();
    expect(await answerFaq(t.id, { fn: "learned", args: { factId: "nope" } })).toBeNull();
    expect(await answerFaq(t.id, { fn: "learned", args: {} })).toBeNull();
  });

  it("unclear, greeting and handoff always answer", async () => {
    const t = await makeTenant();
    for (const fn of ["unclear", "greeting", "farewell", "handoff", "attention"] as const) {
      const out = await answerFaq(t.id, { fn, args: {} });
      expect(out).toBeTruthy();
      expect(out).not.toContain("{");
    }
  });
});
