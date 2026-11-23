import { and, eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { aiUsage } from "@/db/schema";
import { todayInBuenosAires } from "@/orders/group";

export type UsageDelta = { requests?: number; inputTokens?: number; outputTokens?: number; replies?: number };
export type UsageToday = { requests: number; inputTokens: number; outputTokens: number; replies: number };

// Atomic increment for (tenant, day): concurrent replies never lose a count.
export async function recordUsage(tenantId: string, d: UsageDelta, now: Date = new Date()): Promise<void> {
  const row = {
    requests: d.requests ?? 0,
    inputTokens: d.inputTokens ?? 0,
    outputTokens: d.outputTokens ?? 0,
    replies: d.replies ?? 0,
  };
  await withTenant(tenantId, (tx) =>
    tx
      .insert(aiUsage)
      .values({ tenantId, day: todayInBuenosAires(now), ...row })
      .onConflictDoUpdate({
        target: [aiUsage.tenantId, aiUsage.day],
        set: {
          requests: sql`${aiUsage.requests} + excluded.requests`,
          inputTokens: sql`${aiUsage.inputTokens} + excluded.input_tokens`,
          outputTokens: sql`${aiUsage.outputTokens} + excluded.output_tokens`,
          replies: sql`${aiUsage.replies} + excluded.replies`,
        },
      }),
  );
}

export async function getUsageToday(tenantId: string, now: Date = new Date()): Promise<UsageToday> {
  const [row] = await withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(aiUsage)
      .where(and(eq(aiUsage.tenantId, tenantId), eq(aiUsage.day, todayInBuenosAires(now)))),
  );
  return {
    requests: row?.requests ?? 0,
    inputTokens: row?.inputTokens ?? 0,
    outputTokens: row?.outputTokens ?? 0,
    replies: row?.replies ?? 0,
  };
}
