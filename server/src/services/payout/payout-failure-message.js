/**
 * Turn noisy chain/RPC detail into short operator-facing text.
 *
 * @param {string} detail
 * @returns {string | null} Human text, or null to omit the raw detail.
 */
function humanizeFailureDetail(detail) {
  const d = String(detail ?? "").trim();
  if (!d) return null;
  const lower = d.toLowerCase();

  if (
    lower.includes("not enough energy") ||
    lower.includes("out of energy") ||
    lower.includes("curinvokeenergylimit") ||
    lower.includes("penaltyenergy") ||
    lower.includes("usedenergy") ||
    /\bsstore\b/i.test(d)
  ) {
    return "The main wallet does not have enough TRX energy to run this step. Add more TRX to the RP Swap main wallet, or set a merchant TRX funder key, then retry.";
  }
  if (
    lower.includes("not enough bandwidth") ||
    lower.includes("account resource insufficient") ||
    (lower.includes("bandwidth") && lower.includes("insufficient"))
  ) {
    return "The main wallet does not have enough TRX bandwidth. Add more TRX to the RP Swap main wallet, or set a merchant TRX funder key, then retry.";
  }
  if (lower.includes("contract validate error") && lower.includes("balance")) {
    return "On-chain balance check failed for this step.";
  }

  // Keep short, already-readable details; drop raw Error dumps.
  if (/^error:\s*/i.test(d) || d.length > 180) return null;
  return d;
}

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
  const humanDetail = humanizeFailureDetail(detail);

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
    rp_swap_main_wallet_required:
      "Set this merchant’s main wallet under RP → Swap first. Live TRON payouts only send from that wallet (not the platform hot wallet).",
    payout_hot_wallet_not_configured:
      "Platform payout hot wallet is not configured (PAYOUT_HOT_PRIVATE_KEY_*).",
    payout_hot_wallet_key_invalid: "Platform payout hot wallet private key is invalid.",
    payout_treasury_not_signable:
      "Payout from-address cannot be signed. RP → Swap main wallet must be one of this merchant’s gateway USDT·TRC20 deposit wallets.",
    invalid_payout_treasury: "Payout treasury address is invalid for this chain.",
    merchant_mnemonic_unavailable: "Merchant wallet mnemonic is unavailable for signing.",
    derived_address_mismatch: "Derived wallet address did not match the payout from-address.",
    INSUFFICIENT_USDT_ON_CHAIN:
      "From-wallet does not hold enough USDT on-chain for this payout.",
    INSUFFICIENT_TRX_FOR_FEE:
      "Main wallet does not have enough TRX for network fees. Leave a little TRX there, or set a merchant TRX funder key / use SunSwap (needs a tiny TRX dust + spare USDT).",
    INSUFFICIENT_NATIVE_FOR_GAS: "From-wallet does not have enough ETH to pay gas.",
    TRX_FUNDER_REQUIRED:
      "TRX fee top-up is required. Fund the RP Swap main wallet with a little TRX (or USDT for SunSwap), or set a merchant TRX funder key.",
    MERCHANT_TRX_FUNDER_KEY_REQUIRED:
      "TRX fee top-up is required. Fund the RP Swap main wallet with a little TRX (or USDT for SunSwap), or set a merchant TRX funder key.",
    PAYOUT_TREASURY_NOT_SIGNABLE:
      "RP Swap main wallet cannot sign. Use a gateway USDT·TRC20 deposit wallet as the main address in RP → Swap.",
    SUNSWAP_NEEDS_TRX_DUST:
      "Main wallet has 0 TRX, so SunSwap cannot broadcast. Leave a small TRX balance on the main wallet (or set a merchant TRX funder key).",
    SUNSWAP_INSUFFICIENT_USDT:
      "Not enough USDT on the main wallet to buy TRX for fees while keeping the payout amount reserved.",
    SUNSWAP_QUOTE_FAILED: "Could not quote USDT→TRX on SunSwap for fee top-up.",
    SUNSWAP_APPROVE_FAILED: "Could not approve USDT for SunSwap fee top-up.",
    SUNSWAP_SWAP_FAILED: "SunSwap USDT→TRX fee top-up failed.",
    FUNDER_INSUFFICIENT_TRX:
      "TRX funder does not hold enough TRX to top up the main wallet fees.",
    TRANSFER_FAILED: "On-chain USDT transfer failed.",
    TX_REVERTED: "On-chain USDT transfer reverted.",
    NO_GAS_PRICE: "Could not fetch a gas price for the payout chain.",
    INVALID_FROM_PRIVATE_KEY: "Payout from-wallet private key is invalid.",
    SOURCE_IS_DESTINATION: "Payout from-address and to-address must differ.",
    auto_payout_timeout: "Payout timed out while processing.",
    auto_payout_error: "Unexpected error while processing the payout.",
  };

  const base = byCode[code] ?? byCode[r] ?? null;
  // Energy/bandwidth details already include the fix — prefer that over appending raw RPC text.
  if (
    humanDetail &&
    (code === "SUNSWAP_APPROVE_FAILED" ||
      code === "SUNSWAP_SWAP_FAILED" ||
      code === "TRANSFER_FAILED" ||
      code === "TX_REVERTED")
  ) {
    const lower = humanDetail.toLowerCase();
    if (lower.includes("energy") || lower.includes("bandwidth")) {
      return humanDetail;
    }
  }
  if (base && humanDetail && !base.includes(humanDetail)) {
    return `${base} ${humanDetail}`;
  }
  if (base) return base;
  if (humanDetail) return humanDetail;
  return r;
}
