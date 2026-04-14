import { randomBytes } from "crypto";
import { Chain } from "@prisma/client";
import { generateGatewayReferenceTransactionId } from "crypto-payment-gateway/src/lib/gateway-reference-transaction-id.js";
import { env } from "crypto-payment-gateway/src/config/env.js";
import { re } from "crypto-payment-gateway/src/config/runtime-env.js";
import { EVM_CHAINS, isEvmChain } from "crypto-payment-gateway/src/config/chains.js";
import { isChainLiveForPlatform } from "crypto-payment-gateway/src/lib/chain-enable.js";
import { nextScanExpiresAt } from "crypto-payment-gateway/src/lib/wallet-scan.js";
import { deriveEvmAddress } from "crypto-payment-gateway/src/services/wallet/evm-wallet.js";
import { deriveTronAddress } from "crypto-payment-gateway/src/services/wallet/tron-wallet.js";
import { deriveBtcAddress } from "crypto-payment-gateway/src/services/wallet/btc-wallet.js";
import { deriveTonAddress } from "crypto-payment-gateway/src/services/wallet/ton-wallet.js";
import { deriveSolanaAddressBase58 } from "crypto-payment-gateway/src/services/wallet/solana-wallet.js";

/** @typedef {import("@prisma/client").Prisma.TransactionClient} Tx */

/** @param {unknown} e */
function isWalletAssignmentTableMissingError(e) {
  const err = /** @type {{ code?: string, message?: string, meta?: { code?: string, message?: string } }} */ (
    e && typeof e === "object" ? e : {}
  );
  const blob = `${String(err.message ?? "")} ${String(err.meta?.message ?? "")}`;
  if (!blob.includes("wallet_assignment_events")) return false;
  return (
    err.code === "P2010" ||
    err.code === "P2021" ||
    err.meta?.code === "42P01"
  );
}

/**
 * Assign a reusable deposit wallet for an end-user (merchant pool). Runs on gateway API request, not on a timer.
 * If this user already holds a row for the rail, refreshes hold/scan and returns it (including expired holds).
 * Otherwise picks a **free** pool row, preferring any wallet this user has prior `transactions` on (any status);
 * then oldest by `created_at`. If none available, creates a new address.
 *
 * @param {Tx} tx
 * @param {{
 *   merchantId: string,
 *   environment: import("@prisma/client").MerchantGatewayEnv,
 *   userId: string,
 *   chain: import("@prisma/client").Chain,
 *   currency: string,
 *   network: string,
 *   referenceTransactionId?: string | null,
 * }} p
 * @returns {Promise<{ wallet: import("@prisma/client").Wallet; assignmentSource: "existing_session" | "pool_pick" | "new_wallet"; depositSessionKey: string }>}
 */
export async function assignPooledWalletForDeposit(tx, p) {
  const { merchantId, environment, userId, chain, currency, network } = p;
  if (!isChainLiveForPlatform(re.chainEnabledRecord, chain)) {
    throw new Error("CHAIN_DISABLED_FOR_PLATFORM");
  }
  const refTxRaw =
    p.referenceTransactionId != null ? String(p.referenceTransactionId).trim() : "";
  /** Always set: merchant `transaction_id` or gateway-generated 64-char hex (fits VARCHAR(256)). */
  const referenceTransactionId = refTxRaw
    ? refTxRaw.slice(0, 256)
    : generateGatewayReferenceTransactionId();

  const holdUntil =
    re.walletAssignmentHoldMinutes > 0
      ? new Date(Date.now() + re.walletAssignmentHoldMinutes * 60 * 1000)
      : null;
  const scanAt = nextScanExpiresAt();

  /** @type {import("@prisma/client").Wallet} */
  let wallet;
  /** @type {string} */
  let source;

  const stillAssigned = await tx.wallet.findFirst({
    where: {
      merchantId,
      environment,
      chain,
      currency,
      network,
      assignedUserId: userId,
    },
  });
  if (stillAssigned) {
    wallet = await tx.wallet.update({
      where: { id: stillAssigned.id },
      data: {
        holdExpiresAt: holdUntil,
        scanExpiresAt: scanAt,
      },
    });
    source = "existing_session";
  } else {
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
    if (picked) {
      wallet = picked;
      source = "pool_pick";
    } else {
      try {
        wallet = await createNewPooledWallet(tx, {
          merchantId,
          environment,
          userId,
          chain,
          currency,
          network,
          holdUntil,
          scanAt,
        });
        source = "new_wallet";
      } catch (e) {
        const msg = String(e);
        if (!msg.includes("Unique constraint") && !msg.includes("unique constraint")) throw e;
        picked = await tryPickFreePoolWallet(tx, pickArgs);
        if (picked) {
          wallet = picked;
          source = "pool_pick";
        } else {
          wallet = await createNewPooledWallet(tx, {
            merchantId,
            environment,
            userId,
            chain,
            currency,
            network,
            holdUntil,
            scanAt,
          });
          source = "new_wallet";
        }
      }
    }
  }

  const depositSessionKey = randomBytes(24).toString("hex");
  try {
    await tx.walletAssignmentEvent.create({
      data: {
        walletId: wallet.id,
        userId,
        merchantId,
        environment,
        source,
        depositSessionKey,
        referenceTransactionId,
      },
    });
  } catch (e) {
    if (!isWalletAssignmentTableMissingError(e)) throw e;
  }

  return { wallet, assignmentSource: source, depositSessionKey };
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
      SELECT w2."id" FROM "wallets" w2
      WHERE w2."merchant_id" = ${merchantId}
        AND w2."environment" = ${environment}::"MerchantGatewayEnv"
        AND w2."chain" = ${chain}::"Chain"
        AND w2."currency" = ${currency}
        AND w2."network" = ${network}
        AND (
          w2."assigned_user_id" IS NULL
          OR (w2."hold_expires_at" IS NOT NULL AND w2."hold_expires_at" < NOW())
        )
      ORDER BY
        EXISTS (
          SELECT 1 FROM "transactions" t
          WHERE t."wallet_id" = w2."id" AND t."payer_user_id" = ${userId}
        ) DESC,
        w2."created_at" ASC
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
