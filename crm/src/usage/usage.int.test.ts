import { afterAll, describe, expect, it } from "vitest";
import { getUsageToday, recordUsage } from "@/usage/usage";
import { dropTenants, makeTenant, ownerSql } from "@/test/db";

afterAll(async () => {
  await dropTenants();
  await ownerSql.end();
});

describe("AI usage", () => {
  it("adds up what each call reports", async () => {
    const t = await makeTenant();
    await recordUsage(t.id, { requests: 2, inputTokens: 100, outputTokens: 20, replies: 1 });
    await recordUsage(t.id, { requests: 1, inputTokens: 50 });
    expect(await getUsageToday(t.id)).toEqual({ requests: 3, inputTokens: 150, outputTokens: 20, replies: 1 });
  });

  it("never loses an increment under concurrency", async () => {
    const t = await makeTenant();
    await Promise.all(Array.from({ length: 20 }, () => recordUsage(t.id, { requests: 1 })));
    expect((await getUsageToday(t.id)).requests).toBe(20);
  });

  it("counts by the Buenos Aires calendar day", async () => {
    const t = await makeTenant();
    const lateNight = new Date("2026-11-25T02:30:00Z"); // 23:30 on the 24th in Buenos Aires
    await recordUsage(t.id, { requests: 1 }, lateNight);
    const [row] = await ownerSql<{ day: string }[]>`select to_char(day, 'YYYY-MM-DD') as day from ai_usage where tenant_id = ${t.id}`;
    expect(row.day).toBe("2026-11-24");
    expect((await getUsageToday(t.id, lateNight)).requests).toBe(1);
  });

  it("starts at zero and is private to each tenant", async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    await recordUsage(b.id, { requests: 5 });
    expect(await getUsageToday(a.id)).toEqual({ requests: 0, inputTokens: 0, outputTokens: 0, replies: 0 });
  });
});
