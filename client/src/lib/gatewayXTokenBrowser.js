/**
 * Browser-side decrypt for gateway X-Token (same wire format as `server/src/lib/gateway-x-token.js`).
 * Uses Web Crypto so the merchant API secret never leaves the browser.
 *
 * @param {string} blobBase64
 * @returns {Uint8Array}
 */
function base64ToBytes(blobBase64) {
  const trimmed = String(blobBase64).trim().replace(/\s+/g, "");
  const bin = atob(trimmed);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

/**
 * @param {string} merchantApiSecret
 * @returns {Promise<ArrayBuffer>}
 */
async function sha256Utf8(merchantApiSecret) {
  const enc = new TextEncoder();
  return crypto.subtle.digest("SHA-256", enc.encode(String(merchantApiSecret)));
}

/**
 * Decrypts a gateway X-Token blob (base64: IV 12 || tag 16 || ciphertext).
 *
 * @param {string} merchantApiSecret - merchant gateway API key / secret
 * @param {string} blobBase64 - X-Token value
 * @returns {Promise<string>} UTF-8 plaintext (canonical JSON string)
 */
export async function decryptGatewayXTokenBrowser(merchantApiSecret, blobBase64) {
  if (!crypto.subtle) {
    throw new Error("web_crypto_unavailable");
  }
  let buf;
  try {
    buf = base64ToBytes(blobBase64);
  } catch {
    throw new Error("invalid_base64");
  }
  if (buf.length < 12 + 16 + 1) {
    throw new Error("invalid_x_token_blob");
  }
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const keyMaterial = await sha256Utf8(merchantApiSecret);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyMaterial,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const ciphertextWithTag = new Uint8Array(enc.length + tag.length);
  ciphertextWithTag.set(enc, 0);
  ciphertextWithTag.set(tag, enc.length);
  let decrypted;
  try {
    decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, tagLength: 128 },
      cryptoKey,
      ciphertextWithTag,
    );
  } catch {
    throw new Error("decrypt_failed");
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(decrypted);
}
