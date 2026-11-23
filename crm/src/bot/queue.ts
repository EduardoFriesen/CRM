import { Queue } from "bullmq";

export const REPLY_QUEUE = "bot-replies";
export const DEBOUNCE_MS = 8000;
export const REMINDER_DELAY_MS = 2 * 60 * 60 * 1000;
export const CHECK_ADMIN_DELAY_MS = 10_000;
export type ReplyJob = { tenantId: string; contactId: string };
export type EscalationJob = { tenantId: string; escalationId: string };
export type CheckAdminJob = { tenantId: string; contactId: string; waMessageId: string };
// Job names: "reply" | "relay" | "remind" | "check-admin" (the worker dispatches on them).
export type BotJobData = ReplyJob | EscalationJob | CheckAdminJob;

export function redisConnection() {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is required");
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    db: Number(u.pathname.slice(1) || 0),
    // Required by BullMQ workers. The producer does not rely on it: enqueueReply has its
    // own timeout because BullMQ waits for the connection forever when Redis is down.
    maxRetriesPerRequest: null,
  };
}

let queue: Queue<BotJobData> | undefined;

const ENQUEUE_TIMEOUT_MS = 1500;

const codeOf = (e: unknown) => String((e as { code?: unknown } | null)?.code ?? (e as Error | null)?.name ?? "unknown");

export function getReplyQueue(): Queue<BotJobData> {
  if (!queue) {
    queue = new Queue<BotJobData>(REPLY_QUEUE, { connection: redisConnection() });
    // Without a listener ioredis prints full connection errors on every retry.
    queue.on("error", (e) => console.error(`reply queue error: ${codeOf(e)}`));
  }
  return queue;
}

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    const t = setTimeout(() => reject(Object.assign(new Error("Redis did not answer in time"), { code: "REDIS_TIMEOUT" })), ms);
    t.unref();
  });
}

export async function closeReplyQueue(): Promise<void> {
  await queue?.close();
  queue = undefined;
}

// Debounce: messages from the same contact within DEBOUNCE_MS collapse into one delayed
// job (replace resets the delay). keepLastIfActive queues one follow-up if the contact
// writes while a reply is being generated, so two replies never run in parallel.
export async function enqueueReply(tenantId: string, contactId: string): Promise<void> {
  const added = getReplyQueue().add(
    "reply",
    { tenantId, contactId },
    {
      delay: DEBOUNCE_MS,
      deduplication: { id: `reply:${tenantId}:${contactId}`, replace: true, keepLastIfActive: true },
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    },
  );
  added.catch(() => {}); // a late rejection after the timeout is already reported
  await Promise.race([added, timeout(ENQUEUE_TIMEOUT_MS)]);
}

async function addWithTimeout(promise: Promise<unknown>): Promise<void> {
  promise.catch(() => {});
  await Promise.race([promise, timeout(ENQUEUE_TIMEOUT_MS)]);
}

// One reminder per escalation, 2 h later (the worker sends it only if still pending).
export async function enqueueReminder(tenantId: string, escalationId: string): Promise<void> {
  await addWithTimeout(
    getReplyQueue().add("remind", { tenantId, escalationId }, {
      delay: REMINDER_DELAY_MS,
      jobId: `remind-${escalationId}`,
      removeOnComplete: 1000,
      removeOnFail: 1000,
    }),
  );
}

// Sends the admin's answer to the customer; one job per escalation.
export async function enqueueRelay(tenantId: string, escalationId: string): Promise<void> {
  await addWithTimeout(
    getReplyQueue().add("relay", { tenantId, escalationId }, {
      jobId: `relay-${escalationId}`,
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    }),
  );
}

// 10 s later, a fromMe message still authored "admin" was typed by a person (the bot
// claims its own messages by id), so the chat gets paused.
export async function enqueueCheckAdmin(tenantId: string, contactId: string, waMessageId: string): Promise<void> {
  await addWithTimeout(
    getReplyQueue().add("check-admin", { tenantId, contactId, waMessageId }, {
      delay: CHECK_ADMIN_DELAY_MS,
      removeOnComplete: 1000,
      removeOnFail: 1000,
    }),
  );
}
