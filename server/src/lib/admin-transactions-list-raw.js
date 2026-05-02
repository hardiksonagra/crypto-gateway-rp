/**
 * Admin transaction list via raw SQL when `@prisma/client` predates `TxStatus.created`.
 * `prisma.transaction.findMany` cannot deserialize rows whose `status` is `created`.
 */

/**
 * @typedef {object} AdminTransactionsListRawArgs
 * @property {import("@prisma/client").MerchantGatewayEnv} listEnv
 * @property {string} merchantId
 * @property {{ id: number } | null} txListMerch
 * @property {string} chain
 * @property {boolean} chainOk
 * @property {string} status
 * @property {string} token
 * @property {string} qAddr
 * @property {string} qExtUser
 * @property {string} qTxRef
 * @property {number[] | null} [rpMerchantIds] When set and `merchantId` is empty, restrict to these merchants (RP portal).
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

const FROM_SQL = Prisma.sql`
  FROM transactions t
  INNER JOIN wallets w ON w.id = t.wallet_id AND w.deleted_at IS NULL
  INNER JOIN merchants wm ON wm.id = w.merchant_id
  LEFT JOIN reseller_partners wm_rp ON wm_rp.id = wm.reseller_partner_id
  LEFT JOIN users pu ON pu.id = t.payer_user_id
  LEFT JOIN merchants pum ON pum.id = pu.merchant_id
  LEFT JOIN users au ON au.id = w.assigned_user_id
`;

/**
 * @param {{
 *   listEnv: import("@prisma/client").MerchantGatewayEnv,
 *   merchantId: string,
 *   txListMerch: { id: number } | null,
 *   chainFilter: string | null,
 *   statusFilter: string | null,
 *   token: string,
 *   qAddr: string,
 *   qExtUser: string,
 *   qTxRef: string,
 *   rpMerchantIds?: number[] | null,
 * }} p
 * @returns {Prisma.Sql[]}
 */
function adminTransactionsWhereParts(p) {
  const parts = [
    Prisma.sql`t.deleted_at IS NULL`,
    Prisma.sql`w.environment = ${p.listEnv}::"MerchantGatewayEnv"`,
  ];
  if (p.merchantId) {
    if (!p.txListMerch) parts.push(Prisma.sql`FALSE`);
    else parts.push(Prisma.sql`w.merchant_id = ${p.txListMerch.id}`);
  } else if (p.rpMerchantIds && p.rpMerchantIds.length > 0) {
    parts.push(Prisma.sql`w.merchant_id IN (${Prisma.join(p.rpMerchantIds)})`);
  }
  if (p.qAddr) {
    if (p.qAddr.startsWith("0x")) {
      parts.push(Prisma.sql`LOWER(w.address) = LOWER(${p.qAddr})`);
    } else {
      parts.push(Prisma.sql`w.address = ${p.qAddr}`);
    }
  }
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
  if (p.qExtUser) {
    const pat = `%${p.qExtUser}%`;
    if (p.txListMerch) {
      parts.push(Prisma.sql`(
        (pu.id IS NOT NULL AND pu.deleted_at IS NULL AND pu.external_user_id ILIKE ${pat} AND pu.merchant_id = ${p.txListMerch.id})
        OR
        (au.id IS NOT NULL AND au.external_user_id ILIKE ${pat})
      )`);
    } else if (p.rpMerchantIds && p.rpMerchantIds.length > 0) {
      parts.push(Prisma.sql`(
        (pu.id IS NOT NULL AND pu.deleted_at IS NULL AND pu.external_user_id ILIKE ${pat} AND pu.merchant_id IN (${Prisma.join(p.rpMerchantIds)}))
        OR
        (au.id IS NOT NULL AND au.external_user_id ILIKE ${pat})
      )`);
    } else {
      parts.push(Prisma.sql`(
        (pu.id IS NOT NULL AND pu.deleted_at IS NULL AND pu.external_user_id ILIKE ${pat})
        OR
        (au.id IS NOT NULL AND au.external_user_id ILIKE ${pat})
      )`);
    }
  }
  return parts;
}

/**
 * @param {object} row
 * @returns {object}
 */
function mapAdminTransactionListRow(row) {
  const bn = row.block_number;
  return {
    id: row.id,
    walletId: row.wallet_id,
    payerUserId: row.payer_user_id,
    referenceTransactionId: row.reference_transaction_id,
    txHash: row.tx_hash,
    fromAddress: row.from_address,
    toAddress: row.to_address,
    amount: row.amount,
    tokenSymbol: row.token_symbol,
    chain: row.chain,
    status: row.tx_status,
    confirmations: row.confirmations,
    blockNumber:
      bn == null ? null : typeof bn === "bigint" ? bn : BigInt(String(bn)),
    logIndex: row.log_index,
    tokenDecimals: row.token_decimals,
    callbackDeliveredAt: row.callback_delivered_at,
    depositSessionKey: row.deposit_session_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    payerUser:
      row.pu_id == null
        ? null
        : {
            id: row.pu_id,
            externalUserId: row.pu_external_user_id,
            merchant:
              row.pum_id == null
                ? {
                    id: row.pu_merchant_id ?? 0,
                    email: "",
                    displayName: null,
                  }
                : {
                    id: row.pum_id,
                    email: row.pum_email,
                    displayName: row.pum_display_name,
                  },
          },
    wallet: {
      address: row.w_address,
      currency: row.w_currency,
      network: row.w_network,
      environment: row.w_environment,
      merchant: {
        id: row.wm_id,
        email: row.wm_email,
        displayName: row.wm_display_name,
        resellerPartnerId: row.wm_reseller_partner_id ?? null,
        resellerPartner:
          row.wm_rp_email != null && String(row.wm_rp_email).trim()
            ? {
                id: row.wm_reseller_partner_id ?? null,
                email: String(row.wm_rp_email).trim(),
                displayName:
                  row.wm_rp_display_name != null && String(row.wm_rp_display_name).trim()
                    ? String(row.wm_rp_display_name).trim()
                    : null,
              }
            : null,
      },
      assignedUser:
        row.au_id == null
          ? null
          : {
              id: row.au_id,
              externalUserId: row.au_external_user_id,
            },
    },
  };
}

/**
 * @param {AdminTransactionsListRawArgs} args
 */
function rawListParams(args) {
  const chainFilter = args.chainOk ? args.chain : null;
  const statusFilter =
    args.status && TX_STATUS_FILTER.includes(args.status) ? args.status : null;
  return {
    listEnv: args.listEnv,
    merchantId: args.merchantId,
    txListMerch: args.txListMerch,
    chainFilter,
    statusFilter,
    token: args.token,
    qAddr: args.qAddr,
    qExtUser: args.qExtUser,
    qTxRef: args.qTxRef,
    rpMerchantIds: args.rpMerchantIds ?? null,
  };
}

/**
 * @param {import("@prisma/client").PrismaClient} prisma
 * @param {AdminTransactionsListRawArgs} args
 * @returns {Promise<number>}
 */
export async function countAdminTransactionsListRaw(prisma, args) {
  const p = rawListParams(args);
  const parts = adminTransactionsWhereParts(p);
  const rows = await prisma.$queryRaw(
    Prisma.sql`
      SELECT COUNT(*)::int AS cnt
      ${FROM_SQL}
      WHERE ${Prisma.join(parts, " AND ")}
    `,
  );
  return Number(rows[0]?.cnt ?? 0);
}

/**
 * @param {import("@prisma/client").PrismaClient} prisma
 * @param {AdminTransactionsListRawArgs & { skip: number, take: number }} args
 * @returns {Promise<object[]>}
 */
export async function listAdminTransactionsListRaw(prisma, args) {
  const p = rawListParams(args);
  const parts = adminTransactionsWhereParts(p);
  const rows = await prisma.$queryRaw(
    Prisma.sql`
      SELECT
        t.id,
        t.wallet_id,
        t.payer_user_id,
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
        wm.id AS wm_id,
        wm.email AS wm_email,
        wm.display_name AS wm_display_name,
        wm.reseller_partner_id AS wm_reseller_partner_id,
        wm_rp.email AS wm_rp_email,
        wm_rp.display_name AS wm_rp_display_name,
        pu.id AS pu_id,
        pu.external_user_id AS pu_external_user_id,
        pu.merchant_id AS pu_merchant_id,
        pum.id AS pum_id,
        pum.email AS pum_email,
        pum.display_name AS pum_display_name,
        au.id AS au_id,
        au.external_user_id AS au_external_user_id
      ${FROM_SQL}
      WHERE ${Prisma.join(parts, " AND ")}
      ORDER BY t.created_at DESC
      LIMIT ${args.take}
      OFFSET ${args.skip}
    `,
  );
  return rows.map(mapAdminTransactionListRow);
}
