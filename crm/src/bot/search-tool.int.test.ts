import { afterAll, describe, expect, it } from "vitest";
import { makeTools } from "@/bot/tools";
import { dropTenants, makeTenant, ownerSql } from "@/test/db";

afterAll(async () => {
  await dropTenants();
  await ownerSql.end();
});

const run = (tenantId: string, query: string) =>
  makeTools(tenantId, "", { dryRun: true }).search_catalog.execute!({ query }, { toolCallId: "t", messages: [], context: {} });

describe("search_catalog tool", () => {
  it("returns the whole catalog with a note when a generic word matches nothing", async () => {
    const t = await makeTenant();
    await ownerSql`insert into products (tenant_id, name, description, price) values
      (${t.id}, 'Kikuyo', 'se vende por metro cuadrado', 10000), (${t.id}, 'Gramilla', 'se vende por metro cuadrado', 8000)`;
    const r = (await run(t.id, "cesped")) as { products: { name: string }[]; note?: string };
    expect(r.products.map((p) => p.name)).toEqual(["Gramilla", "Kikuyo"]);
    expect(r.note).toBe('Ningún producto coincide con "cesped". Este es el catálogo completo: respondé con lo que hay.');
  });

  it("returns only the matches, without a note, when something matches", async () => {
    const t = await makeTenant();
    await ownerSql`insert into products (tenant_id, name, price) values (${t.id}, 'Kikuyo', 10000), (${t.id}, 'Gramilla', 8000)`;
    expect(await run(t.id, "kikuyo")).toEqual({ products: [expect.objectContaining({ name: "Kikuyo" })] });
  });

  it("says the catalog is empty when there are no products", async () => {
    const t = await makeTenant();
    expect(await run(t.id, "cesped")).toEqual({ products: [] });
  });
});
