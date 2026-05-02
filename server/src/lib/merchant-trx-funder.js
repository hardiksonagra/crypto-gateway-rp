import { prisma } from "./prisma.js";
import {
  decryptMerchantApiKey,
  encryptMerchantApiKey,
} from "./merchant-api-key-cipher.js";
import { ACTIVE } from "./active-row.js";
import { createTronWebFromPrivateKeyHex } from "../services/sweep/tron-usdt-sweep.js";

/**
 * Normalize user-pasted TRON private key to 64-char hex (no 0x).
 *
 * @param {string} raw
 * @returns {string}
 */
export function normalizeTronPrivateKeyHex(raw) {
  const s = String(raw ?? "")
    .trim()
    .replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(s)) {
    const e = new Error("invalid_tron_private_key_hex");
    /** @type {any} */ (e).code = "invalid_tron_private_key_hex";
    throw e;
  }
  return s.toLowerCase();
}

/**
 * @param {string} normalizedHex
 * @returns {string} base58 TRON address
 */
export function tronAddressFromPrivateKeyHex(normalizedHex) {
  const tw = createTronWebFromPrivateKeyHex(normalizedHex);
  const b = tw.defaultAddress?.base58;
  if (typeof b !== "string" || !b.trim()) {
    throw new Error("tron_address_from_key_failed");
  }
  return b.trim();
}

/**
 * @param {number} merchantId
 * @param {import("@prisma/client").Prisma.TransactionClient | import("@prisma/client").PrismaClient} [db]
 * @returns {Promise<string | null>} hex private key, or null if not configured
 */
export async function getMerchantTrxSweepFunderPrivateKeyHex(merchantId, db = prisma) {
  const m = await db.merchant.findFirst({
    where: { id: merchantId, ...ACTIVE },
    select: { trxSweepFunderPrivateKeyCipher: true },
  });
  if (!m?.trxSweepFunderPrivateKeyCipher) return null;
  try {
    const plain = decryptMerchantApiKey(m.trxSweepFunderPrivateKeyCipher).trim();
    return normalizeTronPrivateKeyHex(plain);
  } catch {
    return null;
  }
}

/**
 * Base58 address for display (auth/me, portal). Empty if unset or invalid.
 *
 * @param {number} merchantId
 * @returns {Promise<string>}
 */
export async function getMerchantTrxSweepFunderDisplayAddress(merchantId) {
  const hex = await getMerchantTrxSweepFunderPrivateKeyHex(merchantId);
  if (!hex) return "";
  try {
    return tronAddressFromPrivateKeyHex(hex);
  } catch {
    return "";
  }
}

/**
 * Persist encrypted key; callers must validate with {@link normalizeTronPrivateKeyHex} first.
 *
 * @param {string} normalizedHex
 * @returns {string} cipher blob
 */
export function encryptMerchantTrxSweepFunderKey(normalizedHex) {
  return encryptMerchantApiKey(normalizedHex);
}
