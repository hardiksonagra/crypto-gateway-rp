import { Chain, MerchantGatewayEnv, WithdrawalStatus } from "@prisma/client";
import { ACTIVE } from "../../lib/active-row.js";
import { logger } from "../../lib/logger.js";
import { prisma } from "../../lib/prisma.js";
import {
  effectivePayoutPolicyForRail,
  payoutRailKeyForChain,
} from "../../lib/merchant-payout-rails-policy.js";
import { fillMissingWithdrawalNetworkFees } from "../payout-withdrawal-network-fee.js";
import {
  transferEvmUsdtAmount,
  transferTronUsdtAmount,
} from "./payout-usdt-transfer.js";
import { resolvePayoutSigner } from "./resolve-payout-signer.js";
import { simulatedPayoutOutcome } from "./payout-test-refs.js";

/**
 * @param {number} id
 * @param {{ status?: import("@prisma/client").WithdrawalStatus, txHash?: string | null, failureReason?: string | null }} data
 */
async function patchWithdrawal(id, data) {
  await prisma.withdrawal.update({
    where: { id },
    data: {
      ...(data.status != null ? { status: data.status } : {}),
      ...(data.txHash !== undefined ? { txHash: data.txHash } : {}),
      ...(data.failureReason !== undefined ? { failureReason: data.failureReason } : {}),
    },
  });
  const fresh = await prisma.withdrawal.findFirst({ where: { id, ...ACTIVE } });
  if (fresh?.txHash) {
    await fillMissingWithdrawalNetworkFees([fresh]);
  }
  return prisma.withdrawal.findFirst({ where: { id, ...ACTIVE } });
}

/**
 * Simulated payout (no chain): same JSON fields for sandbox + live test refs.
 *
 * @param {number} id
 * @param {"failed" | "completed"} outcome
 */
async function applySimulatedPayoutOutcome(id, outcome) {
  if (outcome === "failed") {
    const fresh = await patchWithdrawal(id, {
      status: WithdrawalStatus.failed,
      txHash: null,
      failureReason: "force_fail",
    });
    return { ok: false, error: "force_fail", withdrawal: fresh };
  }
  const fresh = await patchWithdrawal(id, {
    status: WithdrawalStatus.completed,
    txHash: `sandbox-payout:${id}`,
    failureReason: null,
  });
  return { ok: true, withdrawal: fresh };
}

/**
 * Execute auto payout for one withdrawal row.
 * - Sandbox: always simulated (SUCCESS-TEST / FAIL-TEST / default success).
 * - Live: SUCCESS-TEST-* / FAIL-TEST-* / force_fail → same simulation + response as sandbox;
 *   otherwise real on-chain send.
 *
 * @param {number} withdrawalId
 * @param {{ forceFail?: unknown, simulateResult?: unknown }} [opts]
 * @returns {Promise<{ ok: true, withdrawal: import("@prisma/client").Withdrawal | null } | { ok: false, error: string, withdrawal: import("@prisma/client").Withdrawal | null }>}
 */
export async function executeAutoPayout(withdrawalId, opts = {}) {
  const id =
    typeof withdrawalId === "number" && Number.isInteger(withdrawalId)
      ? withdrawalId
      : parseInt(String(withdrawalId ?? ""), 10);
  if (!Number.isInteger(id) || id < 1) {
    return { ok: false, error: "invalid_withdrawal_id", withdrawal: null };
  }

  try {
    const row = await prisma.withdrawal.findFirst({
      where: { id, ...ACTIVE },
    });
    if (!row) {
      return { ok: false, error: "not_found", withdrawal: null };
    }
    if (
      row.status === WithdrawalStatus.completed ||
      row.status === WithdrawalStatus.failed
    ) {
      return { ok: true, withdrawal: row };
    }

    const isSandbox =
      String(row.environment) === String(MerchantGatewayEnv.sandbox);

    /** Simulation (`simulate_result` / FAIL-TEST / SUCCESS-TEST / force_fail) is sandbox-only — ignored on live. */
    if (isSandbox) {
      const outcome = simulatedPayoutOutcome(
        opts.forceFail,
        row.clientReferenceId,
        opts.simulateResult,
      );
      return applySimulatedPayoutOutcome(id, outcome);
    }

    if (row.status === WithdrawalStatus.pending) {
      await prisma.withdrawal.updateMany({
        where: { id, status: WithdrawalStatus.pending, ...ACTIVE },
        data: { status: WithdrawalStatus.processing },
      });
    }

    const merchant = await prisma.merchant.findFirst({
      where: { id: row.merchantId, ...ACTIVE },
      select: {
        payoutMinAmountHuman: true,
        payoutMaxAmountHuman: true,
        payoutRailsPolicyJson: true,
        payoutTreasuryAddressesJson: true,
      },
    });
    if (!merchant) {
      const fresh = await patchWithdrawal(id, {
        status: WithdrawalStatus.failed,
        failureReason: "merchant_not_found",
      });
      return { ok: false, error: "merchant_not_found", withdrawal: fresh };
    }

    const railKey = payoutRailKeyForChain(row.chain);
    const policy =
      railKey != null
        ? effectivePayoutPolicyForRail(merchant, railKey)
        : { min: "0", max: "0", treasury: "" };

    const signer = await resolvePayoutSigner({
      merchantId: row.merchantId,
      chain: row.chain,
      treasuryAddress: policy.treasury,
    });
    if (!signer.ok) {
      const fresh = await patchWithdrawal(id, {
        status: WithdrawalStatus.failed,
        failureReason: `${signer.error}: ${signer.message}`.slice(0, 2000),
      });
      return { ok: false, error: signer.error, withdrawal: fresh };
    }

    const amountAtomic = BigInt(
      String(row.netAmount?.trim() || row.grossAmount?.trim() || row.amount).trim(),
    );

    /** @type {{ ok: true, tx_hash: string } | { ok: false, error: string, detail?: string }} */
    let send;
    if (row.chain === Chain.TRON) {
      send = await transferTronUsdtAmount({
        privateKeyHex: signer.privateKeyHex,
        fromAddress: signer.fromAddress,
        toAddress: row.toAddress,
        amountAtomic,
        merchantIdForTrxTopup: signer.merchantIdForTrxTopup,
        allowPlatformTrxFunder: signer.allowPlatformTrxFunder,
      });
    } else if (row.chain === Chain.ETH) {
      send = await transferEvmUsdtAmount({
        privateKeyHex: signer.privateKeyHex,
        fromAddress: signer.fromAddress,
        toAddress: row.toAddress,
        amountAtomic,
      });
    } else {
      const fresh = await patchWithdrawal(id, {
        status: WithdrawalStatus.failed,
        failureReason: "unsupported_payout_chain",
      });
      return { ok: false, error: "unsupported_payout_chain", withdrawal: fresh };
    }

    if (!send.ok) {
      const reason = send.detail
        ? `${send.error}: ${send.detail}`.slice(0, 2000)
        : send.error;
      logger.warn("auto_payout_failed", {
        withdrawal_id: id,
        error: send.error,
        detail: send.detail,
        from: signer.fromAddress,
        source: signer.source,
      });
      const fresh = await patchWithdrawal(id, {
        status: WithdrawalStatus.failed,
        failureReason: reason,
      });
      return { ok: false, error: send.error, withdrawal: fresh };
    }

    logger.info("auto_payout_completed", {
      withdrawal_id: id,
      tx_hash: send.tx_hash,
      from: signer.fromAddress,
      source: signer.source,
    });
    const fresh = await patchWithdrawal(id, {
      status: WithdrawalStatus.completed,
      txHash: send.tx_hash,
      failureReason: null,
    });
    return { ok: true, withdrawal: fresh };
  } catch (e) {
    logger.error("auto_payout_unhandled", {
      withdrawal_id: id,
      err: String(e),
    });
    try {
      const fresh = await patchWithdrawal(id, {
        status: WithdrawalStatus.failed,
        failureReason: `auto_payout_error: ${String(e)}`.slice(0, 2000),
      });
      return { ok: false, error: "auto_payout_error", withdrawal: fresh };
    } catch {
      return { ok: false, error: "auto_payout_error", withdrawal: null };
    }
  }
}

/**
 * Drain legacy `pending` payouts (and mark very old stuck `processing` as failed).
 *
 * @param {{ limit?: number, stuckProcessingMinutes?: number }} [opts]
 */
export async function processPendingAutoPayouts(opts = {}) {
  const limit = Math.min(50, Math.max(1, Number(opts.limit) || 10));
  const stuckMins = Math.min(
    24 * 60,
    Math.max(5, Number(opts.stuckProcessingMinutes) || 15),
  );
  const stuckBefore = new Date(Date.now() - stuckMins * 60_000);

  const stuck = await prisma.withdrawal.findMany({
    where: {
      status: WithdrawalStatus.processing,
      txHash: null,
      updatedAt: { lt: stuckBefore },
      ...ACTIVE,
    },
    select: { id: true },
    take: limit,
    orderBy: { updatedAt: "asc" },
  });
  for (const s of stuck) {
    await patchWithdrawal(s.id, {
      status: WithdrawalStatus.failed,
      failureReason: `auto_payout_timeout: stuck processing > ${stuckMins}m without tx_hash`,
    });
  }

  const pending = await prisma.withdrawal.findMany({
    where: {
      status: WithdrawalStatus.pending,
      ...ACTIVE,
    },
    select: { id: true },
    take: limit,
    orderBy: { createdAt: "asc" },
  });

  let completed = 0;
  let failed = 0;
  for (const p of pending) {
    const r = await executeAutoPayout(p.id);
    if (r.ok && r.withdrawal?.status === WithdrawalStatus.completed) completed += 1;
    else failed += 1;
  }

  return {
    stuck_marked_failed: stuck.length,
    pending_attempted: pending.length,
    completed,
    failed,
  };
}
