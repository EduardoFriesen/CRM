import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, withTenant } from "@/db/client";
import { contacts, messages, whatsappInstances } from "@/db/schema";
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

async function storeMessage(tenantId: string, d: Upsert): Promise<void> {
  const jid = d.key.remoteJid;
  if (isIgnoredJid(jid)) return;
  const fromMe = d.key.fromMe ?? false;
  const at = sentAt(d.messageTimestamp);

  await withTenant(tenantId, async (tx) => {
    const [contact] = await tx
      .insert(contacts)
      .values({
        tenantId,
        jid,
        phone: phoneFromJid(jid, d.key.remoteJidAlt ?? undefined),
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
      .returning({ id: contacts.id });

    await tx
      .insert(messages)
      .values({
        tenantId,
        contactId: contact.id,
        direction: fromMe ? "out" : "in",
        body: messageText(d),
        waMessageId: d.key.id,
        sentAt: at,
      })
      .onConflictDoNothing({ target: [messages.tenantId, messages.waMessageId] });
  });
}
