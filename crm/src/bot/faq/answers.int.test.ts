import { afterAll, describe, expect, it } from "vitest";
import { saveBusinessProfile } from "@/business/profile";
import { createProduct } from "@/catalog/catalog";
import { dropTenants, makeTenant, ownerSql } from "@/test/db";
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

  it("unclear and handoff always answer", async () => {
    const t = await makeTenant();
    for (const fn of ["unclear", "handoff"] as const) {
      const out = await answerFaq(t.id, { fn, args: {} });
      expect(out).toBeTruthy();
      expect(out).not.toContain("{");
    }
  });
});
