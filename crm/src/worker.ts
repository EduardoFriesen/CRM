import { Worker } from "bullmq";
import { REPLY_QUEUE, redisConnection, type ReplyJob } from "@/bot/queue";
import { errorCode, runConversation } from "@/bot/reply";

// Bot worker: answers queued WhatsApp conversations. Logs ids, outcomes and durations
// only; never message text, phone numbers or keys.
const worker = new Worker<ReplyJob>(
  REPLY_QUEUE,
  async (job) => {
    const started = Date.now();
    const outcome = await runConversation(job.data.tenantId, job.data.contactId);
    console.log(`reply job=${job.id} tenant=${job.data.tenantId} outcome=${outcome} ms=${Date.now() - started}`);
    return outcome;
  },
  { connection: redisConnection(), concurrency: 5 },
);

worker.on("failed", (job, err) => {
  console.error(`reply job=${job?.id} attempt=${job?.attemptsMade} failed: ${errorCode(err)}`);
});
worker.on("ready", () => console.log("crm-worker ready"));
worker.on("error", (err) => console.error(`crm-worker error: ${errorCode(err)}`));

const shutdown = async () => {
  await worker.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
