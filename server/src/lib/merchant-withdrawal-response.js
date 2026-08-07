import { formatAtomicAmountString } from "./format-atomic-amount.js";

/**
 * @param {string | null | undefined} sym
 */
function nativeNetworkFeeDecimals(sym) {
  const s = String(sym ?? "").toUpperCase();
  if (s === "TRX") return 6;
  if (s === "ETH") return 18;
  return 18;
}

/**
 * Gateway payout API (`POST`/`GET …/gateway/payout`): amounts + on-chain network fee only — no MDR / settlement fee fields.
 *
 * @param {import("@prisma/client").Withdrawal} w
 */
export function withdrawalGatewayPayoutJson(w) {
  const dec = w.tokenDecimals ?? 6;
  const grossAtomic = w.grossAmount?.trim() || w.amount;
  const netAtomic = w.netAmount?.trim() ?? null;
  const nfAtomic = w.networkFeeNativeAtomic?.trim() ?? null;
  const nfSym = w.networkFeeNativeSymbol?.trim() ?? null;
  const nfDec =
    nfAtomic && nfSym
      ? formatAtomicAmountString(nfAtomic, nativeNetworkFeeDecimals(nfSym))
      : null;
  return {
    id: w.id,
    environment: w.environment,
    chain: w.chain,
    token_symbol: w.tokenSymbol,
    token_decimals: dec,
    to_address: w.toAddress,
    amount: w.amount,
    gross_amount_atomic: grossAtomic,
    gross_amount_decimal: formatAtomicAmountString(grossAtomic, dec),
    net_amount_atomic: netAtomic,
    net_amount_decimal:
      netAtomic != null ? formatAtomicAmountString(netAtomic, dec) : null,
    status: w.status,
    tx_hash: w.txHash,
    network_fee_native_atomic: nfAtomic,
    network_fee_native_symbol: nfSym,
    network_fee_native_decimal: nfDec,
    network_fee_fetched_at: w.networkFeeFetchedAt ?? null,
    failure_reason: w.failureReason,
    client_reference_id: w.clientReferenceId ?? null,
    source: w.source ?? "portal",
    callback_delivered_at: w.callbackDeliveredAt ?? null,
    created_at: w.createdAt,
    updated_at: w.updatedAt,
  };
}

/**
 * @param {import("@prisma/client").Withdrawal} w
 */
export function withdrawalPublicJson(w) {
  const dec = w.tokenDecimals ?? 6;
  const grossAtomic = w.grossAmount?.trim() || w.amount;
  const netAtomic = w.netAmount?.trim() ?? null;
  const nfAtomic = w.networkFeeNativeAtomic?.trim() ?? null;
  const nfSym = w.networkFeeNativeSymbol?.trim() ?? null;
  const nfDec =
    nfAtomic && nfSym
      ? formatAtomicAmountString(nfAtomic, nativeNetworkFeeDecimals(nfSym))
      : null;
  return {
    id: w.id,
    environment: w.environment,
    chain: w.chain,
    token_symbol: w.tokenSymbol,
    token_decimals: dec,
    to_address: w.toAddress,
    amount: w.amount,
    gross_amount_atomic: grossAtomic,
    gross_amount_decimal: formatAtomicAmountString(grossAtomic, dec),
    net_amount_atomic: netAtomic,
    net_amount_decimal:
      netAtomic != null ? formatAtomicAmountString(netAtomic, dec) : null,
    mdr_amount_atomic: w.mdrAmount ?? null,
    settlement_fee_amount_atomic: w.settlementFeeAmount ?? null,
    mdr_percent: w.mdrPercent != null ? Number(w.mdrPercent) : null,
    settlement_rate_percent:
      w.settlementRatePercent != null ? Number(w.settlementRatePercent) : null,
    mdr_amount_decimal:
      w.mdrAmount != null ? formatAtomicAmountString(w.mdrAmount, dec) : null,
    settlement_fee_amount_decimal:
      w.settlementFeeAmount != null
        ? formatAtomicAmountString(w.settlementFeeAmount, dec)
        : null,
    status: w.status,
    tx_hash: w.txHash,
    network_fee_native_atomic: nfAtomic,
    network_fee_native_symbol: nfSym,
    network_fee_native_decimal: nfDec,
    network_fee_fetched_at: w.networkFeeFetchedAt ?? null,
    failure_reason: w.failureReason,
    client_reference_id: w.clientReferenceId ?? null,
    source: w.source ?? "portal",
    callback_delivered_at: w.callbackDeliveredAt ?? null,
    created_at: w.createdAt,
    updated_at: w.updatedAt,
  };
}
