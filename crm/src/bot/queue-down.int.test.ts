import { afterAll, describe, expect, it, vi } from "vitest";

// Separate file: the queue singleton must be created against a dead Redis.
vi.stubEnv("REDIS_URL", "redis://127.0.0.1:1/2");
const { closeReplyQueue, enqueueReply } = await import("@/bot/queue");

afterAll(async () => {
  await closeReplyQueue();
  vi.unstubAllEnvs();
});

describe("enqueueReply with Redis down", () => {
  it("fails fast with REDIS_TIMEOUT instead of hanging", async () => {
    const started = Date.now();
    await expect(enqueueReply("t", "c")).rejects.toMatchObject({ code: "REDIS_TIMEOUT" });
    expect(Date.now() - started).toBeLessThan(3000);
  }, 10_000);
});
