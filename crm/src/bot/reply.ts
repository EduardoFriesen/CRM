import { APICallError, generateText, isStepCount, type LanguageModel, type ModelMessage, type ToolSet } from "ai";
import { and, desc, eq, gt, max, sql } from "drizzle-orm";
import { getAgentRuntime, markKeyInvalid, recordAgentError } from "@/agent/config";
import { createModel, isAuthError } from "@/agent/model";
import { withTenant } from "@/db/client";
import { contacts, messages, tenants, whatsappInstances } from "@/db/schema";
import { EvolutionError, sendText } from "@/whatsapp/evolution";
import { buildSystemPrompt } from "./prompt";
import { makeTools } from "./tools";

const HISTORY = 20;
const MAX_BOT_REPLIES_PER_HOUR = 20;
const INTRO_GAP_MS = 24 * 60 * 60 * 1000;
const WHATSAPP_MAX = 1500;

export type ConversationOutcome =
  | "sent"
  | "skipped:disabled"
  | "skipped:not-customer-last"
  | "skipped:rate-limit"
  | "skipped:key-invalid"
  | "skipped:empty";

export function truncateForWhatsApp(text: string, maxLength = WHATSAPP_MAX): string {
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const end = cut.lastIndexOf(".");
  return end > 0 ? cut.slice(0, end + 1) : cut;
}

export async function generateAgentText(
  model: LanguageModel,
  args: { system: string; messages: ModelMessage[]; tools: ToolSet },
): Promise<string> {
  const result = await generateText({ model, ...args, stopWhen: isStepCount(4), maxRetries: 1 });
  return result.text;
}

export function errorCode(e: unknown): string {
  if (APICallError.isInstance(e)) return `HTTP_${e.statusCode ?? "NETWORK"}`;
  if (e instanceof EvolutionError) return `EVOLUTION_${e.status}`;
  const err = e as { code?: unknown; name?: unknown } | null;
  return String(err?.code ?? err?.name ?? "UNKNOWN");
}

async function loadConversation(tenantId: string, contactId: string, now: Date) {
  return withTenant(tenantId, async (tx) => {
    const [contact] = await tx.select().from(contacts).where(eq(contacts.id, contactId));
    const [instance] = await tx.select().from(whatsappInstances);
    const [tenant] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId));
    const recent = await tx
      .select({ author: messages.author, body: messages.body })
      .from(messages)
      .where(eq(messages.contactId, contactId))
      .orderBy(desc(messages.sentAt))
      .limit(HISTORY);
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const [{ botLastHour, lastBotAt }] = await tx
      .select({
        botLastHour: sql<number>`count(*) filter (where ${messages.sentAt} > ${hourAgo.toISOString()}::timestamptz)`.mapWith(Number),
        lastBotAt: max(messages.sentAt),
      })
      .from(messages)
      .where(and(eq(messages.contactId, contactId), eq(messages.author, "bot"), gt(messages.sentAt, sql`now() - interval '2 days'`)));
    return { contact, instance, tenantName: tenant?.name ?? "", recent: recent.reverse(), botLastHour, lastBotAt };
  });
}

// One bot turn for a contact: decides whether to answer, asks the tenant's model with
// catalog/stage tools, sends the reply over WhatsApp and records it as the bot's.
export async function runConversation(
  tenantId: string,
  contactId: string,
  deps: { send?: typeof sendText; now?: Date; model?: LanguageModel } = {},
): Promise<ConversationOutcome> {
  const now = deps.now ?? new Date();
  const send = deps.send ?? sendText;
  const rt = await getAgentRuntime(tenantId);
  if (!rt || !rt.enabled || rt.keyStatus === "invalid") return "skipped:disabled";

  const conv = await loadConversation(tenantId, contactId, now);
  if (!conv.contact || !conv.instance) return "skipped:disabled";
  if (conv.recent.at(-1)?.author !== "customer") return "skipped:not-customer-last";
  if (conv.botLastHour >= MAX_BOT_REPLIES_PER_HOUR) return "skipped:rate-limit";

  const introduce = rt.discloseAi && (!conv.lastBotAt || now.getTime() - conv.lastBotAt.getTime() > INTRO_GAP_MS);
  const system = buildSystemPrompt({ ...rt, tenantName: conv.tenantName, introduce, now });
  const history: ModelMessage[] = conv.recent.map((m) => ({
    role: m.author === "customer" ? "user" : "assistant",
    content: m.body,
  }));

  let reply: string;
  try {
    const model = deps.model ?? (await createModel(rt));
    reply = await generateAgentText(model, { system, messages: history, tools: makeTools(tenantId, contactId, { dryRun: false }) });
  } catch (e) {
    await recordAgentError(tenantId, errorCode(e));
    if (isAuthError(e)) {
      await markKeyInvalid(tenantId);
      return "skipped:key-invalid";
    }
    throw e;
  }

  const text = truncateForWhatsApp(reply.trim());
  if (!text) return "skipped:empty";

  let sent: { id: string };
  try {
    sent = await send(conv.instance.name, conv.contact.jid, text);
  } catch (e) {
    await recordAgentError(tenantId, errorCode(e));
    throw e;
  }

  // The webhook's fromMe echo may already have stored this id as "admin": claim it.
  await withTenant(tenantId, (tx) =>
    tx
      .insert(messages)
      .values({
        tenantId,
        contactId,
        direction: "out",
        author: "bot",
        body: text,
        waMessageId: sent.id,
        sentAt: new Date(),
      })
      .onConflictDoUpdate({ target: [messages.tenantId, messages.waMessageId], set: { author: "bot" } }),
  );
  await withTenant(tenantId, (tx) =>
    tx.update(contacts).set({ lastMessageAt: sql`greatest(${contacts.lastMessageAt}, now())` }).where(eq(contacts.id, contactId)),
  );
  return "sent";
}
