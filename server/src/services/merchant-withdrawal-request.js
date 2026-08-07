import { Chain, MerchantGatewayEnv, Prisma, WithdrawalStatus } from "@prisma/client";
import { ethers } from "ethers";
import { utils as tronUtils } from "tronweb";
import { ACTIVE } from "../lib/active-row.js";
import {
  feeAmountFromPercent,
  parseHumanMinSettlementToAtomic,
} from "../lib/merchant-fee-math.js";
import { parseOptionalGatewayDepositAmount } from "../lib/gateway-expected-amount.js";
import { prisma } from "../lib/prisma.js";
import { computeMerchantBalances } from "./merchant-balance.js";

/** @typedef {{ chain: Chain, tokenDecimals: number }} WithdrawalRail */

const USDT = "USDT";

/**
 * @param {unknown} chainInput
 * @param {unknown} tokenInput
 * @returns {WithdrawalRail | null}
 */
export function resolveMerchantWithdrawalRail(chainInput, tokenInput) {
  const c = String(chainInput ?? "")
    .trim()
    .toUpperCase();
  const t = String(tokenInput ?? "")
    .trim()
    .toUpperCase();
  if (t !== USDT) return null;
  if (c === "TRON") return { chain: Chain.TRON, tokenDecimals: 6 };
  if (c === "ETH" || c === "ETHEREUM") return { chain: Chain.ETH, tokenDecimals: 6 };
  return null;
}

/**
 * @param {Chain} chain
 * @param {unknown} toRaw
 * @returns {{ ok: true, toAddress: string } | { ok: false, error: string }}
 */
export function normalizeWithdrawalToAddress(chain, toRaw) {
  const raw = String(toRaw ?? "").trim();
  if (!raw) return { ok: false, error: "to_address_required" };
  if (chain === Chain.TRON) {
    try {
      tronUtils.address.toHex(raw);
      return { ok: true, toAddress: raw };
    } catch {
      return { ok: false, error: "invalid_tron_address" };
    }
  }
  try {
    return { ok: true, toAddress: ethers.getAddress(raw) };
  } catch {
    return { ok: false, error: "invalid_evm_address" };
  }
}

/**
 * @param {number} merchantId
 * @param {MerchantGatewayEnv} environment
 */
export async function merchantHasPendingPayout(merchantId, environment) {
  const n = await prisma.withdrawal.count({
    where: {
      merchantId,
      environment,
      status: { in: [WithdrawalStatus.pending, WithdrawalStatus.processing] },
      ...ACTIVE,
    },
  });
  return n > 0;
}

/**
 * @param {bigint} gross
 * @param {unknown} payoutMinHuman
 * @param {unknown} payoutMaxHuman
 * @param {number} decimals
 */
function validateGrossAgainstMerchantPayoutLimits(
  gross,
  payoutMinHuman,
  payoutMaxHuman,
  decimals,
) {
  const minS = String(payoutMinHuman ?? "0").trim();
  if (minS && minS !== "0" && !/^0\.0*$/.test(minS)) {
    const pr = parseHumanMinSettlementToAtomic(minS, decimals);
    if (!pr.ok) {
      return {
        ok: false,
        status: 400,
        error: "invalid_payout_min_config",
        message: "Merchant payout minimum is misconfigured (portal settings).",
      };
    }
    if (gross < pr.value) {
      return {
        ok: false,
        status: 400,
        error: "below_merchant_payout_minimum",
        message: `Gross amount is below your minimum payout (${minS} USDT).`,
      };
    }
  }
  const maxS = String(payoutMaxHuman ?? "0").trim();
  if (maxS && maxS !== "0" && !/^0\.0*$/.test(maxS)) {
    const pr = parseHumanMinSettlementToAtomic(maxS, decimals);
    if (!pr.ok) {
      return {
        ok: false,
        status: 400,
        error: "invalid_payout_max_config",
        message: "Merchant payout maximum is misconfigured (portal settings).",
      };
    }
    if (pr.value > 0n && gross > pr.value) {
      return {
        ok: false,
        status: 400,
        error: "above_merchant_payout_maximum",
        message: `Gross amount exceeds your maximum payout (${maxS} USDT).`,
      };
    }
  }
  return { ok: true };
}

/**
 * Creates a payout request: **gross** is debited from portal balance and is the **full on-chain send** (recipient gets
 * gross). **Payout MDR** (`rates.payoutMdrPercent`) is stored for RP/admin **reference billing only** — it does not
 * reduce net sent or portal debit (no deposit settlement % on payouts; min settlement does not apply).
 *
 * @param {{
 *   merchantId: number,
 *   environment: MerchantGatewayEnv,
 *   chainInput: unknown,
 *   tokenSymbolInput: unknown,
 *   toAddressRaw: unknown,
 *   amountRaw: unknown,
 *   rates: { payoutMdrPercent?: unknown },
 *   payoutPolicy?: { payoutMinAmountHuman?: unknown, payoutMaxAmountHuman?: unknown },
 *   clientReferenceId?: unknown,
 *   source?: "portal" | "gateway_api",
 * }} p
 */
export async function createMerchantWithdrawalRequest(p) {
  const rail = resolveMerchantWithdrawalRail(p.chainInput, p.tokenSymbolInput);
  if (!rail) {
    return {
      ok: false,
      status: 400,
      error: "unsupported_withdrawal_rail",
      message: "Withdrawals support USDT on TRON or ETH (ERC20) only.",
    };
  }
  const to = normalizeWithdrawalToAddress(rail.chain, p.toAddressRaw);
  if (!to.ok) {
    return { ok: false, status: 400, error: to.error };
  }

  const parsed = parseOptionalGatewayDepositAmount(p.amountRaw, rail.tokenDecimals);
  if (!parsed.ok) {
    return { ok: false, status: 400, error: parsed.error };
  }
  if (parsed.atomic == null) {
    return {
      ok: false,
      status: 400,
      error: "amount_required",
      message: "amount is required (decimal or whole USDT units, same as gateway deposits).",
    };
  }

  const gross = BigInt(parsed.atomic);
  if (gross <= 0n) {
    return {
      ok: false,
      status: 400,
      error: "invalid_amount",
      message: "amount must be greater than zero.",
    };
  }

  if (await merchantHasPendingPayout(p.merchantId, p.environment)) {
    return {
      ok: false,
      status: 409,
      error: "payout_already_pending",
      message:
        "Another payout is already pending or processing. Wait until it completes or fails before requesting a new one.",
    };
  }

  const refRaw =
    p.clientReferenceId != null ? String(p.clientReferenceId).trim() : "";
  const clientRef = refRaw.slice(0, 256);
  if (clientRef) {
    const exists = await prisma.withdrawal.findFirst({
      where: {
        merchantId: p.merchantId,
        environment: p.environment,
        clientReferenceId: clientRef,
        ...ACTIVE,
      },
      select: { id: true },
    });
    if (exists) {
      return {
        ok: false,
        status: 409,
        error: "client_reference_exists",
        message: "client_reference_id was already used for a payout in this environment.",
      };
    }
  }

  const policy = p.payoutPolicy ?? {};
  const bounds = validateGrossAgainstMerchantPayoutLimits(
    gross,
    policy.payoutMinAmountHuman,
    policy.payoutMaxAmountHuman,
    rail.tokenDecimals,
  );
  if (!bounds.ok) return bounds;

  const mdrP = Number(p.rates.payoutMdrPercent ?? 0);
  const mdrReferenceAtomic = feeAmountFromPercent(gross, mdrP);

  const buckets = await computeMerchantBalances(p.merchantId, p.environment);
  const bucket = buckets.find(
    (b) =>
      String(b.chain) === String(rail.chain) &&
      b.token_symbol.toUpperCase() === USDT &&
      b.token_decimals === rail.tokenDecimals,
  );
  const available = bucket ? BigInt(bucket.balance_raw) : 0n;
  if (available < gross) {
    return {
      ok: false,
      status: 400,
      error: "insufficient_balance",
      message: "Not enough settled balance for this gross payout.",
    };
  }

  const grossStr = gross.toString();
  const source = p.source === "gateway_api" ? "gateway_api" : "portal";

  const row = await prisma.withdrawal.create({
    data: {
      merchantId: p.merchantId,
      environment: p.environment,
      chain: rail.chain,
      tokenSymbol: USDT,
      tokenDecimals: rail.tokenDecimals,
      toAddress: to.toAddress,
      amount: grossStr,
      grossAmount: grossStr,
      netAmount: grossStr,
      mdrAmount: mdrReferenceAtomic.toString(),
      settlementFeeAmount: "0",
      mdrPercent: new Prisma.Decimal(String(mdrP)),
      settlementRatePercent: new Prisma.Decimal("0"),
      status: WithdrawalStatus.pending,
      source,
      ...(clientRef ? { clientReferenceId: clientRef } : {}),
    },
  });

  return { ok: true, withdrawal: row };
}
