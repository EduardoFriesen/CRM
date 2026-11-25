import { and, desc, eq, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { routerExamples, type RouterExampleRow } from "@/db/schema";
import { plain } from "@/lib/plain";
import { fail, ok, type Result } from "@/lib/result";

/** Cheap functions a shortcut may point to: their answer never depends on the message's words. */
export const LEARNABLE = ["hours", "location", "payment_methods", "shipping", "greeting", "farewell", "catalog", "order_status", "learned"] as const;
export type Learnable = (typeof LEARNABLE)[number];

export type RouterExample = { id: string; text: string; fn: Learnable; factId: string | null; createdAt: Date };

const MAX_WORDS = 12;
const MAX_PER_TENANT = 200;
const MAX_TEXT = 200;
const NOT_FOUND = "No encontramos ese atajo";

/** Matching key: accent-free lowercase words, punctuation and emojis dropped. */
export function exampleKey(text: string): string {
  return plain(text)
    .replace(/[\p{P}\p{S}‍]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const isLearnable = (fn: string): fn is Learnable => (LEARNABLE as readonly string[]).includes(fn);

const toExample = (r: RouterExampleRow): RouterExample | null =>
  isLearnable(r.fn) ? { id: r.id, text: r.text, fn: r.fn, factId: r.factId, createdAt: r.createdAt } : null;

/** Saves (or replaces) a shortcut; `false` when the message is empty or too long to repeat verbatim. */
export async function saveExample(tenantId: string, e: { text: string; fn: Learnable; factId?: string | null }): Promise<boolean> {
  const key = exampleKey(e.text);
  if (!key || key.split(" ").length > MAX_WORDS) return false;
  const row = { text: e.text.trim().slice(0, MAX_TEXT), fn: e.fn, factId: e.factId ?? null };
  await withTenant(tenantId, async (tx) => {
    await tx
      .insert(routerExamples)
      .values({ tenantId, key, ...row })
      .onConflictDoUpdate({ target: [routerExamples.tenantId, routerExamples.key], set: { ...row, createdAt: sql`now()` } });
    const keep = tx
      .select({ id: routerExamples.id })
      .from(routerExamples)
      .where(eq(routerExamples.tenantId, tenantId))
      .orderBy(desc(routerExamples.createdAt))
      .limit(MAX_PER_TENANT);
    await tx.delete(routerExamples).where(and(eq(routerExamples.tenantId, tenantId), notInArray(routerExamples.id, keep)));
  });
  return true;
}

export async function findExample(tenantId: string, text: string): Promise<RouterExample | null> {
  const key = exampleKey(text);
  if (!key) return null;
  const [row] = await withTenant(tenantId, (tx) =>
    tx.select().from(routerExamples).where(and(eq(routerExamples.tenantId, tenantId), eq(routerExamples.key, key))),
  );
  return row ? toExample(row) : null;
}

export async function recentExamples(tenantId: string, limit = 20): Promise<RouterExample[]> {
  const rows = await withTenant(tenantId, (tx) =>
    tx.select().from(routerExamples).where(eq(routerExamples.tenantId, tenantId)).orderBy(desc(routerExamples.createdAt)).limit(limit),
  );
  return rows.flatMap((r) => toExample(r) ?? []);
}

export async function deleteExample(tenantId: string, id: string): Promise<Result<{ id: string }>> {
  if (!z.uuid().safeParse(id).success) return fail("NOT_FOUND", NOT_FOUND);
  const [row] = await withTenant(tenantId, (tx) =>
    tx
      .delete(routerExamples)
      .where(and(eq(routerExamples.id, id), eq(routerExamples.tenantId, tenantId)))
      .returning({ id: routerExamples.id }),
  );
  return row ? ok(row) : fail("NOT_FOUND", NOT_FOUND);
}
