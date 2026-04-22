/**
 * Merchant-portal transaction reads via raw SQL when `@prisma/client` predates
 * `TxStatus.created` (Prisma cannot deserialize `status = created`).
 */

/**
 * @typedef {object} MerchantPortalTxListRawArgs
 * @property {number} mid
 * @property {import("@prisma/client").MerchantGatewayEnv} environment
 * @property {string} chain
 * @property {boolean} chainOk
 * @property {string} status
 * @property {string} token
 * @property {string} qUser
 * @property {string} qTxRef
 */

import { Prisma } from "@prisma/client";

/** @type {ReadonlyArray<string>} */
const TX_STATUS_FILTER = Object.freeze([
  "pending",
  "success",
  "failed",
  "underpaid",
  "created",
]);

const PORTAL_LIST_FROM = Prisma.sql`
  FROM transactions t
  INNER JOIN wallets w ON w.id = t.wallet_id AND w.deleted_at IS NULL
  LEFT JOIN users pu ON pu.id = t.payer_user_id
  LEFT JOIN users au ON au.id = w.assigned_user_id
`;

/**
 * @param {{
 *   mid: number,
 *   environment: import("@prisma/client").MerchantGatewayEnv,
 *   chainFilter: string | null,
 *   statusFilter: string | null,
 *   token: string,
 *   qUser: string,
 *   qTxRef: string,
 * }} p
 * @returns {Prisma.Sql[]}
 */
function merchantPortalTransactionWhereParts(p) {
  const parts = [
    Prisma.sql`t.deleted_at IS NULL`,
    Prisma.sql`w.merchant_id = ${p.mid}`,
    Prisma.sql`w.environment = ${p.environment}::"MerchantGatewayEnv"`,
  ];
  if (p.chainFilter) {
    parts.push(Prisma.sql`t.chain = ${p.chainFilter}::"Chain"`);
  }
  if (p.statusFilter) {
    parts.push(Prisma.sql`(t.status)::text = ${p.statusFilter}`);
  }
  if (p.token) {
    parts.push(Prisma.sql`LOWER(t.token_symbol) = LOWER(${p.token})`);
  }
  if (p.qTxRef) {
    parts.push(
      Prisma.sql`t.transaction_id ILIKE ('%' || ${p.qTxRef} || '%')`,
    );
  }
  if (p.qUser) {
    const pat = `%${p.qUser}%`;
    parts.push(Prisma.sql`(
      (pu.id IS NOT NULL AND pu.deleted_at IS NULL AND pu.merchant_id = ${p.mid} AND pu.external_user_id ILIKE ${pat})
      OR
      (au.id IS NOT NULL AND au.deleted_at IS NULL AND au.external_user_id ILIKE ${pat})
    )`);
  }
  return parts;
}

/**
 * @param {MerchantPortalTxListRawArgs} args
 */
function portalListParams(args) {
  return {
    mid: args.mid,
    environment: args.environment,
    chainFilter: args.chainOk ? args.chain : null,
    statusFilter:
      args.status && TX_STATUS_FILTER.includes(args.status) ? args.status : null,
    token: args.token,
    qUser: args.qUser,
    qTxRef: args.qTxRef,
  };
}

/**
 * Last 7 days of **success** deposits only (merchant dashboard “Recent Success”).
 *
 * @param {import("@prisma/client").PrismaClient} prisma
 * @param {{ mid: number, environment: import("@prisma/client").MerchantGatewayEnv, since: Date }} p
 * @returns {Promise<object[]>}
 */
export async function listMerchantDashboardRecentTxRaw(prisma, p) {
  const rows = await prisma.$queryRaw(
    Prisma.sql`
      SELECT
        t.id,
        t.wallet_id,
        t.deposit_session_key,
        t.transaction_id AS reference_transaction_id,
        t.tx_hash,
        t.chain::text AS chain,
        t.status::text AS tx_status,
        t.token_symbol,
        t.token_decimals,
        t.amount,
        t.created_at,
        w.address AS w_address
      ${PORTAL_LIST_FROM}
      WHERE ${Prisma.join(
        [
          Prisma.sql`t.deleted_at IS NULL`,
          Prisma.sql`w.merchant_id = ${p.mid}`,
          Prisma.sql`w.environment = ${p.environment}::"MerchantGatewayEnv"`,
          Prisma.sql`t.created_at >= ${p.since}`,
          Prisma.sql`(t.status)::text = 'success'`,
        ],
        " AND ",
      )}
      ORDER BY t.created_at DESC
      LIMIT 8
    `,
  );
  return rows.map((row) => ({
    id: row.id,
    walletId: row.wallet_id,
    depositSessionKey: row.deposit_session_key,
    referenceTransactionId: row.reference_transaction_id,
    txHash: row.tx_hash,
    chain: row.chain,
    status: row.tx_status,
    tokenSymbol: row.token_symbol,
    tokenDecimals: row.token_decimals,
    amount: row.amount,
    createdAt: row.created_at,
    wallet: { address: row.w_address },
  }));
}

/**
 * @param {import("@prisma/client").PrismaClient} prisma
 * @param {MerchantPortalTxListRawArgs} args
 * @returns {Promise<number>}
 */
export async function countMerchantPortalTransactionsRaw(prisma, args) {
  const p = portalListParams(args);
  const parts = merchantPortalTransactionWhereParts(p);
  const rows = await prisma.$queryRaw(
    Prisma.sql`
      SELECT COUNT(*)::int AS cnt
      ${PORTAL_LIST_FROM}
      WHERE ${Prisma.join(parts, " AND ")}
    `,
  );
  return Number(rows[0]?.cnt ?? 0);
}

/**
 * @param {object} row
 */
function mapMerchantPortalTxRow(row) {
  const bn = row.block_number;
  return {
    id: row.id,
    walletId: row.wallet_id,
    referenceTransactionId: row.reference_transaction_id,
    txHash: row.tx_hash,
    chain: row.chain,
    status: row.tx_status,
    tokenSymbol: row.token_symbol,
    tokenDecimals: row.token_decimals,
    amount: row.amount,
    confirmations: row.confirmations,
    fromAddress: row.from_address,
    toAddress: row.to_address,
    blockNumber:
      bn == null ? null : typeof bn === "bigint" ? bn : BigInt(String(bn)),
    logIndex: row.log_index,
    callbackDeliveredAt: row.callback_delivered_at,
    depositSessionKey: row.deposit_session_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    payerUser:
      row.pu_id == null
        ? null
        : { externalUserId: row.pu_external_user_id },
    wallet: {
      address: row.w_address,
      currency: row.w_currency,
      network: row.w_network,
      environment: row.w_environment,
      assignedUser:
        row.au_id == null
          ? null
          : { externalUserId: row.au_external_user_id },
    },
  };
}

/**
 * @param {import("@prisma/client").PrismaClient} prisma
 * @param {MerchantPortalTxListRawArgs & { skip: number, take: number }} args
 * @returns {Promise<object[]>}
 */
export async function listMerchantPortalTransactionsRaw(prisma, args) {
  const p = portalListParams(args);
  const parts = merchantPortalTransactionWhereParts(p);
  const rows = await prisma.$queryRaw(
    Prisma.sql`
      SELECT
        t.id,
        t.wallet_id,
        t.transaction_id AS reference_transaction_id,
        t.tx_hash,
        t.from_address,
        t.to_address,
        t.amount,
        t.token_symbol,
        t.chain::text AS chain,
        t.status::text AS tx_status,
        t.confirmations,
        t.block_number,
        t.log_index,
        t.token_decimals,
        t.callback_delivered_at,
        t.deposit_session_key,
        t.created_at,
        t.updated_at,
        w.address AS w_address,
        w.currency AS w_currency,
        w.network AS w_network,
        w.environment AS w_environment,
        pu.id AS pu_id,
        pu.external_user_id AS pu_external_user_id,
        au.id AS au_id,
        au.external_user_id AS au_external_user_id
      ${PORTAL_LIST_FROM}
      WHERE ${Prisma.join(parts, " AND ")}
      ORDER BY t.created_at DESC
      LIMIT ${args.take}
      OFFSET ${args.skip}
    `,
  );
  return rows.map(mapMerchantPortalTxRow);
}
