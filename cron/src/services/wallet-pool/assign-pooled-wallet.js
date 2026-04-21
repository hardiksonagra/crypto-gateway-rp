import { randomBytes } from "crypto";
import { Chain, TxStatus } from "@prisma/client";
import { tokenDecimalsForGatewayRail } from "crypto-payment-gateway/src/lib/gateway-expected-amount.js";
import { generateGatewayReferenceTransactionId } from "crypto-payment-gateway/src/lib/gateway-reference-transaction-id.js";
import { env } from "crypto-payment-gateway/src/config/env.js";
import { re } from "crypto-payment-gateway/src/config/runtime-env.js";
import {
  EVM_CHAINS,
  isEvmChain,
} from "crypto-payment-gateway/src/config/chains.js";
import { isChainLiveForPlatform } from "crypto-payment-gateway/src/lib/chain-enable.js";
import { nextScanExpiresAt } from "crypto-payment-gateway/src/lib/wallet-scan.js";
import { deriveEvmAddress } from "crypto-payment-gateway/src/services/wallet/evm-wallet.js";
import { deriveTronAddress } from "crypto-payment-gateway/src/services/wallet/tron-wallet.js";
import { ACTIVE } from "crypto-payment-gateway/src/lib/active-row.js";

/** @typedef {import("@prisma/client").Prisma.TransactionClient} Tx */

/** @param {unknown} e */
function isUniqueWalletBusinessKeyError(e) {
  const err =
    /** @type {{ code?: string, message?: string }} */ (
      e && typeof e === "object" ? e : {}
    );
  if (err.code === "P2002") return true;
  const msg = String(err.message ?? "");
  return (
    msg.includes("Unique constraint") ||
    msg.includes("unique constraint") ||
    msg.includes("duplicate key value")
  );
}

/** @param {unknown} e */
function isWalletAssignmentTableMissingError(e) {
  const err =
    /** @type {{ code?: string, message?: string, meta?: { code?: string, message?: string } }} */ (
      e && typeof e === "object" ? e : {}
    );
  const blob = `${String(err.message ?? "")} ${String(err.meta?.message ?? "")}`;
  if (!blob.includes("wallet_assignment_events")) return false;
  return (
    err.code === "P2010" || err.code === "P2021" || err.meta?.code === "42P01"
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
 *   expectedAmountAtomic?: string | null,
 * }} p
 * @returns {Promise<{ wallet: import("@prisma/client").Wallet; assignmentSource: "existing_session" | "pool_pick" | "new_wallet"; depositSessionKey: string; referenceTransactionId: string }>}
 */
export async function assignPooledWalletForDeposit(tx, p) {
  const { merchantId, environment, userId, chain, currency, network } = p;
  if (!isChainLiveForPlatform(re.chainEnabledRecord, chain)) {
    throw new Error("CHAIN_DISABLED_FOR_PLATFORM");
  }
  const refTxRaw =
    p.referenceTransactionId != null
      ? String(p.referenceTransactionId).trim()
      : "";
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
      ...ACTIVE,
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
      /**
       * `wallet.create()` unique violation aborts the whole Postgres transaction unless we
       * roll back to a savepoint first; otherwise the follow-up `tryPickFreePoolWallet` `$queryRaw`
       * hits `25P02` (transaction is aborted).
       */
      const createArgs = {
        merchantId,
        environment,
        userId,
        chain,
        currency,
        network,
        holdUntil,
        scanAt,
      };
      const maxCreateAttempts = 4;
      for (let attempt = 0; attempt < maxCreateAttempts; attempt += 1) {
        const sp = `pool_wallet_assign_${attempt}`;
        await tx.$executeRawUnsafe(`SAVEPOINT ${sp}`);
        try {
          wallet = await createNewPooledWallet(tx, createArgs);
          await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${sp}`);
          source = "new_wallet";
          break;
        } catch (e) {
          await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${sp}`);
          await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${sp}`);
          if (!isUniqueWalletBusinessKeyError(e)) throw e;
          picked = await tryPickFreePoolWallet(tx, pickArgs);
          if (picked) {
            wallet = picked;
            source = "pool_pick";
            break;
          }
        }
      }
      if (!wallet) {
        throw new Error("POOL_WALLET_ASSIGN_EXHAUSTED_RETRIES");
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
        expectedAmountAtomic:
          typeof p.expectedAmountAtomic === "string" &&
          /^\d+$/.test(p.expectedAmountAtomic.trim())
            ? p.expectedAmountAtomic.trim()
            : null,
      },
    });
  } catch (e) {
    if (!isWalletAssignmentTableMissingError(e)) throw e;
  }

  const dec = tokenDecimalsForGatewayRail(currency, network) ?? 6;
  /** One `created` placeholder per `deposit-address` call (open or fixed amount) — removed when first on-chain row exists for this session. */
  await tx.transaction.create({
    data: {
      walletId: wallet.id,
      payerUserId: userId,
      txHash: `gateway-created:${depositSessionKey}`,
      fromAddress: "gateway:pending",
      toAddress: wallet.address,
      amount: "0",
      tokenSymbol: currency,
      chain,
      status: TxStatus.created,
      confirmations: 0,
      logIndex: -2,
      tokenDecimals: dec,
      depositSessionKey,
      referenceTransactionId: referenceTransactionId || null,
    },
  });

  return {
    wallet,
    assignmentSource: source,
    depositSessionKey,
    referenceTransactionId,
  };
}

/**
 * @param {Tx} tx
 * @param {object} args
 */
async function tryPickFreePoolWallet(tx, args) {
  const {
    merchantId,
    environment,
    chain,
    currency,
    network,
    userId,
    holdUntil,
    scanAt,
  } = args;

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
        AND w2."deleted_at" IS NULL
        AND (
          w2."assigned_user_id" IS NULL
          OR (w2."hold_expires_at" IS NOT NULL AND w2."hold_expires_at" < NOW())
        )
      ORDER BY
        EXISTS (
          SELECT 1 FROM "transactions" t
          WHERE t."wallet_id" = w2."id" AND t."payer_user_id" = ${userId}
            AND t."deleted_at" IS NULL
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
  return tx.wallet.findFirst({ where: { id: row.id, ...ACTIVE } });
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
        ...ACTIVE,
      },
      _max: { derivationIndex: true },
    });
    return (r._max.derivationIndex ?? -1) + 1;
  }
  const r = await tx.wallet.aggregate({
    where: { merchantId, environment, chain, ...ACTIVE },
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

  /**
   * New pool rows must each get a **distinct** `(merchant, env, chain, currency, network, address)`
   * (partial unique on active wallets). Reusing the first EVM row’s address for a second row always
   * collides — TRC20 avoids this by deriving a new address per row; EVM must do the same here.
   */
  const derivationIndex = await nextDerivationIndex(
    tx,
    merchantId,
    environment,
    chain,
  );
  let address;
  if (isEvmChain(chain)) {
    address = deriveEvmAddress(derivationIndex);
  } else if (chain === Chain.TRON) {
    address = deriveTronAddress(derivationIndex, env.mnemonic);
  } else {
    throw new Error(`Unsupported chain: ${chain}`);
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
