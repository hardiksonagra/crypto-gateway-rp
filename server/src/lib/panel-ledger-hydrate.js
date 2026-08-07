import { ACTIVE } from "./active-row.js";
import { formatAtomicAmountString } from "./format-atomic-amount.js";
import {
  expectedReceivedAmountQuadForTransaction,
  loadExpectedAtomicByWalletSessionForTransactions,
  requestedAmountFieldsForTransaction,
} from "./transaction-requested-amounts.js";
import { withdrawalPublicJson } from "./merchant-withdrawal-response.js";
import { fillMissingWithdrawalNetworkFees } from "../services/payout-withdrawal-network-fee.js";

/**
 * @param {import("@prisma/client").Transaction & {
 *   payerUser?: unknown,
 *   wallet: import("@prisma/client").Wallet & {
 *     merchant: import("@prisma/client").Merchant & { resellerPartner?: unknown },
 *     assignedUser?: unknown,
 *   },
 * }} t
 * @param {Awaited<ReturnType<typeof import("./transaction-requested-amounts.js").loadExpectedAtomicByWalletSessionForTransactions>>} expectedByKey
 */
export function formatAdminRpDepositTransactionJson(t, expectedByKey) {
  const endUser = t.payerUser ?? t.wallet.assignedUser;
  const merch = t.wallet.merchant;
  const rpId = merch.resellerPartnerId ?? null;
  const rpEmail = merch.resellerPartner?.email ?? null;
  const rpDisplay = merch.resellerPartner?.displayName ?? null;
  const merchantOut = {
    id: merch.id,
    email: merch.email,
    display_name: merch.displayName ?? null,
    reseller_partner_id: rpId,
    reseller_partner_email: rpEmail,
    reseller_partner_display_name: rpDisplay,
  };
  return {
    id: t.id,
    transaction_id: t.referenceTransactionId ?? null,
    tx_hash: t.txHash,
    chain: t.chain,
    status: t.status,
    token_symbol: t.tokenSymbol,
    token_decimals: t.tokenDecimals,
    amount: t.amount,
    amount_decimal: formatAtomicAmountString(t.amount, t.tokenDecimals),
    ...requestedAmountFieldsForTransaction(t, expectedByKey),
    ...expectedReceivedAmountQuadForTransaction(t, expectedByKey),
    confirmations: t.confirmations,
    from_address: t.fromAddress,
    to_address: t.toAddress,
    wallet_id: t.walletId,
    wallet_address: t.wallet.address,
    currency: t.wallet.currency,
    network: t.wallet.network,
    block_number: t.blockNumber?.toString() ?? null,
    log_index: t.logIndex,
    callback_delivered_at: t.callbackDeliveredAt,
    end_user_id: endUser?.id ?? null,
    external_user_id: endUser?.externalUserId ?? null,
    gateway_environment: t.wallet.environment,
    merchant: merchantOut,
    merchant_id: merchantOut.id,
    merchant_email: merchantOut.email,
    reseller_partner_id: rpId,
    reseller_partner_email: rpEmail,
    reseller_partner_display_name: rpDisplay,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
  };
}

/**
 * @param {import("@prisma/client").Withdrawal & {
 *   merchant: import("@prisma/client").Merchant & { resellerPartner?: unknown },
 * }} w
 */
export function formatAdminRpPayoutExtras(w) {
  const merch = w.merchant;
  const rpId = merch.resellerPartnerId ?? null;
  const rpEmail = merch.resellerPartner?.email ?? null;
  const rpDisplay = merch.resellerPartner?.displayName ?? null;
  const merchantOut = {
    id: merch.id,
    email: merch.email,
    display_name: merch.displayName ?? null,
    reseller_partner_id: rpId,
    reseller_partner_email: rpEmail,
    reseller_partner_display_name: rpDisplay,
  };
  return {
    payout: withdrawalPublicJson(w),
    merchant: merchantOut,
    merchant_id: merchantOut.id,
    merchant_email: merchantOut.email,
    reseller_partner_id: rpId,
    reseller_partner_email: rpEmail,
    reseller_partner_display_name: rpDisplay,
    callback_delivered_at: w.callbackDeliveredAt ?? null,
  };
}

/**
 * @param {import("@prisma/client").PrismaClient} prisma
 * @param {{ entry_kind: string, entry_id: number }[]} unionRows
 * @param {number[]} allowedMerchantIds
 * @param {import("@prisma/client").MerchantGatewayEnv} listEnv
 */
export async function hydrateAdminRpLedger(prisma, unionRows, allowedMerchantIds, listEnv) {
  const mids = [...new Set(allowedMerchantIds)].filter((n) => Number.isInteger(n) && n >= 1);
  if (mids.length === 0) return { ledger: [], txRows: [] };

  const depIds = unionRows.filter((u) => u.entry_kind === "deposit").map((u) => u.entry_id);
  const payIds = unionRows.filter((u) => u.entry_kind === "payout").map((u) => u.entry_id);

  const [txRows, wdRows] = await Promise.all([
    depIds.length
      ? prisma.transaction.findMany({
          where: {
            id: { in: depIds },
            ...ACTIVE,
            wallet: {
              is: {
                merchantId: { in: mids },
                environment: listEnv,
                ...ACTIVE,
              },
            },
          },
          include: {
            payerUser: {
              include: {
                merchant: {
                  select: {
                    id: true,
                    email: true,
                    displayName: true,
                    resellerPartnerId: true,
                    resellerPartner: { select: { id: true, email: true, displayName: true } },
                  },
                },
              },
            },
            wallet: {
              include: {
                merchant: {
                  select: {
                    id: true,
                    email: true,
                    displayName: true,
                    resellerPartnerId: true,
                    resellerPartner: { select: { id: true, email: true, displayName: true } },
                  },
                },
                assignedUser: { select: { id: true, externalUserId: true } },
              },
            },
          },
        })
      : [],
    payIds.length
      ? prisma.withdrawal.findMany({
          where: {
            id: { in: payIds },
            merchantId: { in: mids },
            environment: listEnv,
            ...ACTIVE,
          },
          include: {
            merchant: {
              select: {
                id: true,
                email: true,
                displayName: true,
                resellerPartnerId: true,
                resellerPartner: { select: { id: true, email: true, displayName: true } },
              },
            },
          },
        })
      : [],
  ]);

  await fillMissingWithdrawalNetworkFees(wdRows);

  const tm = new Map(txRows.map((t) => [t.id, t]));
  const wm = new Map(wdRows.map((w) => [w.id, w]));

  const expectedByKey = await loadExpectedAtomicByWalletSessionForTransactions(txRows);

  /** @type {object[]} */
  const ledger = [];
  for (const ur of unionRows) {
    if (ur.entry_kind === "deposit") {
      const t = tm.get(ur.entry_id);
      if (!t) continue;
      ledger.push({
        kind: "deposit",
        created_at: t.createdAt,
        deposit: formatAdminRpDepositTransactionJson(t, expectedByKey),
      });
    } else {
      const w = wm.get(ur.entry_id);
      if (!w) continue;
      ledger.push({
        kind: "payout",
        created_at: w.createdAt,
        ...formatAdminRpPayoutExtras(w),
      });
    }
  }

  return { ledger, txRows };
}
