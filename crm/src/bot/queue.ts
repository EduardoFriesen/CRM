import { Queue } from "bullmq";

export const REPLY_QUEUE = "bot-replies";
export const DEBOUNCE_MS = 8000;
export type ReplyJob = { tenantId: string; contactId: string };

export function redisConnection() {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is required");
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    db: Number(u.pathname.slice(1) || 0),
    // BullMQ workers need this; harmless for the producer.
    maxRetriesPerRequest: null,
  };
}

let queue: Queue<ReplyJob> | undefined;

export function getReplyQueue(): Queue<ReplyJob> {
  queue ??= new Queue<ReplyJob>(REPLY_QUEUE, { connection: redisConnection() });
  return queue;
}

export async function closeReplyQueue(): Promise<void> {
  await queue?.close();
  queue = undefined;
}

// Debounce: messages from the same contact within DEBOUNCE_MS collapse into one delayed
// job (replace resets the delay). keepLastIfActive queues one follow-up if the contact
// writes while a reply is being generated, so two replies never run in parallel.
export async function enqueueReply(tenantId: string, contactId: string): Promise<void> {
  await getReplyQueue().add(
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
}
