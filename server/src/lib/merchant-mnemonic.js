import * as bip39 from "bip39";
import { prisma } from "./prisma.js";
import { env } from "../config/env.js";
import {
  decryptMerchantApiKey,
  encryptMerchantApiKey,
} from "./merchant-api-key-cipher.js";
import { ACTIVE } from "./active-row.js";

/**
 * Normalize BIP39 input (trim, BOM, collapse whitespace, lowercase words).
 * @param {string} raw
 * @returns {string}
 */
export function normalizeMnemonicPhrase(raw) {
  return String(raw ?? "")
    .trim()
    .replace(/^\uFEFF/, "")
    .replace(/\uFEFF/g, "")
    .replace(/\u200B/g, "")
    .replace(/\u00a0/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/**
 * @param {string} raw
 * @returns {string} normalized phrase
 */
export function assertValidMnemonicPhrase(raw) {
  const n = normalizeMnemonicPhrase(raw);
  if (!bip39.validateMnemonic(n)) {
    const e = new Error("invalid_mnemonic");
    /** @type {any} */ (e).code = "invalid_mnemonic";
    throw e;
  }
  return n;
}

/**
 * @param {string} normalizedPhrase
 * @returns {string} base64 cipher blob
 */
export function encryptMerchantMnemonic(normalizedPhrase) {
  return encryptMerchantApiKey(normalizedPhrase);
}

/**
 * HD root for a merchant’s deposit wallets: DB cipher, else legacy `MNEMONIC` env for rows without cipher.
 *
 * @param {number} merchantId
 * @param {import("@prisma/client").Prisma.TransactionClient | import("@prisma/client").PrismaClient} [db]
 * @returns {Promise<string>}
 */
export async function getMerchantWalletMnemonic(merchantId, db = prisma) {
  const m = await db.merchant.findFirst({
    where: { id: merchantId, ...ACTIVE },
    select: { mnemonicCipher: true },
  });
  if (m?.mnemonicCipher) {
    const plain = decryptMerchantApiKey(m.mnemonicCipher);
    const n = normalizeMnemonicPhrase(plain);
    if (!bip39.validateMnemonic(n)) {
      throw new Error("MERCHANT_MNEMONIC_CORRUPT");
    }
    return n;
  }
  if (env.mnemonic) {
    return env.mnemonic;
  }
  throw new Error("MERCHANT_MNEMONIC_NOT_CONFIGURED");
}
