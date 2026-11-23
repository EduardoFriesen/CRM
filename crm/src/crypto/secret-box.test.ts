import { afterEach, describe, expect, it, vi } from "vitest";
import { decrypt, encrypt } from "@/crypto/secret-box";

afterEach(() => vi.unstubAllEnvs());

describe("secret box", () => {
  it("round-trips a value", () => expect(decrypt(encrypt("sk-test-123"))).toBe("sk-test-123"));

  it("uses a fresh IV every time", () => expect(encrypt("same")).not.toBe(encrypt("same")));

  it("rejects a tampered blob", () => {
    const raw = Buffer.from(encrypt("sk-test-123"), "base64");
    raw[raw.length - 1] ^= 1;
    expect(() => decrypt(raw.toString("base64"))).toThrow();
  });

  it("refuses a master key that is not 64 hex chars", () => {
    vi.stubEnv("CRM_ENCRYPTION_KEY", "abc");
    expect(() => encrypt("x")).toThrow(/CRM_ENCRYPTION_KEY/);
  });
});
