import { describe, expect, it } from "vitest";
import { hashSecret, newWebhookSecret, verifySecret } from "@/whatsapp/secret";

describe("webhook secret", () => {
  it("generates distinct url-safe secrets of 32 bytes", () => {
    const a = newWebhookSecret();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newWebhookSecret()).not.toBe(a);
  });

  it("verifies only the matching secret", () => {
    const s = newWebhookSecret();
    const h = hashSecret(s);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(verifySecret(s, h)).toBe(true);
    expect(verifySecret(newWebhookSecret(), h)).toBe(false);
  });

  it("returns false instead of throwing on a malformed hash", () => {
    expect(verifySecret("x", "abc")).toBe(false);
  });
});
