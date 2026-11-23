import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const WEBHOOK_SECRET_HEADER = "x-crm-webhook-secret";

export const newWebhookSecret = (): string => randomBytes(32).toString("base64url");

export const hashSecret = (secret: string): string => createHash("sha256").update(secret).digest("hex");

export function verifySecret(secret: string, hash: string): boolean {
  const a = Buffer.from(hashSecret(secret), "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
