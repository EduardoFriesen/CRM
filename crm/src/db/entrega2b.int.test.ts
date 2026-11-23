import { afterAll, describe, expect, it } from "vitest";
import { getDb, withTenant } from "@/db/client";
import { agentConfigs, businessFacts, escalations, tenants } from "@/db/schema";
import { eq } from "drizzle-orm";
import { dropTenants, makeContact, makeTenant, ownerSql } from "@/test/db";

afterAll(async () => {
  await dropTenants();
  await ownerSql.end();
});

const agent = (tenantId: string) => ({
  tenantId,
  agentName: "Sofi",
  provider: "anthropic" as const,
  model: "m",
  apiKeyEnc: "x",
  apiKeyLast4: "1234",
});

describe("entrega 2b schema", () => {
  it("isolates escalations and learned facts per tenant", async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    const cb = await makeContact(b.id);
    await withTenant(b.id, (tx) =>
      tx.insert(escalations).values({ tenantId: b.id, contactId: cb.id, question: "¿Envíos?", isPrice: false, adminMessageId: "A1" }),
    );
    await withTenant(b.id, (tx) => tx.insert(businessFacts).values({ tenantId: b.id, question: "¿Envíos?", answer: "Sí" }));
    expect(await withTenant(a.id, (tx) => tx.select().from(escalations))).toEqual([]);
    expect(await withTenant(a.id, (tx) => tx.select().from(businessFacts))).toEqual([]);
  });

  it("lets the app edit only the admin phone of a tenant", async () => {
    const a = await makeTenant();
    await getDb().update(tenants).set({ adminPhone: "5491199999999" }).where(eq(tenants.id, a.id));
    await expect(getDb().update(tenants).set({ name: "otro" }).where(eq(tenants.id, a.id))).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/permission denied/) },
    });
  });

  it("defaults the pause to 12 hours and rejects 0", async () => {
    const a = await makeTenant();
    const [row] = await withTenant(a.id, (tx) => tx.insert(agentConfigs).values(agent(a.id)).returning());
    expect(row.pauseHours).toBe(12);
    await expect(
      withTenant(a.id, (tx) => tx.update(agentConfigs).set({ pauseHours: 0 }).where(eq(agentConfigs.tenantId, a.id))),
    ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/check constraint/) } });
  });

  it("starts contacts unpaused", async () => {
    const a = await makeTenant();
    const c = await makeContact(a.id);
    const [row] = await ownerSql<{ bot_paused_until: Date | null }[]>`select bot_paused_until from contacts where id = ${c.id}`;
    expect(row.bot_paused_until).toBeNull();
  });
});
