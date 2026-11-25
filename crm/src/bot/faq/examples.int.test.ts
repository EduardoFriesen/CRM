import { afterAll, describe, expect, it } from "vitest";
import { withTenant } from "@/db/client";
import { routerExamples } from "@/db/schema";
import { dropTenants, makeTenant, ownerSql } from "@/test/db";
import { deleteExample, findExample, recentExamples, saveExample } from "./examples";

afterAll(async () => {
  await dropTenants();
  await ownerSql.end();
});

describe("router examples", () => {
  it("saves and finds by normalized text", async () => {
    const t = await makeTenant();
    expect(await saveExample(t.id, { text: "A qué hora abren?", fn: "hours" })).toBe(true);
    expect(await findExample(t.id, "a que hora abren")).toMatchObject({ text: "A qué hora abren?", fn: "hours", factId: null });
    expect(await findExample(t.id, "a que hora cierran")).toBeNull();
  });

  it("the last mark wins for the same text", async () => {
    const t = await makeTenant();
    await saveExample(t.id, { text: "donde estan", fn: "hours" });
    await saveExample(t.id, { text: "Dónde están?", fn: "location" });
    const rows = await ownerSql`select fn from router_examples where tenant_id = ${t.id}`;
    expect(rows.map((r) => r.fn)).toEqual(["location"]);
  });

  it("does not save long or empty messages", async () => {
    const t = await makeTenant();
    expect(await saveExample(t.id, { text: "uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece", fn: "hours" })).toBe(false);
    expect(await saveExample(t.id, { text: "👍", fn: "greeting" })).toBe(false);
    expect(await recentExamples(t.id)).toEqual([]);
  });

  it("keeps at most 200 per tenant, dropping the oldest", async () => {
    const t = await makeTenant();
    await ownerSql`insert into router_examples (tenant_id, key, text, fn, created_at)
      select ${t.id}, 'k' || i, 'k' || i, 'hours', now() - make_interval(mins => 300 - i) from generate_series(1, 200) i`;
    await saveExample(t.id, { text: "nuevo", fn: "hours" });
    const [{ n }] = await ownerSql`select count(*)::int as n from router_examples where tenant_id = ${t.id}`;
    expect(n).toBe(200);
    expect(await findExample(t.id, "k1")).toBeNull();
    expect(await findExample(t.id, "nuevo")).not.toBeNull();
  });

  it("recentExamples returns the newest first, up to the limit", async () => {
    const t = await makeTenant();
    await ownerSql`insert into router_examples (tenant_id, key, text, fn, created_at) values
      (${t.id}, 'vieja', 'vieja', 'hours', now() - interval '1 hour'), (${t.id}, 'nueva', 'nueva', 'hours', now())`;
    expect((await recentExamples(t.id, 1)).map((e) => e.text)).toEqual(["nueva"]);
  });

  it("deleting a fact deletes its examples", async () => {
    const t = await makeTenant();
    const [f] = await ownerSql<{ id: string }[]>`insert into business_facts (tenant_id, question, answer) values (${t.id}, 'q', 'a') returning id`;
    await saveExample(t.id, { text: "hacen factura", fn: "learned", factId: f.id });
    await ownerSql`delete from business_facts where id = ${f.id}`;
    expect(await findExample(t.id, "hacen factura")).toBeNull();
  });

  it("is private to each tenant", async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    await saveExample(a.id, { text: "horario", fn: "hours" });
    expect(await findExample(b.id, "horario")).toBeNull();
    expect(await withTenant(b.id, (tx) => tx.select().from(routerExamples))).toEqual([]);
  });

  it("deleteExample removes one of the tenant's examples and rejects others", async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    await saveExample(a.id, { text: "horario", fn: "hours" });
    const ex = await findExample(a.id, "horario");
    expect(await deleteExample(b.id, ex!.id)).toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
    expect(await deleteExample(a.id, "not-a-uuid")).toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
    expect(await deleteExample(a.id, ex!.id)).toMatchObject({ success: true });
    expect(await findExample(a.id, "horario")).toBeNull();
  });
});
