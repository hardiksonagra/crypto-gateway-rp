/**
 * Human-readable payout failure message for gateway responses (sandbox + live).
 *
 * @param {string | null | undefined} status
 * @param {string | null | undefined} failureReason
 * @returns {string | null}
 */
export function payoutFailureMessage(status, failureReason) {
  if (String(status ?? "") !== "failed") return null;
  const r = String(failureReason ?? "").trim();
  if (!r) return "Payout failed.";

  const code = r.includes(":") ? r.slice(0, r.indexOf(":")).trim() : r;
  const detail = r.includes(":") ? r.slice(r.indexOf(":") + 1).trim() : "";

  /** @type {Record<string, string>} */
  const byCode = {
    force_fail:
      "Simulated payout failure (simulate_result: \"failed\", FAIL-TEST…, or force_fail: true). No on-chain transfer was sent.",
    sandbox_force_fail:
      "Simulated payout failure (simulate_result: \"failed\", FAIL-TEST…, or force_fail: true). No on-chain transfer was sent.",
    insufficient_balance: "Not enough settled balance for this gross payout.",
    below_merchant_payout_minimum: "Gross amount is below the merchant minimum payout.",
    above_merchant_payout_maximum: "Gross amount exceeds the merchant maximum payout.",
    invalid_payout_min_config: "Merchant payout minimum is misconfigured.",
    invalid_payout_max_config: "Merchant payout maximum is misconfigured.",
    merchant_not_found: "Merchant account was not found for this payout.",
    unsupported_payout_chain: "This payout chain is not supported.",
    payout_hot_wallet_not_configured:
      "Platform payout hot wallet is not configured (PAYOUT_HOT_PRIVATE_KEY_*).",
    payout_hot_wallet_key_invalid: "Platform payout hot wallet private key is invalid.",
    payout_treasury_not_signable:
      "Payout treasury address cannot be signed. Use the platform hot wallet address or a gateway USDT deposit wallet.",
    invalid_payout_treasury: "Payout treasury address is invalid for this chain.",
    merchant_mnemonic_unavailable: "Merchant wallet mnemonic is unavailable for signing.",
    derived_address_mismatch: "Derived wallet address did not match the payout from-address.",
    INSUFFICIENT_USDT_ON_CHAIN:
      "From-wallet does not hold enough USDT on-chain for this payout.",
    INSUFFICIENT_TRX_FOR_FEE: "From-wallet does not have enough TRX to pay network fees.",
    INSUFFICIENT_NATIVE_FOR_GAS: "From-wallet does not have enough ETH to pay gas.",
    TRX_FUNDER_REQUIRED:
      "TRX fee top-up is required. Save a TRX funder private key under Gateway & webhooks, or set a USDT·TRC20 payout treasury (gateway deposit wallet).",
    MERCHANT_TRX_FUNDER_KEY_REQUIRED:
      "TRX fee top-up is required. Save a TRX funder private key under Gateway & webhooks, or set a USDT·TRC20 payout treasury with TRX.",
    PAYOUT_TREASURY_NOT_SIGNABLE:
      "Payout treasury cannot sign TRX fee funding. Use a gateway USDT·TRC20 deposit wallet as treasury.",
    SUNSWAP_NEEDS_TRX_DUST:
      "Payout treasury has 0 TRX so SunSwap cannot run. Leave a small TRX balance on the treasury or configure a TRX funder key.",
    SUNSWAP_INSUFFICIENT_USDT:
      "Not enough USDT on the payout treasury to buy TRX for fees while keeping the payout amount reserved.",
    SUNSWAP_QUOTE_FAILED: "Could not quote USDT→TRX on SunSwap for fee top-up.",
    SUNSWAP_APPROVE_FAILED: "USDT approve for SunSwap fee top-up failed.",
    SUNSWAP_SWAP_FAILED: "SunSwap USDT→TRX fee top-up failed.",
    FUNDER_INSUFFICIENT_TRX:
      "TRX funder (or payout treasury) does not hold enough TRX to top up fees.",
    TRANSFER_FAILED: "On-chain USDT transfer failed.",
    TX_REVERTED: "On-chain USDT transfer reverted.",
    NO_GAS_PRICE: "Could not fetch a gas price for the payout chain.",
    INVALID_FROM_PRIVATE_KEY: "Payout from-wallet private key is invalid.",
    SOURCE_IS_DESTINATION: "Payout from-address and to-address must differ.",
    auto_payout_timeout: "Payout timed out while processing.",
    auto_payout_error: "Unexpected error while processing the payout.",
  };

  const base = byCode[code] ?? byCode[r] ?? null;
  if (base && detail && !base.includes(detail)) {
    return `${base} (${detail})`;
  }
  if (base) return base;
  return r;
}
