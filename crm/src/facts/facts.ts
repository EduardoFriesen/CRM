import { and, asc, desc, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import { fail, ok, type Result } from "@/lib/result";
import { withTenant } from "@/db/client";
import { businessFacts, contacts, escalations, type BusinessFact } from "@/db/schema";
import { notifyAdmin, relayFailedText, type NotLearned } from "@/bot/admin-messages";
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

// Prices are never learned; neither are answers that only apply to one customer.
export function whyNotLearned(isPrice: boolean, isGeneral: boolean, question: string, answer: string): NotLearned {
  if (isPrice || mentionsMoney(`${question} ${answer}`)) return "price";
  return isGeneral ? null : "personal";
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
      .where(
        and(
          or(eq(escalations.adminMessageId, quotedId), eq(escalations.reminderMessageId, quotedId)),
          eq(escalations.status, "pending"),
        ),
      )
      .returning({
        id: escalations.id,
        question: escalations.question,
        isPrice: escalations.isPrice,
        isGeneral: escalations.isGeneral,
        contactId: escalations.contactId,
      });
    if (!esc) return null;
    if (!whyNotLearned(esc.isPrice, esc.isGeneral, esc.question, text)) await tx.insert(businessFacts).values({ tenantId, question: esc.question, answer: text, escalationId: esc.id });
    const [c] = await tx.select({ name: contacts.name }).from(contacts).where(eq(contacts.id, esc.contactId));
    return { id: esc.id, name: c?.name ?? null };
  });
  if (!result) return "ignored";
  // The relay job confirms to the admin once the customer actually got the answer.
  try {
    await enqueueRelay(tenantId, result.id);
  } catch (e) {
    logCode("enqueue relay", e);
    await notifyAdmin(tenantId, relayFailedText(result.name)).catch((err) => logCode("admin relay-failed", err));
  }
  return "answered";
}

export function listFacts(tenantId: string): Promise<BusinessFact[]> {
  return withTenant(tenantId, (tx) => tx.select().from(businessFacts).orderBy(desc(businessFacts.updatedAt)));
}

const factInput = z.object({
  question: z.string().trim().min(1, "Escribí la pregunta").max(500, "Máximo 500 caracteres"),
  answer: z.string().trim().min(1, "Escribí la respuesta").max(2000, "Máximo 2000 caracteres"),
});
const factId = z.uuid();
const NOT_FOUND = "No encontramos ese dato";

export async function updateFact(tenantId: string, id: string, input: unknown): Promise<Result<BusinessFact>> {
  if (!factId.safeParse(id).success) return fail("NOT_FOUND", NOT_FOUND);
  const parsed = factInput.safeParse(input);
  if (!parsed.success) return fail("VALIDATION", "Revisá el dato", z.flattenError(parsed.error).fieldErrors);
  // Learned answers never hold prices, not even through a manual edit.
  if (mentionsMoney(`${parsed.data.question} ${parsed.data.answer}`)) return fail("VALIDATION", "Los precios van en el catálogo");
  const [row] = await withTenant(tenantId, (tx) =>
    tx
      .update(businessFacts)
      .set({ ...parsed.data, updatedAt: sql`now()` })
      .where(and(eq(businessFacts.id, id), eq(businessFacts.tenantId, tenantId)))
      .returning(),
  );
  return row ? ok(row) : fail("NOT_FOUND", NOT_FOUND);
}

export async function deleteFact(tenantId: string, id: string): Promise<Result<{ id: string }>> {
  if (!factId.safeParse(id).success) return fail("NOT_FOUND", NOT_FOUND);
  const [row] = await withTenant(tenantId, (tx) =>
    tx
      .delete(businessFacts)
      .where(and(eq(businessFacts.id, id), eq(businessFacts.tenantId, tenantId)))
      .returning({ id: businessFacts.id }),
  );
  return row ? ok(row) : fail("NOT_FOUND", NOT_FOUND);
}

export type PendingQuestion = { id: string; question: string; contactName: string | null; createdAt: Date };

export function listPendingEscalations(tenantId: string): Promise<PendingQuestion[]> {
  return withTenant(tenantId, (tx) =>
    tx
      .select({ id: escalations.id, question: escalations.question, contactName: contacts.name, createdAt: escalations.createdAt })
      .from(escalations)
      .innerJoin(contacts, eq(contacts.id, escalations.contactId))
      .where(eq(escalations.status, "pending"))
      .orderBy(asc(escalations.createdAt)),
  );
}

export async function dismissEscalation(tenantId: string, id: string): Promise<Result<{ id: string }>> {
  if (!factId.safeParse(id).success) return fail("NOT_FOUND", "No encontramos esa consulta");
  const [row] = await withTenant(tenantId, (tx) =>
    tx
      .update(escalations)
      .set({ status: "dismissed" })
      .where(and(eq(escalations.id, id), eq(escalations.tenantId, tenantId), eq(escalations.status, "pending")))
      .returning({ id: escalations.id }),
  );
  return row ? ok(row) : fail("NOT_FOUND", "No encontramos esa consulta");
}
