import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { isBotActive } from "@/agent/config";
import { HINT_TEXT, notifyAdmin } from "@/bot/admin-messages";
import { enqueueCheckAdmin, enqueueReply } from "@/bot/queue";
import { answerEscalation } from "@/facts/facts";
import { getDb, withTenant } from "@/db/client";
import { agentConfigs, contacts, escalations, messages, tenants, whatsappInstances } from "@/db/schema";
import { isIgnoredJid, phoneFromJid } from "./jid";
import { verifySecret } from "./secret";

// Evolution v2.3.7 webhook payloads (webhookByEvents=false, one URL per instance).
// Only the fields we use are validated; the rest (including the instance `apikey`) is dropped
// and must never be logged.
const envelope = z.object({ event: z.string() });

const upsert = z.object({
  data: z.object({
    key: z.object({
      id: z.string().min(1).max(200),
      remoteJid: z.string().min(3).max(200),
      remoteJidAlt: z.string().max(200).nullish(),
      fromMe: z.boolean().nullish(),
    }),
    pushName: z.string().max(200).nullish(),
    message: z
      .object({
        conversation: z.string().nullish(),
        extendedTextMessage: z.object({ text: z.string().nullish() }).nullish(),
        imageMessage: z.object({ caption: z.string().nullish() }).nullish(),
        videoMessage: z.object({ caption: z.string().nullish() }).nullish(),
      })
      .nullish(),
    messageType: z.string().max(100).nullish(),
    messageTimestamp: z.union([z.number(), z.string()]).nullish(),
    // Set when the message quotes another one (stanzaId = quoted message id).
    contextInfo: z.object({ stanzaId: z.string().max(200).nullish() }).nullish(),
  }),
});

const connection = z.object({
  data: z.object({ state: z.enum(["open", "close", "connecting", "refused"]) }),
});

type Upsert = z.infer<typeof upsert>["data"];

export type WebhookOutcome = { status: 200 | 400 | 401 };

export async function handleEvolutionEvent(instance: string, secret: string | null, body: unknown): Promise<WebhookOutcome> {
  const [found] = await getDb().execute<{ tenant_id: string; secret_hash: string }>(
    sql`select tenant_id, secret_hash from resolve_instance(${instance})`,
  );
  if (!found || !secret || !verifySecret(secret, found.secret_hash)) return { status: 401 };
  const tenantId = found.tenant_id;

  const head = envelope.safeParse(body);
  if (!head.success) return { status: 400 };

  if (head.data.event === "messages.upsert") {
    const parsed = upsert.safeParse(body);
    if (!parsed.success) return { status: 400 };
    await storeMessage(tenantId, parsed.data.data);
  } else if (head.data.event === "connection.update") {
    const parsed = connection.safeParse(body);
    if (!parsed.success) return { status: 400 };
    await withTenant(tenantId, (tx) => tx.update(whatsappInstances).set({ status: parsed.data.data.state }));
  }
  return { status: 200 };
}

function messageText(d: Upsert): string {
  const m = d.message;
  return (
    m?.conversation ??
    m?.extendedTextMessage?.text ??
    m?.imageMessage?.caption ??
    m?.videoMessage?.caption ??
    `[${d.messageType ?? "unknown"}]`
  );
}

function sentAt(ts: Upsert["messageTimestamp"]): Date {
  const n = Number(ts);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date();
}

const logCode = (what: string, e: unknown) => {
  const err = e as { code?: unknown; name?: unknown } | null;
  console.error(`${what} failed: ${String(err?.code ?? err?.name ?? "unknown")}`);
};

const HINT_EVERY = "10 minutes";

// The admin's personal number is an operations channel: never a customer, never stored
// as a message, never answered by the bot. Quoted replies answer pending questions.
async function handleAdminMessage(tenantId: string, d: Upsert): Promise<void> {
  if (d.key.fromMe) return; // our own messages to the admin (questions, reminders)
  const quoted = d.contextInfo?.stanzaId;
  if (quoted) {
    await answerEscalation(tenantId, quoted, messageText(d));
    return;
  }
  const shouldHint = await withTenant(tenantId, async (tx) => {
    const [p] = await tx.select({ id: escalations.id }).from(escalations).where(eq(escalations.status, "pending")).limit(1);
    if (!p) return false;
    const claimed = await tx
      .update(agentConfigs)
      .set({ adminHintAt: sql`now()` })
      .where(sql`${agentConfigs.adminHintAt} is null or ${agentConfigs.adminHintAt} < now() - interval '${sql.raw(HINT_EVERY)}'`)
      .returning({ tenantId: agentConfigs.tenantId });
    return claimed.length > 0;
  });
  if (shouldHint) await notifyAdmin(tenantId, HINT_TEXT).catch((e) => logCode("admin hint", e));
}

async function storeMessage(tenantId: string, d: Upsert): Promise<void> {
  const jid = d.key.remoteJid;
  if (isIgnoredJid(jid)) return;
  const fromMe = d.key.fromMe ?? false;
  const at = sentAt(d.messageTimestamp);

  const phone = phoneFromJid(jid, d.key.remoteJidAlt ?? undefined);
  const [tenant] = await getDb().select({ adminPhone: tenants.adminPhone }).from(tenants).where(eq(tenants.id, tenantId));
  if (phone && phone === tenant?.adminPhone) {
    await handleAdminMessage(tenantId, d);
    return;
  }

  const contact = await withTenant(tenantId, async (tx) => {
    const [contact] = await tx
      .insert(contacts)
      .values({
        tenantId,
        jid,
        phone,
        // pushName on our own messages is the business's name, not the customer's.
        name: fromMe ? null : d.pushName || null,
        lastMessageAt: at,
      })
      .onConflictDoUpdate({
        target: [contacts.tenantId, contacts.jid],
        set: {
          phone: sql`coalesce(excluded.phone, ${contacts.phone})`,
          name: sql`coalesce(excluded.name, ${contacts.name})`,
          lastMessageAt: sql`greatest(${contacts.lastMessageAt}, excluded.last_message_at)`,
        },
      })
      .returning({ id: contacts.id, botPausedUntil: contacts.botPausedUntil });

    await tx
      .insert(messages)
      .values({
        tenantId,
        contactId: contact.id,
        direction: fromMe ? "out" : "in",
        author: fromMe ? "admin" : "customer",
        body: messageText(d),
        waMessageId: d.key.id,
        sentAt: at,
      })
      .onConflictDoNothing({ target: [messages.tenantId, messages.waMessageId] });
    return contact;
  });

  // From the business number: if it was a person (not the bot's echo), pause this chat.
  if (fromMe) {
    await enqueueCheckAdmin(tenantId, contact.id, d.key.id).catch((e) => logCode("enqueue admin check", e));
    return;
  }
  // Only customers' messages wake the bot, and only while it is on and the chat isn't
  // paused: messages that arrive meanwhile are never answered later. A queue outage must
  // not lose the message.
  if (contact.botPausedUntil && contact.botPausedUntil > new Date()) return;
  try {
    if (await isBotActive(tenantId)) await enqueueReply(tenantId, contact.id);
  } catch (e) {
    logCode("enqueue reply", e);
  }
}
