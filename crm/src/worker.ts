import { Worker, type Job } from "bullmq";
import { checkAdminPause, sendReminder } from "@/bot/admin-jobs";
import { REPLY_QUEUE, redisConnection, type BotJobData, type CheckAdminJob, type EscalationJob, type ReplyJob } from "@/bot/queue";
import { errorCode, runConversation, runRelay } from "@/bot/reply";

// Bot worker. Logs job names, ids, outcomes and durations only; never message text,
// phone numbers or keys.
async function handle(job: Job<BotJobData>): Promise<string> {
  switch (job.name) {
    case "reply": {
      const d = job.data as ReplyJob;
      return runConversation(d.tenantId, d.contactId);
    }
    case "relay": {
      const d = job.data as EscalationJob;
      return runRelay(d.tenantId, d.escalationId);
    }
    case "remind": {
      const d = job.data as EscalationJob;
      return sendReminder(d.tenantId, d.escalationId);
    }
    case "check-admin": {
      const d = job.data as CheckAdminJob;
      return checkAdminPause(d.tenantId, d.contactId, d.waMessageId);
    }
    default:
      return "unknown-job";
  }
}

const worker = new Worker<BotJobData>(
  REPLY_QUEUE,
  async (job) => {
    const started = Date.now();
    const outcome = await handle(job);
    console.log(`${job.name} job=${job.id} tenant=${job.data.tenantId} outcome=${outcome} ms=${Date.now() - started}`);
    return outcome;
  },
  { connection: redisConnection(), concurrency: 5 },
);

worker.on("failed", (job, err) => {
  console.error(`${job?.name} job=${job?.id} attempt=${job?.attemptsMade} failed: ${errorCode(err)}`);
});
worker.on("ready", () => console.log("crm-worker ready"));
worker.on("error", (err) => console.error(`crm-worker error: ${errorCode(err)}`));

const shutdown = async () => {
  await worker.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
