import { Chain } from "@prisma/client";
import { env } from "crypto-payment-gateway/src/config/env.js";
import { re } from "crypto-payment-gateway/src/config/runtime-env.js";
import { EVM_CHAINS, isEvmChain } from "crypto-payment-gateway/src/config/chains.js";
import { nextScanExpiresAt } from "crypto-payment-gateway/src/lib/wallet-scan.js";
import { deriveEvmAddress } from "crypto-payment-gateway/src/services/wallet/evm-wallet.js";
import { deriveTronAddress } from "crypto-payment-gateway/src/services/wallet/tron-wallet.js";
import { deriveBtcAddress } from "crypto-payment-gateway/src/services/wallet/btc-wallet.js";
import { deriveTonAddress } from "crypto-payment-gateway/src/services/wallet/ton-wallet.js";
import { deriveSolanaAddressBase58 } from "crypto-payment-gateway/src/services/wallet/solana-wallet.js";

/** @typedef {import("@prisma/client").Prisma.TransactionClient} Tx */

/**
 * Assign a reusable deposit wallet for an end-user (merchant pool). Runs on gateway API request, not on a timer.
 * Prefers the oldest **free** pool row; otherwise creates a new address.
 *
 * @param {Tx} tx
 * @param {{
 *   merchantId: string,
 *   environment: import("@prisma/client").MerchantGatewayEnv,
 *   userId: string,
 *   chain: import("@prisma/client").Chain,
 *   currency: string,
 *   network: string,
 * }} p
 */
export async function assignPooledWalletForDeposit(tx, p) {
  const { merchantId, environment, userId, chain, currency, network } = p;

  const existing = await tx.wallet.findFirst({
    where: {
      merchantId,
      environment,
      chain,
      currency,
      network,
      assignedUserId: userId,
      OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: new Date() } }],
    },
  });
  if (existing) return existing;

  const holdUntil =
    re.walletAssignmentHoldMinutes > 0
      ? new Date(Date.now() + re.walletAssignmentHoldMinutes * 60 * 1000)
      : null;
  const scanAt = nextScanExpiresAt();

  const pickArgs = {
    merchantId,
    environment,
    chain,
    currency,
    network,
    userId,
    holdUntil,
    scanAt,
  };

  let picked = await tryPickFreePoolWallet(tx, pickArgs);
  if (picked) return picked;

  try {
    return await createNewPooledWallet(tx, {
      merchantId,
      environment,
      userId,
      chain,
      currency,
      network,
      holdUntil,
      scanAt,
    });
  } catch (e) {
    const msg = String(e);
    if (!msg.includes("Unique constraint") && !msg.includes("unique constraint")) throw e;
    picked = await tryPickFreePoolWallet(tx, pickArgs);
    if (picked) return picked;
    return createNewPooledWallet(tx, {
      merchantId,
      environment,
      userId,
      chain,
      currency,
      network,
      holdUntil,
      scanAt,
    });
  }
}

/**
 * @param {Tx} tx
 * @param {object} args
 */
async function tryPickFreePoolWallet(tx, args) {
  const { merchantId, environment, chain, currency, network, userId, holdUntil, scanAt } =
    args;

  const out = await tx.$queryRaw`
    UPDATE "wallets" w
    SET
      "assigned_user_id" = ${userId},
      "hold_expires_at" = ${holdUntil},
      "scan_expires_at" = ${scanAt}
    FROM (
      SELECT "id" FROM "wallets"
      WHERE "merchant_id" = ${merchantId}
        AND "environment" = ${environment}::"MerchantGatewayEnv"
        AND "chain" = ${chain}::"Chain"
        AND "currency" = ${currency}
        AND "network" = ${network}
        AND (
          "assigned_user_id" IS NULL
          OR ("hold_expires_at" IS NOT NULL AND "hold_expires_at" < NOW())
        )
      ORDER BY "created_at" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    ) pick
    WHERE w."id" = pick."id"
    RETURNING w."id"
  `;
  const row = /** @type {{ id: string }[]} */ (out)[0];
  if (!row?.id) return null;
  return tx.wallet.findUnique({ where: { id: row.id } });
}

/**
 * @param {Tx} tx
 */
async function nextDerivationIndex(tx, merchantId, environment, chain) {
  if (isEvmChain(chain)) {
    const r = await tx.wallet.aggregate({
      where: {
        merchantId,
        environment,
        chain: { in: [...EVM_CHAINS] },
      },
      _max: { derivationIndex: true },
    });
    return (r._max.derivationIndex ?? -1) + 1;
  }
  const r = await tx.wallet.aggregate({
    where: { merchantId, environment, chain },
    _max: { derivationIndex: true },
  });
  return (r._max.derivationIndex ?? -1) + 1;
}

/**
 * @param {Tx} tx
 */
async function createNewPooledWallet(tx, args) {
  const {
    merchantId,
    environment,
    userId,
    chain,
    currency,
    network,
    holdUntil,
    scanAt,
  } = args;

  const peerOnChain = await tx.wallet.findFirst({
    where: { merchantId, environment, chain },
    orderBy: { createdAt: "asc" },
  });

  let address;
  let derivationIndex;

  if (isEvmChain(chain) && peerOnChain) {
    address = peerOnChain.address;
    derivationIndex = peerOnChain.derivationIndex;
  } else {
    derivationIndex = await nextDerivationIndex(tx, merchantId, environment, chain);
    if (isEvmChain(chain)) {
      address = deriveEvmAddress(derivationIndex);
    } else if (chain === Chain.TRON) {
      address = deriveTronAddress(derivationIndex, env.mnemonic);
    } else if (chain === Chain.BTC) {
      address = deriveBtcAddress(derivationIndex, env.mnemonic);
    } else if (chain === Chain.TON) {
      address = await deriveTonAddress(derivationIndex, env.mnemonic);
    } else if (chain === Chain.SOLANA) {
      address = deriveSolanaAddressBase58(derivationIndex, env.mnemonic);
    } else {
      throw new Error(`Unsupported chain: ${chain}`);
    }
  }

  return tx.wallet.create({
    data: {
      merchantId,
      environment,
      chain,
      currency,
      network,
      address,
      derivationIndex,
      assignedUserId: userId,
      holdExpiresAt: holdUntil,
      scanExpiresAt: scanAt,
    },
  });
}
