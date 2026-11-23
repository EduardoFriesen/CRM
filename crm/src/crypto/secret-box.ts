import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM. Blob = base64(iv[12] | tag[16] | ciphertext). Used for tenants' AI API keys.
const IV = 12;
const TAG = 16;

function masterKey(): Buffer {
  const hex = process.env.CRM_ENCRYPTION_KEY ?? "";
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error("CRM_ENCRYPTION_KEY must be 64 hex characters");
  return Buffer.from(hex, "hex");
}

export function encrypt(plain: string): string {
  const iv = randomBytes(IV);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decrypt(blob: string): string {
  const raw = Buffer.from(blob, "base64");
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), raw.subarray(0, IV));
  decipher.setAuthTag(raw.subarray(IV, IV + TAG));
  return Buffer.concat([decipher.update(raw.subarray(IV + TAG)), decipher.final()]).toString("utf8");
}
