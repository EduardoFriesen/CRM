import { afterAll, describe, expect, it } from "vitest";
import { saveBusinessProfile } from "@/business/profile";
import { makeTools, type ToolOptions } from "@/bot/tools";
import { findExample } from "@/bot/faq/examples";
import { dropTenants, makeContact, makeTenant, ownerSql } from "@/test/db";

afterAll(async () => {
  await dropTenants();
  await ownerSql.end();
});

const mark = (tenantId: string, contactId: string, input: { fn: string; fact?: number }, opts: Partial<ToolOptions> = {}) =>
  makeTools(tenantId, contactId, { dryRun: false, stage: "consulta", customerText: "che cuando estan abiertos", facts: [], ...opts })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the tool validates its own input; tests pass raw values
    .mark_faq.execute!(input as any, { toolCallId: "t", messages: [], context: {} });

describe("mark_faq tool", () => {
  it("saves the customer's message as a shortcut when the function can answer", async () => {
    const t = await makeTenant();
    const c = await makeContact(t.id);
    await saveBusinessProfile(t.id, { hours: "de 8 a 20" });
    expect(await mark(t.id, c.id, { fn: "hours" })).toEqual({ ok: true });
    expect(await findExample(t.id, "che cuando estan abiertos")).toMatchObject({ fn: "hours" });
  });

  it("does not save when the function has no data", async () => {
    const t = await makeTenant();
    const c = await makeContact(t.id);
    expect(await mark(t.id, c.id, { fn: "hours" })).toEqual({ ok: true });
    expect(await findExample(t.id, "che cuando estan abiertos")).toBeNull();
  });

  it("does not save a function the stage does not allow", async () => {
    const t = await makeTenant();
    const c = await makeContact(t.id);
    await ownerSql`insert into orders (tenant_id, contact_id, delivery_date, address, total) values (${t.id}, ${c.id}, '2026-11-28', 'X', 100)`;
    await mark(t.id, c.id, { fn: "order_status" }, { stage: "consulta" });
    expect(await findExample(t.id, "che cuando estan abiertos")).toBeNull();
    await mark(t.id, c.id, { fn: "order_status" }, { stage: "postventa" });
    expect(await findExample(t.id, "che cuando estan abiertos")).toMatchObject({ fn: "order_status" });
  });

  it("maps fact n to the fact id", async () => {
    const t = await makeTenant();
    const c = await makeContact(t.id);
    const rows = await ownerSql<{ id: string }[]>`insert into business_facts (tenant_id, question, answer) values (${t.id}, 'a', 'ra'), (${t.id}, 'b', 'rb') returning id`;
    await mark(t.id, c.id, { fn: "learned", fact: 2 }, { facts: rows });
    expect(await findExample(t.id, "che cuando estan abiertos")).toMatchObject({ fn: "learned", factId: rows[1].id });
    await mark(t.id, c.id, { fn: "learned", fact: 3 }, { facts: rows, customerText: "otra cosa" });
    expect(await findExample(t.id, "otra cosa")).toBeNull();
  });

  it("saves nothing in dry run", async () => {
    const t = await makeTenant();
    await saveBusinessProfile(t.id, { hours: "de 8 a 20" });
    expect(await mark(t.id, "", { fn: "hours" }, { dryRun: true })).toEqual({ ok: true });
    expect(await findExample(t.id, "che cuando estan abiertos")).toBeNull();
  });
});
