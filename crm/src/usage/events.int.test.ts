import { afterAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { getDb, withTenant } from "@/db/client";
import { botEvents } from "@/db/schema";
import { recordBotEvent, type BotEvent } from "@/usage/events";
import { dropTenants, makeContact, makeTenant, ownerSql } from "@/test/db";

afterAll(async () => {
  await dropTenants();
  await ownerSql.end();
});

const event = (contactId: string): BotEvent => ({
  contactId,
  path: "faq",
  fn: "hours",
  model: null,
  routerModel: "small-1",
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
  routerInputTokens: 120,
  routerOutputTokens: 8,
  latencyMs: 250,
  outcome: "answered",
});

describe("recordBotEvent", () => {
  it("records one row", async () => {
    const t = await makeTenant();
    const c = await makeContact(t.id);
    await recordBotEvent(t.id, event(c.id));
    const rows = await ownerSql`select * from bot_events where tenant_id = ${t.id}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      contact_id: c.id,
      path: "faq",
      fn: "hours",
      model: null,
      router_model: "small-1",
      router_input_tokens: 120,
      router_output_tokens: 8,
      latency_ms: 250,
      outcome: "answered",
    });
  });

  it("is private to each tenant", async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    const ca = await makeContact(a.id);
    await recordBotEvent(a.id, event(ca.id));
    const cb = await makeContact(b.id);
    await recordBotEvent(b.id, event(cb.id));
    const seen = await withTenant(a.id, (tx) => tx.select().from(botEvents));
    expect(seen.map((r) => r.contactId)).toEqual([ca.id]);
    expect(await getDb().select().from(botEvents)).toEqual([]);
  });

  it("swallows failures", async () => {
    const t = await makeTenant();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(recordBotEvent(t.id, event(randomUUID()))).resolves.toBeUndefined();
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0][0])).toMatch(/^bot event failed: \S+$/);
    err.mockRestore();
    expect(await ownerSql`select 1 from bot_events where tenant_id = ${t.id}`).toHaveLength(0);
  });
});
