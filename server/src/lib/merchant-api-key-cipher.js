import crypto from "crypto";
import { env } from "../config/env.js";

/**
 * @returns {Buffer} 32-byte AES key
 */
function getKey32() {
  const raw = env.encryptionKey?.replace(/^0x/i, "");
  if (raw && /^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  return crypto.createHash("sha256").update(env.jwtSecret, "utf8").digest();
}

/**
 * @param {string} plain
 * @returns {string} base64(iv 12 + tag 16 + ciphertext)
 */
export function encryptMerchantApiKey(plain) {
  const key = getKey32();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([
    cipher.update(String(plain), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

/**
 * @param {string} blob
 * @returns {string}
 */
export function decryptMerchantApiKey(blob) {
  const buf = Buffer.from(String(blob), "base64");
  if (buf.length < 12 + 16 + 1) {
    throw new Error("invalid cipher blob");
  }
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const key = getKey32();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString(
    "utf8",
  );
}
