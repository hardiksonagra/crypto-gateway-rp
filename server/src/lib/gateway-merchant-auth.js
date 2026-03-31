import { MerchantGatewayEnv } from "@prisma/client";
import { prisma } from "./prisma.js";
import { hashApiKey } from "./api-key.js";

/**
 * @param {import("@prisma/client").Merchant} merchant
 * @returns {boolean}
 */
export function isUnifiedGatewayApiKey(merchant) {
  return (
    Boolean(merchant.apiKeyHash) &&
    merchant.apiKeyHash === merchant.sandboxApiKeyHash
  );
}

/**
 * Resolve merchant from gateway `api_key` body field.
 * When live and sandbox hashes match (single secret), environment comes from the merchant’s
 * `portalEnvironment` unless `options.gatewayEnvironment` is explicitly `"live"` or `"sandbox"`
 * (e.g. simulate-deposit forces sandbox; optional JSON override).
 *
 * @param {string} apiKey
 * @param {{ gatewayEnvironment?: "live" | "sandbox" }} [options]
 * @returns {Promise<{ merchant: import("@prisma/client").Merchant, keyType: "live" | "sandbox" } | null>}
 */
export async function resolveMerchantByGatewayApiKey(apiKey, options = {}) {
  const trimmed = apiKey?.trim();
  if (!trimmed) return null;
  const h = hashApiKey(trimmed);
  const merchant = await prisma.merchant.findFirst({
    where: {
      isActive: true,
      deletedAt: null,
      OR: [{ apiKeyHash: h }, { sandboxApiKeyHash: h }],
    },
  });
  if (!merchant) return null;

  let keyType;
  if (isUnifiedGatewayApiKey(merchant)) {
    const forced = options.gatewayEnvironment;
    if (forced === "sandbox" || forced === "live") {
      keyType = forced === "sandbox" ? "sandbox" : "live";
    } else {
      keyType =
        merchant.portalEnvironment === MerchantGatewayEnv.sandbox
          ? "sandbox"
          : "live";
    }
  } else {
    keyType = merchant.apiKeyHash === h ? "live" : "sandbox";
  }
  return { merchant, keyType };
}
