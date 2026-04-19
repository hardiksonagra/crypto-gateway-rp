/**
 * Raw SQL for `TxStatus.underpaid` when `@prisma/client` predates the enum value
 * (Prisma throws "Expected TxStatus" before the query reaches Postgres).
 */
import { Prisma } from "@prisma/client";

/**
 * @param {import("@prisma/client").PrismaClient} prisma
 * @param {{ limit: number, minAgo: Date, maxAttempts: number }} p
 * @returns {Promise<Array<{ id: number }>>}
 */
export async function findUnderpaidCallbackRetryIdsRaw(
  prisma,
  { limit, minAgo, maxAttempts },
) {
  return prisma.$queryRaw(
    Prisma.sql`
      SELECT t.id
      FROM transactions t
      INNER JOIN wallets w ON w.id = t.wallet_id AND w.deleted_at IS NULL
      INNER JOIN merchants m
        ON m.id = w.merchant_id
        AND m.deleted_at IS NULL
        AND m.callback_url IS NOT NULL
      WHERE t.deleted_at IS NULL
        AND (t.status)::text = 'underpaid'
        AND t.callback_delivered_at IS NULL
        AND t.callback_attempt_count < ${maxAttempts}
        AND (
          t.callback_attempt_count = 0
          OR t.callback_last_attempt_at <= ${minAgo}
        )
      ORDER BY t.updated_at ASC
      LIMIT ${limit}
    `,
  );
}

/**
 * @param {import("@prisma/client").PrismaClient} prisma
 * @param {{ walletId: number, depositSessionKey: string }} p
 * @returns {Promise<{ id: number } | null>}
 */
export async function findGatewayPollUnderpaidRowRaw(
  prisma,
  { walletId, depositSessionKey },
) {
  const rows = await prisma.$queryRaw(
    Prisma.sql`
      SELECT t.id
      FROM transactions t
      WHERE t.deleted_at IS NULL
        AND t.wallet_id = ${walletId}
        AND t.deposit_session_key = ${depositSessionKey}
        AND (t.status)::text = 'underpaid'
      LIMIT 1
    `,
  );
  return rows[0] ?? null;
}

/**
 * @param {import("@prisma/client").PrismaClient} prisma
 * @param {{
 *   payerUserId: number,
 *   merchantId: number,
 *   gwEnv: import("@prisma/client").MerchantGatewayEnv,
 *   maxAttempts: number,
 * }} p
 * @returns {Promise<{ id: number } | null>}
 */
export async function findGatewayBlockingPendingCallbackRaw(
  prisma,
  { payerUserId, merchantId, gwEnv, maxAttempts },
) {
  const rows = await prisma.$queryRaw(
    Prisma.sql`
      SELECT t.id
      FROM transactions t
      INNER JOIN wallets w
        ON w.id = t.wallet_id
        AND w.deleted_at IS NULL
        AND w.merchant_id = ${merchantId}
        AND w.environment = CAST(${gwEnv} AS "MerchantGatewayEnv")
      WHERE t.deleted_at IS NULL
        AND t.payer_user_id = ${payerUserId}
        AND (t.status)::text IN ('success', 'underpaid')
        AND t.callback_delivered_at IS NULL
        AND t.callback_attempt_count < ${maxAttempts}
      LIMIT 1
    `,
  );
  return rows[0] ?? null;
}

/**
 * @param {import("@prisma/client").PrismaClient} prisma
 * @param {{
 *   transactionId: number,
 *   now: Date,
 *   throttleSince: Date,
 *   maxAttempts: number,
 * }} p
 * @returns {Promise<number>} affected rows
 */
export async function claimUnderpaidWebhookAttemptRaw(
  prisma,
  { transactionId, now, throttleSince, maxAttempts },
) {
  return prisma.$executeRaw(
    Prisma.sql`
      UPDATE transactions t
      SET
        callback_attempt_count = t.callback_attempt_count + 1,
        callback_last_attempt_at = ${now}
      WHERE t.id = ${transactionId}
        AND t.deleted_at IS NULL
        AND (t.status)::text = 'underpaid'
        AND t.callback_delivered_at IS NULL
        AND t.callback_attempt_count < ${maxAttempts}
        AND (
          t.callback_attempt_count = 0
          OR t.callback_last_attempt_at <= ${throttleSince}
        )
    `,
  );
}

/**
 * @param {import("@prisma/client").PrismaClient} prisma
 * @param {{ walletId: number, depositSessionKey: string, now: Date }} p
 * @returns {Promise<number>} affected rows
 */
export async function promoteUnderpaidSessionToSuccessRaw(
  prisma,
  { walletId, depositSessionKey, now },
) {
  return prisma.$executeRaw(
    Prisma.sql`
      UPDATE transactions
      SET
        status = CAST('success' AS "TxStatus"),
        updated_at = ${now}
      WHERE wallet_id = ${walletId}
        AND deposit_session_key = ${depositSessionKey}
        AND deleted_at IS NULL
        AND (status)::text = 'underpaid'
    `,
  );
}

/**
 * @param {import("@prisma/client").PrismaClient} prisma
 * @param {{ walletId: number, depositSessionKey: string }} p
 * @returns {Promise<Array<{ amount: string, chain: import("@prisma/client").Chain, txHash: string, logIndex: number }>>}
 */
export async function selectSessionInboundAmountRowsRaw(
  prisma,
  { walletId, depositSessionKey },
) {
  return prisma.$queryRaw(
    Prisma.sql`
      SELECT
        t.amount,
        t.chain,
        t.tx_hash AS "txHash",
        t.log_index AS "logIndex"
      FROM transactions t
      WHERE t.wallet_id = ${walletId}
        AND t.deposit_session_key = ${depositSessionKey}
        AND t.deleted_at IS NULL
        AND (t.status)::text IN ('pending', 'success', 'underpaid')
    `,
  );
}

/**
 * @param {import("@prisma/client").PrismaClient} prisma
 * @param {object} p
 * @param {number} p.walletInternalId
 * @param {number | null} p.payerUserIdForCreate
 * @param {string | null} p.depositSessionKeyForCreate
 * @param {string | null} p.referenceTransactionIdForCreate
 * @param {object} p.input
 * @param {string} p.input.txHash
 * @param {string} p.input.fromAddress
 * @param {string} p.input.toAddress
 * @param {string} p.input.amount
 * @param {string} p.input.tokenSymbol
 * @param {number} p.input.tokenDecimals
 * @param {import("@prisma/client").Chain} p.input.chain
 * @param {number} p.input.confirmations
 * @param {bigint | number | string | null | undefined} p.input.blockNumber
 * @param {number} p.input.logIndex
 * @returns {Promise<{
 *   id: number,
 *   walletId: number,
 *   depositSessionKey: string | null,
 *   callbackDeliveredAt: Date | null,
 * }>}
 */
export async function upsertTransactionRowUnderpaidRaw(prisma, p) {
  const {
    walletInternalId,
    payerUserIdForCreate,
    depositSessionKeyForCreate,
    referenceTransactionIdForCreate,
    input,
  } = p;
  const now = new Date();
  const bn =
    input.blockNumber === undefined || input.blockNumber === null
      ? null
      : BigInt(input.blockNumber);
  const rows = await prisma.$queryRaw(
    Prisma.sql`
      INSERT INTO transactions (
        wallet_id,
        payer_user_id,
        deposit_session_key,
        transaction_id,
        tx_hash,
        from_address,
        to_address,
        amount,
        token_symbol,
        token_decimals,
        chain,
        status,
        confirmations,
        block_number,
        log_index,
        created_at,
        updated_at
      ) VALUES (
        ${walletInternalId},
        ${payerUserIdForCreate},
        ${depositSessionKeyForCreate},
        ${referenceTransactionIdForCreate},
        ${input.txHash},
        ${input.fromAddress},
        ${input.toAddress},
        ${input.amount},
        ${input.tokenSymbol},
        ${input.tokenDecimals},
        CAST(${input.chain} AS "Chain"),
        CAST('underpaid' AS "TxStatus"),
        ${input.confirmations},
        ${bn},
        ${input.logIndex},
        ${now},
        ${now}
      )
      ON CONFLICT (chain, tx_hash, log_index) DO UPDATE SET
        confirmations = EXCLUDED.confirmations,
        block_number = EXCLUDED.block_number,
        status = CAST('underpaid' AS "TxStatus"),
        updated_at = EXCLUDED.updated_at
      RETURNING
        id,
        wallet_id AS "walletId",
        deposit_session_key AS "depositSessionKey",
        callback_delivered_at AS "callbackDeliveredAt"
    `,
  );
  const row = rows[0];
  if (!row) {
    throw new Error("underpaid_raw_upsert_returned_no_row");
  }
  return row;
}
