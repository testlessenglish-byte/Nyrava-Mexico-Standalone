// AES-256-GCM encryption for user-supplied AI provider keys.
// Uses AI_PROVIDER_ENCRYPTION_KEY (32-byte hex or base64). Ciphertext format:
//   base64(iv[12] || authTag[16] || ciphertext)
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function loadKey(): Buffer {
  const raw = process.env.AI_PROVIDER_ENCRYPTION_KEY;
  if (!raw) throw new Error("AI_PROVIDER_ENCRYPTION_KEY is not configured");
  // Accept 64-char hex, 44-char base64 (32-byte), or fallback to sha256(raw).
  try {
    if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
    const b = Buffer.from(raw, "base64");
    if (b.length === 32) return b;
  } catch { /* ignore */ }
  return createHash("sha256").update(raw).digest();
}

export function encryptKey(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptKey(ciphertext: string): string {
  const key = loadKey();
  const buf = Buffer.from(ciphertext, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString("utf8");
}

export function keyFingerprint(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex").slice(0, 16);
}

export function maskKey(plaintext: string): string {
  if (!plaintext) return "";
  if (plaintext.length <= 10) return "•".repeat(plaintext.length);
  return `${plaintext.slice(0, 4)}…${plaintext.slice(-4)}`;
}
