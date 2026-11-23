import { and, desc, eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { businessFacts, contacts, escalations } from "@/db/schema";
import { notifyAdmin, relayConfirmText } from "@/bot/admin-messages";
import { mentionsMoney } from "@/bot/money-guard";
import { enqueueRelay } from "@/bot/queue";

// Learned answers for the bot prompt, newest first (the prompt caps the total size).
export function recentFacts(tenantId: string): Promise<{ question: string; answer: string }[]> {
  return withTenant(tenantId, (tx) =>
    tx
      .select({ question: businessFacts.question, answer: businessFacts.answer })
      .from(businessFacts)
      .orderBy(desc(businessFacts.updatedAt))
      .limit(200),
  );
}

const logCode = (what: string, e: unknown) =>
  console.error(`${what} failed: ${String((e as { code?: unknown } | null)?.code ?? (e as Error | null)?.name ?? "unknown")}`);

// The admin answered a question by quoting it. Only a still-pending question is answered
// (a second reply is ignored); price-related answers are relayed but never learned.
export async function answerEscalation(tenantId: string, quotedId: string, answer: string): Promise<"answered" | "ignored"> {
  const text = answer.trim().slice(0, 2000);
  if (!text || /^\[\w+Message\]$/.test(text)) return "ignored";
  const result = await withTenant(tenantId, async (tx) => {
    const [esc] = await tx
      .update(escalations)
      .set({ status: "answered", answer: text, answeredAt: sql`now()` })
      .where(and(eq(escalations.adminMessageId, quotedId), eq(escalations.status, "pending")))
      .returning({ id: escalations.id, question: escalations.question, isPrice: escalations.isPrice, contactId: escalations.contactId });
    if (!esc) return null;
    const price = esc.isPrice || mentionsMoney(`${esc.question} ${text}`);
    if (!price) await tx.insert(businessFacts).values({ tenantId, question: esc.question, answer: text, escalationId: esc.id });
    const [c] = await tx.select({ name: contacts.name }).from(contacts).where(eq(contacts.id, esc.contactId));
    return { id: esc.id, price, name: c?.name ?? null };
  });
  if (!result) return "ignored";
  await enqueueRelay(tenantId, result.id).catch((e) => logCode("enqueue relay", e));
  await notifyAdmin(tenantId, relayConfirmText(result.name, result.price)).catch((e) => logCode("admin confirm", e));
  return "answered";
}
