import crypto from "crypto";

/**
 * Deterministic JSON for gateway X-Token verification (sorted object keys at every level).
 *
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJsonStringify(value) {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("canonical_json_non_finite_number");
    }
    return JSON.stringify(value);
  }
  if (t === "boolean" || t === "string") {
    return JSON.stringify(value);
  }
  if (t !== "object") {
    throw new Error("canonical_json_unsupported_type");
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJsonStringify(v)).join(",")}]`;
  }
  const keys = Object.keys(/** @type {Record<string, unknown>} */ (value)).sort();
  const parts = keys.map((k) => {
    return `${JSON.stringify(k)}:${canonicalJsonStringify(
      /** @type {Record<string, unknown>} */ (value)[k],
    )}`;
  });
  return `{${parts.join(",")}}`;
}

/**
 * @param {string} merchantApiSecret
 * @returns {Buffer} 32-byte AES-256 key
 */
export function deriveXTokenAesKey(merchantApiSecret) {
  return crypto.createHash("sha256").update(String(merchantApiSecret), "utf8").digest();
}

/**
 * @param {string} plaintextUtf8
 * @param {string} merchantApiSecret
 * @returns {string} base64(iv 12 + tag 16 + ciphertext)
 */
export function encryptGatewayXToken(plaintextUtf8, merchantApiSecret) {
  const key = deriveXTokenAesKey(merchantApiSecret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([
    cipher.update(String(plaintextUtf8), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

/**
 * @param {string} blobBase64
 * @param {string} merchantApiSecret
 * @returns {string} UTF-8 plaintext
 */
export function decryptGatewayXToken(blobBase64, merchantApiSecret) {
  const buf = Buffer.from(String(blobBase64), "base64");
  if (buf.length < 12 + 16 + 1) {
    throw new Error("invalid_x_token_blob");
  }
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const key = deriveXTokenAesKey(merchantApiSecret);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

/**
 * @param {Record<string, unknown>} body - parsed JSON body (no `api_key` for integrators)
 * @param {string} xTokenBase64
 * @param {string} merchantApiSecret
 * @returns {boolean}
 */
export function verifyGatewayBodyXToken(body, xTokenBase64, merchantApiSecret) {
  let plain;
  try {
    plain = decryptGatewayXToken(xTokenBase64, merchantApiSecret);
  } catch {
    return false;
  }
  try {
    return plain === canonicalJsonStringify(body);
  } catch {
    return false;
  }
}
