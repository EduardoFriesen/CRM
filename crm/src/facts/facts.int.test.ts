import { afterAll, describe, expect, it } from "vitest";
import { getAgentView, saveAgentConfig } from "@/agent/config";
import { reactivateBot } from "@/contacts/contacts";
import { deleteFact, listFacts, listPendingEscalations, updateFact } from "@/facts/facts";
import { dropTenants, makeContact, makeTenant, ownerSql } from "@/test/db";

afterAll(async () => {
  await dropTenants();
  await ownerSql.end();
});

const fact = async (tenantId: string) => {
  const [f] = await ownerSql<{ id: string }[]>`
    insert into business_facts (tenant_id, question, answer) values (${tenantId}, '¿Envíos?', 'Sí, los martes') returning id`;
  return f.id;
};

describe("learned facts", () => {
  it("lists, edits and deletes a tenant's facts", async () => {
    const t = await makeTenant();
    const id = await fact(t.id);
    expect((await listFacts(t.id)).map((f) => f.answer)).toEqual(["Sí, los martes"]);
    expect(await updateFact(t.id, id, { question: "¿Envíos?", answer: "Sí, martes y jueves" })).toMatchObject({
      success: true,
      data: { answer: "Sí, martes y jueves" },
    });
    expect(await deleteFact(t.id, id)).toEqual({ success: true, data: { id } });
    expect(await listFacts(t.id)).toEqual([]);
  });

  it("refuses to store a price through an edit", async () => {
    const t = await makeTenant();
    const id = await fact(t.id);
    expect(await updateFact(t.id, id, { question: "¿Envíos?", answer: "Sí, $500" })).toMatchObject({
      success: false,
      error: { code: "VALIDATION", message: "Los precios van en el catálogo" },
    });
  });

  it("returns NOT_FOUND for another tenant's fact", async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    const id = await fact(b.id);
    expect(await updateFact(a.id, id, { question: "x", answer: "y" })).toMatchObject({ error: { code: "NOT_FOUND" } });
    expect(await deleteFact(a.id, id)).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it("lists pending questions with the customer's name", async () => {
    const t = await makeTenant();
    const c = await makeContact(t.id, { name: "Ana" });
    await ownerSql`insert into escalations (tenant_id, contact_id, question, is_price, admin_message_id)
      values (${t.id}, ${c.id}, '¿Abren el domingo?', false, 'P1')`;
    expect(await listPendingEscalations(t.id)).toEqual([
      expect.objectContaining({ question: "¿Abren el domingo?", contactName: "Ana" }),
    ]);
  });
});

describe("reactivateBot", () => {
  it("clears the pause, only for the tenant's own contacts", async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    const ca = await makeContact(a.id);
    const cb = await makeContact(b.id);
    await ownerSql`update contacts set bot_paused_until = now() + interval '1 hour' where id in (${ca.id}, ${cb.id})`;
    expect(await reactivateBot(a.id, ca.id)).toEqual({ success: true, data: { id: ca.id } });
    expect(await reactivateBot(a.id, cb.id)).toMatchObject({ error: { code: "NOT_FOUND" } });
    const rows = await ownerSql<{ id: string; p: Date | null }[]>`select id, bot_paused_until as p from contacts where id in (${ca.id}, ${cb.id})`;
    expect(rows.find((r) => r.id === ca.id)?.p).toBeNull();
    expect(rows.find((r) => r.id === cb.id)?.p).not.toBeNull();
  });
});

describe("agent settings for 2b", () => {
  it("saves the pause length and the admin's WhatsApp", async () => {
    const t = await makeTenant();
    const r = await saveAgentConfig(
      t.id,
      { agentName: "Sofi", provider: "anthropic", model: "m", apiKey: "sk-1234", pauseHours: "6", adminPhone: "5491199999999" },
      async () => "valid",
    );
    expect(r).toMatchObject({ success: true, data: { pauseHours: 6, adminPhone: "5491199999999" } });
    expect((await getAgentView(t.id))?.adminPhone).toBe("5491199999999");
  });

  it("rejects an invalid admin phone and an out-of-range pause", async () => {
    const t = await makeTenant();
    const r = await saveAgentConfig(
      t.id,
      { agentName: "Sofi", provider: "anthropic", model: "m", apiKey: "sk-1234", pauseHours: "0", adminPhone: "+54 11" },
      async () => "valid",
    );
    expect(r).toMatchObject({ success: false, error: { code: "VALIDATION", details: { pauseHours: expect.any(Array), adminPhone: expect.any(Array) } } });
  });
});
