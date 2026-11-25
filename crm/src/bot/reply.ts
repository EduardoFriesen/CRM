import { APICallError, generateText, isStepCount, RetryError, type LanguageModel, type ModelMessage, type SystemModelMessage, type ToolSet } from "ai";
import { and, desc, eq, gt, gte, max, sql } from "drizzle-orm";
import { getAgentRuntime, markKeyInvalid, recordAgentError } from "@/agent/config";
import { getBusinessProfile } from "@/business/profile";
import { createModel, isAuthError, isQuotaExhausted } from "@/agent/model";
import { withTenant } from "@/db/client";
import { contacts, escalations, messages, tenants, whatsappInstances } from "@/db/schema";
import { EvolutionError, sendText } from "@/whatsapp/evolution";
import { recentFacts } from "@/facts/facts";
import { recordUsage, type UsageDelta } from "@/usage/usage";
import { whyNotLearned } from "@/facts/facts";
import { notifyAdmin, relayConfirmText, relayFailedText } from "./admin-messages";
import { toModelMessages, type HistoryTurn } from "./history";
import { buildSystemPrompt } from "./prompt";
import { enqueueReminder } from "./queue";
import { asksForSensitiveData } from "./sensitive-guard";
import { handOff, makeTools, requestAttention } from "./tools";
import { customerBlock } from "./faq/scope";
import { answerTurn, emptyTurn, turnEvent, type TurnResult } from "./faq/turn";
import { fill } from "./faq/templates";
import { recordBotEvent } from "@/usage/events";

const HISTORY = 6;
const MAX_BOT_REPLIES_PER_HOUR = 20;
export const SAFE_HANDOFF_TEXT = "Para coordinar el pago te atiende alguien del equipo en un momento.";
const INTRO_GAP_MS = 24 * 60 * 60 * 1000;
const WHATSAPP_MAX = 1500;

export type ConversationOutcome =
  | "sent"
  | "skipped:disabled"
  | "skipped:not-customer-last"
  | "skipped:rate-limit"
  | "skipped:key-invalid"
  | "skipped:empty"
  | "skipped:model-error"
  | "skipped:paused"
  | "skipped:trivial"
  | "skipped:not-answered"
  | "skipped:quota";

// Cuts at the last sentence end (". ") or line break before the limit. A bare "." is not
// a boundary: es-AR prices use it for thousands ("$12.500").
export function truncateForWhatsApp(text: string, maxLength = WHATSAPP_MAX): string {
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const end = Math.max(cut.lastIndexOf(". ") + 1, cut.lastIndexOf("\n"));
  return end > 0 ? cut.slice(0, end).trimEnd() : cut;
}

// Usage metering must never break a reply: failures are logged and swallowed here.
export function meter(tenantId: string, delta: UsageDelta): Promise<void> {
  return recordUsage(tenantId, delta).catch((e: unknown) => {
    console.error(`usage record failed: ${errorCode(e)}`);
  });
}

export type TurnUsage = { inputTokens: number; outputTokens: number; cachedTokens: number };

// The single place the tenant's model is called: every step and its tokens are metered,
// and a failed call still counts as one request (providers count it too).
const markedWithReply = ({ steps }: { steps: { text: string; toolCalls: { toolName: string }[] }[] }) => {
  const last = steps.at(-1);
  return !!last && last.text.trim() !== "" && last.toolCalls.length > 0 && last.toolCalls.every((c) => c.toolName === "mark_faq");
};

export async function generateAgentText(
  tenantId: string,
  model: LanguageModel,
  args: { system: SystemModelMessage[]; messages: ModelMessage[]; tools: ToolSet },
): Promise<{ text: string; usage: TurnUsage }> {
  const usage: TurnUsage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
  try {
    // No SDK-level retries: BullMQ retries transient failures, and retrying a 429 here would
    // only spend more of the provider quota. Each finished step is metered as it ends, so a
    // failure in a later step doesn't lose the earlier ones.
    const result = await generateText({
      model,
      instructions: args.system,
      messages: args.messages,
      tools: args.tools,
      // A reply written next to mark_faq is final: another step would only cost a call and
      // replace it (result.text is the last step's text).
      stopWhen: [isStepCount(3), markedWithReply],
      maxRetries: 0,
      onStepFinish: (step) => {
        const delta = {
          inputTokens: step.usage.inputTokens ?? 0,
          outputTokens: step.usage.outputTokens ?? 0,
          cachedTokens: step.usage.inputTokenDetails?.cacheReadTokens ?? 0,
        };
        usage.inputTokens += delta.inputTokens;
        usage.outputTokens += delta.outputTokens;
        usage.cachedTokens += delta.cachedTokens;
        return meter(tenantId, { requests: 1, inputTokens: delta.inputTokens, outputTokens: delta.outputTokens });
      },
    });
    return { text: result.text, usage };
  } catch (e) {
    await meter(tenantId, { requests: 1 });
    throw e;
  }
}

// Once the admin was asked, the customer hears only that: models tend to answer anyway
// (an invented "no hacemos descuentos") next to the question, and the admin's answer follows.
export function withAskedReply<T extends { text: string }>(reply: T | SkipOutcome, asked: boolean, intro: { introduce: boolean; tenant: string }) {
  if (typeof reply === "string" || !asked) return reply;
  return { ...reply, text: intro.introduce ? fill("asked_intro", { tenant: intro.tenant }) : fill("asked", {}) };
}

export function errorCode(e: unknown): string {
  if (RetryError.isInstance(e)) return errorCode(e.lastError);
  if (APICallError.isInstance(e)) return `HTTP_${e.statusCode ?? "NETWORK"}`;
  if (e instanceof EvolutionError) return `EVOLUTION_${e.status}`;
  const err = e as { code?: unknown; name?: unknown } | null;
  return String(err?.code ?? err?.name ?? "UNKNOWN");
}

// Stored message → model turn: only the customer speaks as the user.
const toTurn = (m: { author: string; body: string; handoff: boolean }): HistoryTurn => ({
  role: m.author === "customer" ? "user" : "assistant",
  text: m.body,
  handoff: m.handoff,
});

async function loadConversation(tenantId: string, contactId: string, now: Date) {
  return withTenant(tenantId, async (tx) => {
    const [contact] = await tx.select().from(contacts).where(eq(contacts.id, contactId));
    const [instance] = await tx.select().from(whatsappInstances);
    const [tenant] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId));
    // After a reopen the conversation starts over: older messages are a finished one.
    const since = contact?.reopenedAt ? gte(messages.sentAt, contact.reopenedAt) : undefined;
    const recent = await tx
      .select({ author: messages.author, body: messages.body, sentAt: messages.sentAt, handoff: messages.handoff })
      .from(messages)
      .where(and(eq(messages.contactId, contactId), since))
      .orderBy(desc(messages.sentAt))
      .limit(HISTORY);
    // The cap renews each time the customer is back in Consulta.
    const capFrom = new Date(Math.max(now.getTime() - 60 * 60 * 1000, contact?.consultaSince?.getTime() ?? 0));
    const [{ botLastHour, lastBotAt }] = await tx
      .select({
        botLastHour: sql<number>`count(*) filter (where ${messages.sentAt} > ${capFrom.toISOString()}::timestamptz)`.mapWith(Number),
        // Introductions count only from the reopen; the hourly cap counts everything.
        lastBotAt: contact?.reopenedAt
          ? sql<Date | null>`max(${messages.sentAt}) filter (where ${messages.sentAt} >= ${contact.reopenedAt.toISOString()}::timestamptz)`.mapWith(messages.sentAt)
          : max(messages.sentAt),
      })
      .from(messages)
      .where(and(eq(messages.contactId, contactId), eq(messages.author, "bot"), gt(messages.sentAt, sql`now() - interval '2 days'`)));
    return { contact, instance, tenantName: tenant?.name ?? "", recent: recent.reverse(), botLastHour, lastBotAt };
  });
}

// Sends a bot message and records it. The webhook's fromMe echo may already have
// stored this id as "admin": the upsert claims it for the bot.
async function deliver(
  tenantId: string,
  contactId: string,
  to: { instance: string; jid: string },
  text: string,
  sentAt: Date,
  send: typeof sendText,
  handoff = false,
): Promise<void> {
  let sent: { id: string };
  try {
    sent = await send(to.instance, to.jid, text);
  } catch (e) {
    await recordAgentError(tenantId, errorCode(e));
    throw e;
  }
  await withTenant(tenantId, (tx) =>
    tx
      .insert(messages)
      .values({ tenantId, contactId, direction: "out", author: "bot", body: text, waMessageId: sent.id, sentAt, handoff })
      .onConflictDoUpdate({ target: [messages.tenantId, messages.waMessageId], set: { author: "bot", sentAt, handoff } }),
  );
  await withTenant(tenantId, (tx) =>
    tx.update(contacts).set({ lastMessageAt: sql`greatest(${contacts.lastMessageAt}, now())` }).where(eq(contacts.id, contactId)),
  );
  await meter(tenantId, { replies: 1 });
}

export type SkipOutcome = "skipped:key-invalid" | "skipped:model-error" | "skipped:quota";
const isSkip = (r: unknown): r is SkipOutcome => r === "skipped:key-invalid" || r === "skipped:model-error" || r === "skipped:quota";

// Records a failed model call and decides its fate: skip for good, or rethrow a transient
// failure so the queue retries.
export async function classifyModelError(tenantId: string, e: unknown): Promise<SkipOutcome> {
  if (isQuotaExhausted(e)) {
    await recordAgentError(tenantId, "QUOTA_EXCEEDED");
    return "skipped:quota";
  }
  await recordAgentError(tenantId, errorCode(e));
  if (isAuthError(e)) {
    await markKeyInvalid(tenantId);
    return "skipped:key-invalid";
  }
  // Permanent errors (bad request, unknown model…) are recorded, not retried.
  if ((APICallError.isInstance(e) && !e.isRetryable) || errorCode(e) === "OLLAMA_UNAVAILABLE") return "skipped:model-error";
  throw e;
}

async function generateOrRecord(
  tenantId: string,
  rt: Parameters<typeof createModel>[0],
  model: LanguageModel | undefined,
  args: Parameters<typeof generateAgentText>[2],
): Promise<{ text: string; usage: TurnUsage } | SkipOutcome> {
  try {
    return await generateAgentText(tenantId, model ?? (await createModel(rt)), args);
  } catch (e) {
    return classifyModelError(tenantId, e);
  }
}

async function adminWroteSince(tenantId: string, contactId: string, since: Date): Promise<boolean> {
  const [row] = await withTenant(tenantId, (tx) =>
    tx
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.contactId, contactId), eq(messages.author, "admin"), gt(messages.sentAt, since)))
      .limit(1),
  );
  return !!row;
}

// One bot turn for a contact: decides whether to answer, asks the tenant's model with
// catalog/stage tools, sends the reply over WhatsApp and records it as the bot's.
export async function runConversation(
  tenantId: string,
  contactId: string,
  deps: {
    send?: typeof sendText;
    now?: Date;
    model?: LanguageModel;
    /** null skips the router. Defaults to null when `model` is given (tests), else the tenant's router model. */
    routerModel?: LanguageModel | null;
    scheduleReminder?: (escalationId: string) => Promise<void>;
  } = {},
): Promise<ConversationOutcome> {
  const started = Date.now();
  const now = deps.now ?? new Date();
  const send = deps.send ?? sendText;
  const rt = await getAgentRuntime(tenantId);
  if (!rt || !rt.enabled || rt.keyStatus === "invalid") return "skipped:disabled";

  const conv = await loadConversation(tenantId, contactId, now);
  if (!conv.contact || !conv.instance) return "skipped:disabled";
  if (conv.contact.botOff || (conv.contact.botPausedUntil && conv.contact.botPausedUntil > now)) return "skipped:paused";
  if (conv.recent.at(-1)?.author !== "customer") return "skipped:not-customer-last";
  if (conv.botLastHour >= MAX_BOT_REPLIES_PER_HOUR) return "skipped:rate-limit";

  const introduce = rt.discloseAi && (!conv.lastBotAt || now.getTime() - conv.lastBotAt.getTime() > INTRO_GAP_MS);
  const stage = conv.contact.stage;
  let handedOff = false;
  const notify = (t: string) => notifyAdmin(tenantId, t, { send });

  const runComplex = async () => {
    let asked = false;
    const facts = await recentFacts(tenantId);
    const system = buildSystemPrompt({
      ...rt,
      business: await getBusinessProfile(tenantId),
      cache: rt.provider === "anthropic",
      tenantName: conv.tenantName,
      introduce,
      now,
      facts,
      stage,
    });
    const reply = await generateOrRecord(tenantId, rt, deps.model, {
      system,
      messages: toModelMessages(conv.recent.map(toTurn), { toolCalls: true }),
      tools: makeTools(tenantId, contactId, {
        dryRun: false,
        notify,
        scheduleReminder: deps.scheduleReminder ?? ((id) => enqueueReminder(tenantId, id)),
        pauseHours: rt.pauseHours,
        onHandoff: () => (handedOff = true),
        onAsked: () => (asked = true),
        customerText: customerBlock(conv.recent.map(toTurn)),
        stage,
        facts,
      }),
    });
    return withAskedReply(reply, asked, { introduce, tenant: conv.tenantName });
  };

  let routerModel: LanguageModel | null;
  try {
    routerModel = deps.routerModel !== undefined ? deps.routerModel : deps.model ? null : await createModel({ ...rt, model: rt.routerModel ?? rt.model });
  } catch (e) {
    return classifyModelError(tenantId, e);
  }

  const turn = await answerTurn(tenantId, {
    turns: conv.recent.map(toTurn),
    stage,
    contactId,
    introduce,
    tenantName: conv.tenantName,
    routerModel,
    runComplex,
    doHandoff: async (reason) => {
      await handOff(tenantId, contactId, reason, { notify, pauseHours: rt.pauseHours });
      handedOff = true;
    },
    doAttention: async (reason) => {
      await requestAttention(tenantId, contactId, reason, { notify });
      handedOff = true;
    },
  });
  // One metrics row per turn that got past the entry guards.
  const record = (outcome: ConversationOutcome, r: TurnResult) =>
    recordBotEvent(tenantId, turnEvent(contactId, outcome, r, r.path === "complex" ? rt.model : null, Date.now() - started)).then(() => outcome);
  if (turn.skip) return record(turn.skip, turn);
  if (turn.text === null) return record("skipped:trivial", turn);

  let text = truncateForWhatsApp(turn.text.trim());
  if (!text) return record("skipped:empty", turn);

  // The reply covers messages up to `cutoff`. If the admin wrote meanwhile, don't talk
  // over them; a customer message newer than the cutoff gets its own follow-up job.
  const cutoff = conv.recent.at(-1)!.sentAt;
  if (await adminWroteSince(tenantId, contactId, cutoff)) return record("skipped:not-customer-last", turn);

  // Never ask the customer for bank, card or identity data, whatever the model wrote: a
  // person takes over the payment instead. Templates are fixed text.
  if (turn.path === "complex" && asksForSensitiveData(text)) {
    text = SAFE_HANDOFF_TEXT;
    if (!handedOff) await handOff(tenantId, contactId, "El bot iba a pedirle datos de pago; coordiná el pago vos.", { notify, pauseHours: rt.pauseHours });
    handedOff = true;
  }

  await deliver(tenantId, contactId, { instance: conv.instance.name, jid: conv.contact.jid }, text, new Date(cutoff.getTime() + 1), send, handedOff);
  return record("sent", turn);
}

// Tells the customer what the admin answered to an escalation, in the agent's voice, then
// confirms to the admin — or tells them it couldn't, so they follow up by hand.
export async function runRelay(
  tenantId: string,
  escalationId: string,
  deps: { send?: typeof sendText; now?: Date; model?: LanguageModel } = {},
): Promise<ConversationOutcome> {
  const now = deps.now ?? new Date();
  const send = deps.send ?? sendText;
  const [esc] = await withTenant(tenantId, (tx) =>
    tx
      .select({ esc: escalations, name: contacts.name })
      .from(escalations)
      .innerJoin(contacts, eq(contacts.id, escalations.contactId))
      .where(and(eq(escalations.id, escalationId), eq(escalations.status, "answered"))),
  );
  if (!esc?.esc.answer) return "skipped:not-answered";
  const { question, answer, contactId, isPrice, isGeneral } = esc.esc;
  const tell = (text: string) => notifyAdmin(tenantId, text, { send }).catch(() => recordAgentError(tenantId, "RELAY_NOTIFY"));

  const outcome = await relayToCustomer(tenantId, contactId, question, answer, now, send, deps.model);
  if (outcome === "sent") await tell(relayConfirmText(esc.name, whyNotLearned(isPrice, isGeneral, question, answer)));
  else await tell(relayFailedText(esc.name));
  return outcome;
}

async function relayToCustomer(
  tenantId: string,
  contactId: string,
  question: string,
  answer: string,
  now: Date,
  send: typeof sendText,
  model: LanguageModel | undefined,
): Promise<ConversationOutcome> {
  const rt = await getAgentRuntime(tenantId);
  if (!rt || !rt.enabled || rt.keyStatus === "invalid") return "skipped:disabled";
  const conv = await loadConversation(tenantId, contactId, now);
  if (!conv.contact || !conv.instance) return "skipped:disabled";
  if (conv.contact.botOff || (conv.contact.botPausedUntil && conv.contact.botPausedUntil > now)) return "skipped:paused";
  if (conv.botLastHour >= MAX_BOT_REPLIES_PER_HOUR) return "skipped:rate-limit";

  const started = Date.now();
  const turn = emptyTurn("relay");
  const record = (outcome: ConversationOutcome) =>
    recordBotEvent(tenantId, turnEvent(contactId, outcome, turn, rt.model, Date.now() - started)).then(() => outcome);
  const system = buildSystemPrompt({
    ...rt,
    business: await getBusinessProfile(tenantId),
    cache: rt.provider === "anthropic",
    tenantName: conv.tenantName,
    introduce: false,
    now,
    facts: await recentFacts(tenantId),
    stage: conv.contact.stage,
  });
  // No tools here, so no tool calls in the history either.
  const history = toModelMessages(conv.recent.map(toTurn), { toolCalls: false });
  // Internal note as the last (user) turn: providers expect the conversation to end there.
  history.push({
    role: "user",
    content: `[Nota interna del equipo, no del cliente] El equipo respondió a la consulta "${question}": "${answer}". Comunicáselo al cliente con tus palabras, sin agregar datos.`,
  });

  const reply = await generateOrRecord(tenantId, rt, model, { system, messages: history, tools: {} });
  if (isSkip(reply)) return record(reply);
  turn.usage = reply.usage;
  const text = truncateForWhatsApp(reply.text.trim());
  if (!text) return record("skipped:empty");

  // Same guards as a normal reply: don't talk over an admin who wrote meanwhile, and place
  // the message right after what it saw so a customer message sent meanwhile stays last.
  const cutoff = conv.recent.at(-1)?.sentAt ?? now;
  if (await adminWroteSince(tenantId, contactId, cutoff)) return record("skipped:not-customer-last");
  await deliver(tenantId, contactId, { instance: conv.instance.name, jid: conv.contact.jid }, text, new Date(cutoff.getTime() + 1), send);
  return record("sent");
}
