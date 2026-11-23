import { afterAll, describe, expect, it } from "vitest";
import {
  createProduct,
  deleteProduct,
  listProducts,
  searchCatalog,
  updateProduct,
} from "@/catalog/catalog";
import { dropTenants, makeTenant, ownerSql } from "@/test/db";

afterAll(async () => {
  await dropTenants();
  await ownerSql.end();
});

const ok = <T,>(r: { success: boolean; data?: T }) => {
  if (!r.success) throw new Error("expected success");
  return r.data as T;
};

describe("catalog CRUD", () => {
  it("creates, lists, updates and deletes a product", async () => {
    const t = await makeTenant();
    const p = ok(await createProduct(t.id, { name: " Pan de campo ", price: "2500", stock: "12" }));
    expect(p).toMatchObject({ name: "Pan de campo", price: "2500.00", stock: 12, active: true, description: "" });
    expect((await listProducts(t.id)).map((x) => x.id)).toEqual([p.id]);
    const u = ok(await updateProduct(t.id, p.id, { name: "Pan de campo", price: "2600", stock: "", active: false }));
    expect(u).toMatchObject({ price: "2600.00", stock: null, active: false });
    expect(await deleteProduct(t.id, p.id)).toEqual({ success: true, data: { id: p.id } });
    expect(await listProducts(t.id)).toEqual([]);
  });

  it("rejects a negative price with VALIDATION", async () => {
    const t = await makeTenant();
    expect(await createProduct(t.id, { name: "Pan", price: "-5" })).toMatchObject({
      success: false,
      error: { code: "VALIDATION", details: { price: expect.any(Array) } },
    });
  });

  it("returns NOT_FOUND when touching another tenant's product", async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    const pb = ok(await createProduct(b.id, { name: "Ajeno", price: "1" }));
    expect(await updateProduct(a.id, pb.id, { name: "X", price: "1" })).toMatchObject({ error: { code: "NOT_FOUND" } });
    expect(await deleteProduct(a.id, pb.id)).toMatchObject({ error: { code: "NOT_FOUND" } });
    expect(await listProducts(b.id)).toHaveLength(1);
  });
});

describe("catalog edits vs. orders", () => {
  it("keeps the stock an order took when an edit leaves stock untouched", async () => {
    const t = await makeTenant();
    const p = ok(await createProduct(t.id, { name: "Pan", price: "100", stock: "10" }));
    await ownerSql`update products set stock = 8 where id = ${p.id}`; // an order took 2 meanwhile
    expect(await updateProduct(t.id, p.id, { name: "Pan", price: "120", stock: "10", loadedStock: "10" })).toMatchObject({
      success: true,
      data: { price: "120.00", stock: 8 },
    });
  });

  it("refuses a stock change made on a stale value", async () => {
    const t = await makeTenant();
    const p = ok(await createProduct(t.id, { name: "Pan", price: "100", stock: "10" }));
    await ownerSql`update products set stock = 8 where id = ${p.id}`;
    expect(await updateProduct(t.id, p.id, { name: "Pan", price: "100", stock: "15", loadedStock: "10" })).toEqual({
      success: false,
      error: {
        code: "CONFLICT",
        message: "El stock cambió mientras editabas (ahora 8). Revisalo y guardá de nuevo.",
        details: { currentStock: 8 },
      },
    });
  });

  it("applies a stock change when nothing moved meanwhile", async () => {
    const t = await makeTenant();
    const p = ok(await createProduct(t.id, { name: "Pan", price: "100", stock: "10" }));
    expect(await updateProduct(t.id, p.id, { name: "Pan", price: "100", stock: "15", loadedStock: "10" })).toMatchObject({
      data: { stock: 15 },
    });
  });
});

describe("searchCatalog", () => {
  it("matches words ignoring case and accents, hides paused and foreign products, never exposes stock", async () => {
    const t = await makeTenant();
    const other = await makeTenant();
    await createProduct(t.id, { name: "Medialunas de manteca", description: "Docena", price: "4800", stock: "0" });
    await createProduct(t.id, { name: "Pan de campo", price: "2500", stock: "12" });
    await createProduct(t.id, { name: "Torta especial", price: "18000", active: false });
    await createProduct(other.id, { name: "Medialunas ajenas", price: "1" });

    const [m] = await searchCatalog(t.id, "MEDIALUNÁ");
    expect(m).toEqual({ name: "Medialunas de manteca", description: "Docena", price: "$4.800", availability: "sin stock" });
    expect(Object.keys(m)).toEqual(["name", "description", "price", "availability"]);
    expect((await searchCatalog(t.id, "medialuna")).map((h) => h.name)).toEqual(["Medialunas de manteca"]);
    expect(await searchCatalog(t.id, "pan campo")).toEqual([
      { name: "Pan de campo", description: "", price: "$2.500", availability: "disponible" },
    ]);
    expect(await searchCatalog(t.id, "torta")).toEqual([]);
    expect((await searchCatalog(t.id, "")).map((h) => h.name).sort()).toEqual(["Medialunas de manteca", "Pan de campo"]);
  });
});
