import { and, eq, isNull, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { agentConfigs, contacts, escalations, messages } from "@/db/schema";
import type { sendText } from "@/whatsapp/evolution";
import { notifyAdmin, reminderText } from "./admin-messages";

const DEFAULT_PAUSE_HOURS = 12;

export async function checkAdminPause(
  tenantId: string,
  contactId: string,
  waMessageId: string,
): Promise<"paused" | "bot-message"> {
  return withTenant(tenantId, async (tx) => {
    const [msg] = await tx
      .select({ author: messages.author })
      .from(messages)
      .where(and(eq(messages.contactId, contactId), eq(messages.waMessageId, waMessageId)));
    if (msg?.author !== "admin") return "bot-message";
    const [cfg] = await tx.select({ hours: agentConfigs.pauseHours }).from(agentConfigs);
    const hours = cfg?.hours ?? DEFAULT_PAUSE_HOURS;
    await tx
      .update(contacts)
      .set({ botPausedUntil: sql`now() + make_interval(hours => ${hours})` })
      .where(eq(contacts.id, contactId));
    return "paused";
  });
}

export async function sendReminder(
  tenantId: string,
  escalationId: string,
  deps: { send?: typeof sendText } = {},
): Promise<"sent" | "skipped"> {
  const [esc] = await withTenant(tenantId, (tx) =>
    tx
      .select({ question: escalations.question, name: contacts.name, phone: contacts.phone })
      .from(escalations)
      .innerJoin(contacts, eq(contacts.id, escalations.contactId))
      .where(and(eq(escalations.id, escalationId), eq(escalations.status, "pending"), isNull(escalations.remindedAt))),
  );
  if (!esc) return "skipped";
  const sent = await notifyAdmin(tenantId, reminderText(esc, esc.question), deps);
  await withTenant(tenantId, (tx) =>
    tx
      .update(escalations)
      .set({ remindedAt: sql`now()`, reminderMessageId: sent.id })
      .where(eq(escalations.id, escalationId)),
  );
  return "sent";
}
