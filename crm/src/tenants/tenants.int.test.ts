import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createTenant, getCurrentTenant, getTenantBySlug, listTenants, saveBoardSettings } from "@/tenants/tenants";
import { ownerSql } from "@/test/db";

const slugs: string[] = [];
const newSlug = () => {
  const s = `neg-${randomUUID().slice(0, 8)}`;
  slugs.push(s);
  return s;
};

afterAll(async () => {
  await ownerSql`delete from tenants where slug = any(${slugs})`;
  await ownerSql.end();
});

describe("createTenant", () => {
  it("rejects an invalid slug with VALIDATION and field details", async () => {
    const r = await createTenant({ slug: "Mi Negocio", name: "Mi Negocio", adminPhone: "5491122334455" });
    expect(r).toMatchObject({ success: false, error: { code: "VALIDATION", details: { slug: expect.any(Array) } } });
  });

  it("rejects a non-numeric admin phone", async () => {
    const r = await createTenant({ slug: newSlug(), name: "Pepe", adminPhone: "+54 9 11" });
    expect(r).toMatchObject({ success: false, error: { code: "VALIDATION", details: { adminPhone: expect.any(Array) } } });
  });

  it("creates a tenant and refuses the same slug twice", async () => {
    const slug = newSlug();
    const input = { slug, name: "  Panadería Pepe  ", adminPhone: "5491122334455" };
    const first = await createTenant(input);
    expect(first).toMatchObject({ success: true, data: { slug, name: "Panadería Pepe" } });
    expect(await createTenant(input)).toMatchObject({ success: false, error: { code: "SLUG_TAKEN" } });
  });
});

describe("tenant lookup", () => {
  it("lists and finds tenants by slug", async () => {
    const slug = newSlug();
    await createTenant({ slug, name: "Lookup", adminPhone: "5491122334455" });
    expect((await listTenants()).map((t) => t.slug)).toContain(slug);
    expect(await getTenantBySlug(slug)).toMatchObject({ slug, name: "Lookup" });
    expect(await getTenantBySlug("no-existe-nunca")).toBeNull();
    expect(await getTenantBySlug("../etc")).toBeNull();
  });

  it("getCurrentTenant returns the tenant or triggers notFound", async () => {
    const slug = newSlug();
    await createTenant({ slug, name: "Actual", adminPhone: "5491122334455" });
    expect(await getCurrentTenant(slug)).toMatchObject({ slug });
    await expect(getCurrentTenant("no-existe-nunca")).rejects.toMatchObject({
      digest: expect.stringContaining("404"),
    });
  });
});

describe("saveBoardSettings", () => {
  const make = async () => {
    const r = await createTenant({ slug: newSlug(), name: "Ajustes", adminPhone: "5491100000000" });
    if (!r.success) throw new Error("tenant");
    return r.data;
  };
  const days = async (id: string) =>
    (await ownerSql<{ d: number }[]>`select consulta_idle_days as d from tenants where id = ${id}`)[0].d;

  it("saves consulta_idle_days", async () => {
    const t = await make();
    expect(await saveBoardSettings(t.id, { consultaIdleDays: "3" })).toEqual({ success: true, data: { consultaIdleDays: 3 } });
    expect(await days(t.id)).toBe(3);
  });

  it("rejects 0, 31 and non-numbers with VALIDATION", async () => {
    const t = await make();
    for (const v of ["0", "31", "abc", "1.5", ""]) {
      expect(await saveBoardSettings(t.id, { consultaIdleDays: v })).toMatchObject({
        success: false,
        error: { code: "VALIDATION", details: { consultaIdleDays: ["Entre 1 y 30 días"] } },
      });
    }
    expect(await days(t.id)).toBe(1);
  });

  it("only touches its own tenant", async () => {
    const a = await make();
    const b = await make();
    await saveBoardSettings(a.id, { consultaIdleDays: "7" });
    expect(await days(b.id)).toBe(1);
  });
});
