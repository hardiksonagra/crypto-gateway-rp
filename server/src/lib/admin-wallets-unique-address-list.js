import { isEvmChain } from "../config/chains.js";
import { prisma } from "./prisma.js";

/**
 * Normalize address for grouping: EVM is case-insensitive; other chains use exact string.
 *
 * @param {import("@prisma/client").Chain} chain
 * @param {string} address
 * @returns {string}
 */
export function normalizeWalletAddressDedupeKey(chain, address) {
  const a = String(address ?? "").trim();
  if (!a) return a;
  if (isEvmChain(chain)) return a.toLowerCase();
  return a;
}

/**
 * Paginated wallet list: one row per on-chain deposit identity `(address|rail|environment)`,
 * merging duplicate `wallets` rows (e.g. same pool address across merchants).
 *
 * @param {import("@prisma/client").Prisma.WalletWhereInput} where
 * @param {number} skip
 * @param {number} take
 * @returns {Promise<{ total: number, representativeIds: number[], rowCountById: Map<number, number> }>}
 */
export async function listWalletsUniqueByOnChainIdentity(where, skip, take) {
  const groupRows = await prisma.wallet.groupBy({
    by: ["address", "chain", "currency", "network", "environment"],
    where,
    _max: { id: true },
  });

  /** @type {Map<string, { representativeId: number, address: string, chain: import("@prisma/client").Chain, currency: string, network: string, environment: import("@prisma/client").MerchantGatewayEnv, rowCount: number }>} */
  const merged = new Map();

  for (const g of groupRows) {
    const id = g._max.id;
    if (id == null) continue;
    const key = [
      normalizeWalletAddressDedupeKey(g.chain, g.address),
      g.chain,
      g.currency,
      g.network,
      g.environment,
    ].join("\0");

    const prev = merged.get(key);
    if (!prev) {
      merged.set(key, {
        representativeId: id,
        address: g.address,
        chain: g.chain,
        currency: g.currency,
        network: g.network,
        environment: g.environment,
        rowCount: 1,
      });
    } else {
      prev.rowCount += 1;
      if (id > prev.representativeId) {
        prev.representativeId = id;
        prev.address = g.address;
        prev.chain = g.chain;
        prev.currency = g.currency;
        prev.network = g.network;
        prev.environment = g.environment;
      }
    }
  }

  const list = [...merged.values()].sort(
    (a, b) => b.representativeId - a.representativeId,
  );
  const total = list.length;
  const slice = list.slice(skip, skip + take);
  const representativeIds = slice.map((x) => x.representativeId);
  const rowCountById = new Map(
    slice.map((x) => [x.representativeId, x.rowCount]),
  );

  return { total, representativeIds, rowCountById };
}
