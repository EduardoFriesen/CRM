import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb, withTenant } from "@/db/client";
import { contacts } from "@/db/schema";
import { dropTenants, makeContact, makeInstance, makeTenant, ownerSql } from "@/test/db";

afterAll(async () => {
  await dropTenants();
  await ownerSql.end();
});

describe("tenant row-level security", () => {
  it("withTenant only sees the current tenant's rows", async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    const ca = await makeContact(a.id);
    await makeContact(b.id);
    const rows = await withTenant(a.id, (tx) => tx.select().from(contacts));
    expect(rows.map((r) => r.id)).toEqual([ca.id]);
  });

  it("sees nothing without a tenant context", async () => {
    const a = await makeTenant();
    await makeContact(a.id);
    expect(await getDb().select().from(contacts)).toEqual([]);
  });

  it("rejects inserting a row for another tenant", async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    await expect(
      withTenant(a.id, (tx) => tx.insert(contacts).values({ tenantId: b.id, jid: "x@s.whatsapp.net" })),
    ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/row-level security/) } });
  });

  it("resolve_instance finds the tenant of an instance before any tenant context", async () => {
    const a = await makeTenant();
    await makeInstance(a.id, a.slug, "hash-a");
    const rows = await getDb().execute<{ tenant_id: string; secret_hash: string }>(
      sql`select * from resolve_instance(${a.slug})`,
    );
    expect([...rows]).toEqual([{ tenant_id: a.id, secret_hash: "hash-a" }]);
  });

  it("app role cannot delete rows", async () => {
    const a = await makeTenant();
    await makeContact(a.id);
    await expect(withTenant(a.id, (tx) => tx.delete(contacts))).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/permission denied/) },
    });
  });
});
