import { afterAll, describe, expect, it } from "vitest";
import { SEND_TIMEOUT_MS } from "@/whatsapp/evolution";
import { CHECK_ADMIN_DELAY_MS, closeReplyQueue, enqueueCheckAdmin, enqueueRelay, enqueueReply, getReplyQueue } from "@/bot/queue";

afterAll(async () => {
  await getReplyQueue().obliterate({ force: true });
  await closeReplyQueue();
});

describe("enqueueReply", () => {
  it("coalesces a burst of messages from one contact into a single delayed job", async () => {
    await enqueueReply("t-1", "c-1");
    await enqueueReply("t-1", "c-1");
    await enqueueReply("t-1", "c-1");
    await enqueueReply("t-1", "c-2");
    expect(await getReplyQueue().getJobCounts("delayed")).toEqual({ delayed: 2 });
  });

  it("queues each relay once and delays the admin-typing check", async () => {
    await getReplyQueue().obliterate({ force: true });
    await enqueueRelay("t-1", "esc-1");
    await enqueueRelay("t-1", "esc-1");
    await enqueueCheckAdmin("t-1", "c-1", "W1");
    expect(await getReplyQueue().getJobCounts("wait", "delayed")).toEqual({ wait: 1, delayed: 1 });
  });

  it("checks for a human only after a slow send would have timed out", () => {
    expect(CHECK_ADMIN_DELAY_MS).toBeGreaterThanOrEqual(SEND_TIMEOUT_MS * 3);
  });
});
