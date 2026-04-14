import { Chain } from "@prisma/client";
import { prisma } from "./prisma.js";
import { logger } from "./logger.js";
import { re } from "../config/runtime-env.js";
import {
  isChainLiveForPlatform,
  MERCHANT_PORTAL_PRODUCT_CHAINS,
} from "./chain-enable.js";
import {
  depositRailKey,
  normalizeAssetPart,
  parseDepositRailKeyString,
  resolveDepositRail,
  suggestedDefaultPairForChain,
} from "../config/payment-rails.js";
import { pickMerchantDefaultPair } from "./merchant-default-pair.js";

/**
 * When Admin disables a chain (Supported chains / `CHAIN_ENABLED`), remove it from every
 * non-deleted merchant's `default_chains` and `supported_deposit_rails`, and fix default pair.
 *
 * Call only after `loadAppSettingsFromDatabase()` so `re.chainEnabledRecord` is current.
 *
 * @returns {Promise<{ updated: number, examined: number }>}
 */
export async function pruneMerchantsAfterSupportedChainsChange() {
  const record = re.chainEnabledRecord;
  const allowedPlatform = new Set(
    MERCHANT_PORTAL_PRODUCT_CHAINS.filter((c) => isChainLiveForPlatform(record, c)),
  );
  const fallbackChain =
    MERCHANT_PORTAL_PRODUCT_CHAINS.find((c) => allowedPlatform.has(c)) ?? Chain.TRON;

  const merchants = await prisma.merchant.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      defaultChains: true,
      defaultCurrency: true,
      defaultNetwork: true,
      supportedDepositRails: true,
    },
  });

  const writes = [];

  for (const m of merchants) {
    const prevChains = Array.isArray(m.defaultChains) ? [...m.defaultChains] : [];
    let chains = prevChains.filter((c) => allowedPlatform.has(c));
    if (chains.length === 0) {
      chains = [fallbackChain];
    }

    const chainSet = new Set(chains);
    const seen = new Set();
    /** @type {string[]} */
    const rails = [];
    for (const key of m.supportedDepositRails ?? []) {
      const { currency, network } = parseDepositRailKeyString(key);
      const rail = resolveDepositRail(currency, network);
      if (!rail) continue;
      if (!allowedPlatform.has(rail.chain)) continue;
      if (!chainSet.has(rail.chain)) continue;
      const k = depositRailKey(rail.currency, rail.network);
      if (seen.has(k)) continue;
      seen.add(k);
      rails.push(k);
    }

    let nextRails = rails;
    if (nextRails.length === 0) {
      const sug = suggestedDefaultPairForChain(chains[0]);
      nextRails = [depositRailKey(sug.currency, sug.network)];
    }

    let pair = pickMerchantDefaultPair(
      {
        default_currency: m.defaultCurrency ?? undefined,
        default_network: m.defaultNetwork ?? undefined,
      },
      chains,
      nextRails,
    );
    if ("error" in pair) {
      pair = pickMerchantDefaultPair({}, chains, nextRails);
    }
    if ("error" in pair) {
      const sug = suggestedDefaultPairForChain(chains[0]);
      pair = pickMerchantDefaultPair(
        { default_currency: sug.currency, default_network: sug.network },
        chains,
        nextRails,
      );
    }
    if ("error" in pair) {
      logger.error("prune merchant: could not derive default pair", {
        merchantId: m.id,
        err: pair.error,
      });
      continue;
    }

    const sameChains =
      JSON.stringify(prevChains) === JSON.stringify(chains);
    const sameRails =
      JSON.stringify(m.supportedDepositRails ?? []) === JSON.stringify(nextRails);
    const sameCur =
      normalizeAssetPart(m.defaultCurrency ?? "") ===
      normalizeAssetPart(pair.currency);
    const sameNet =
      normalizeAssetPart(m.defaultNetwork ?? "") ===
      normalizeAssetPart(pair.network);
    if (sameChains && sameRails && sameCur && sameNet) {
      continue;
    }

    writes.push(
      prisma.merchant.update({
        where: { id: m.id },
        data: {
          defaultChains: chains,
          supportedDepositRails: nextRails,
          defaultCurrency: pair.currency,
          defaultNetwork: pair.network,
        },
      }),
    );
  }

  const CHUNK = 80;
  for (let i = 0; i < writes.length; i += CHUNK) {
    await prisma.$transaction(writes.slice(i, i + CHUNK));
  }

  return { updated: writes.length, examined: merchants.length };
}
