import { WithdrawalStatus } from "@prisma/client";
import { ACTIVE } from "../lib/active-row.js";
import { prisma } from "../lib/prisma.js";
import { fillMissingWithdrawalNetworkFees } from "./payout-withdrawal-network-fee.js";

/**
 * Admin ops: update payout row (terminal transitions only — no merchant HTTP webhook).
 *
 * @param {number} withdrawalId
 * @param {{
 *   status?: unknown,
 *   tx_hash?: unknown,
 *   failure_reason?: unknown,
 * }} body
 */
export async function adminPatchWithdrawal(withdrawalId, body) {
  const id =
    typeof withdrawalId === "number" && Number.isInteger(withdrawalId) && withdrawalId >= 1
      ? withdrawalId
      : parseInt(String(withdrawalId ?? "").trim(), 10);
  if (!Number.isInteger(id) || id < 1) {
    return { ok: false, status: 400, error: "invalid_withdrawal_id" };
  }

  const row = await prisma.withdrawal.findFirst({
    where: { id, ...ACTIVE },
  });
  if (!row) {
    return { ok: false, status: 404, error: "not_found" };
  }

  const data = {};
  if (body.tx_hash !== undefined) {
    const h = body.tx_hash == null ? null : String(body.tx_hash).trim();
    data.txHash = h || null;
  }
  if (body.failure_reason !== undefined) {
    const fr = body.failure_reason == null ? null : String(body.failure_reason).trim();
    data.failureReason = fr || null;
  }

  let nextStatus = row.status;
  if (body.status !== undefined && body.status !== null && String(body.status).trim()) {
    const s = String(body.status).trim();
    if (!Object.values(WithdrawalStatus).includes(s)) {
      return { ok: false, status: 400, error: "invalid_status" };
    }
    nextStatus = s;
  }
  data.status = nextStatus;

  const wasTerminal =
    row.status === WithdrawalStatus.completed || row.status === WithdrawalStatus.failed;
  const isTerminal =
    nextStatus === WithdrawalStatus.completed || nextStatus === WithdrawalStatus.failed;

  await prisma.withdrawal.update({
    where: { id },
    data,
  });

  const fresh = await prisma.withdrawal.findFirst({
    where: { id, ...ACTIVE },
  });
  if (fresh) {
    await fillMissingWithdrawalNetworkFees([fresh]);
  }
  return { ok: true, withdrawal: fresh };
}
