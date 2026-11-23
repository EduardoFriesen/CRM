import { afterAll, describe, expect, it } from "vitest";
import { closeReplyQueue, enqueueReply, getReplyQueue } from "@/bot/queue";

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
});
