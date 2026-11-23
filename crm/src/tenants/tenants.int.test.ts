import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createTenant, getCurrentTenant, getTenantBySlug, listTenants } from "@/tenants/tenants";
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
