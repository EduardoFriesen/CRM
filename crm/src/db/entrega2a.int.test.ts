import { afterAll, describe, expect, it } from "vitest";
import { getDb, withTenant } from "@/db/client";
import { agentConfigs, products } from "@/db/schema";
import { dropTenants, makeTenant, ownerSql } from "@/test/db";

afterAll(async () => {
  await dropTenants();
  await ownerSql.end();
});

const agentRow = (tenantId: string) => ({
  tenantId,
  agentName: "Sofi",
  tone: "",
  provider: "anthropic" as const,
  model: "claude-haiku-5-5",
  apiKeyEnc: "x",
  apiKeyLast4: "1234",
});

describe("entrega 2a schema", () => {
  it("isolates products and agent configs per tenant", async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    await withTenant(b.id, (tx) => tx.insert(products).values({ tenantId: b.id, name: "Pan", price: "100" }));
    await withTenant(b.id, (tx) => tx.insert(agentConfigs).values(agentRow(b.id)));
    expect(await withTenant(a.id, (tx) => tx.select().from(products))).toEqual([]);
    expect(await withTenant(a.id, (tx) => tx.select().from(agentConfigs))).toEqual([]);
    expect(await getDb().select().from(products)).toEqual([]);
  });

  it("lets the app role delete its own products", async () => {
    const a = await makeTenant();
    await withTenant(a.id, (tx) => tx.insert(products).values({ tenantId: a.id, name: "Pan", price: "100" }));
    await withTenant(a.id, (tx) => tx.delete(products));
    expect(await withTenant(a.id, (tx) => tx.select().from(products))).toEqual([]);
  });

  it("rejects a negative price", async () => {
    const a = await makeTenant();
    await expect(
      withTenant(a.id, (tx) => tx.insert(products).values({ tenantId: a.id, name: "Pan", price: "-1" })),
    ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/check constraint/) } });
  });

  it("defaults the agent to off, unverified and disclosing it is an AI", async () => {
    const a = await makeTenant();
    const [row] = await withTenant(a.id, (tx) => tx.insert(agentConfigs).values(agentRow(a.id)).returning());
    expect(row).toMatchObject({ enabled: false, keyStatus: "unverified", discloseAi: true });
  });

  it("every message has an author consistent with its direction", async () => {
    const [bad] = await ownerSql<{ n: number }[]>`
      select count(*)::int as n from messages
      where author is null or (direction = 'in' and author <> 'customer') or (direction = 'out' and author = 'customer')`;
    expect(bad.n).toBe(0);
  });
});
