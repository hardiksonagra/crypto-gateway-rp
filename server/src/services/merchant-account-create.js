import bcrypt from "bcrypt";
import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { generateApiKey, hashApiKey } from "../lib/api-key.js";
import { encryptMerchantApiKey } from "../lib/merchant-api-key-cipher.js";
import {
  assertValidMnemonicPhrase,
  encryptMerchantMnemonic,
} from "../lib/merchant-mnemonic.js";
import { depositRailKey } from "../config/payment-rails.js";
import { parseDefaultChainsArray } from "../lib/default-chains.js";
import {
  parseSupportedDepositRailsInput,
  pickMerchantDefaultPair,
} from "../lib/merchant-default-pair.js";
import {
  isValidFeePercent,
  parseFeePercent,
  parseSettlementPeriodDays,
  validateAndNormalizeHumanMinSettlement,
} from "../lib/merchant-fee-math.js";
import { ACTIVE } from "../lib/active-row.js";

/**
 * Shared merchant row creation for Control (`/control`) and RP (`/rp`) portals.
 *
 * @param {Record<string, unknown>} body
 * @param {{ resellerPartnerId?: number | null }} opts
 * @returns {Promise<
 *   | { ok: true, row: import("@prisma/client").Merchant, apiSecret: string, password: string }
 *   | { ok: false, status: number, json: Record<string, unknown> }
 * >}
 */
export async function createMerchantFromPanelBody(body, opts = {}) {
  const resellerPartnerId =
    opts.resellerPartnerId === undefined || opts.resellerPartnerId === null
      ? null
      : opts.resellerPartnerId;

  const email = body.email?.trim().toLowerCase();
  if (!email) {
    return { ok: false, status: 400, json: { error: "email required" } };
  }

  const mnemonicRaw = body.mnemonic;
  if (mnemonicRaw == null || String(mnemonicRaw).trim() === "") {
    return { ok: false, status: 400, json: { error: "mnemonic_required" } };
  }
  let mnemonicCipher;
  try {
    mnemonicCipher = encryptMerchantMnemonic(
      assertValidMnemonicPhrase(String(mnemonicRaw)),
    );
  } catch {
    return { ok: false, status: 400, json: { error: "invalid_mnemonic" } };
  }

  const parsedChains = parseDefaultChainsArray(body.default_chains, {
    minOne: true,
    ignoreGatewayTronUsdtOnly: true,
  });
  if ("error" in parsedChains && parsedChains.error) {
    return { ok: false, status: 400, json: { error: parsedChains.error } };
  }
  let constraintKeys = null;
  let supportedKeysToStore;
  if (body.supported_deposit_rails !== undefined) {
    const pr = parseSupportedDepositRailsInput(
      body.supported_deposit_rails,
      parsedChains.chains,
      { ignoreGatewayTronUsdtOnly: true },
    );
    if ("error" in pr) {
      return { ok: false, status: 400, json: { error: pr.error } };
    }
    constraintKeys = pr.keys;
    supportedKeysToStore = pr.keys;
  }
  const picked = pickMerchantDefaultPair(
    body,
    parsedChains.chains,
    constraintKeys,
  );
  if ("error" in picked && picked.error) {
    return { ok: false, status: 400, json: { error: picked.error } };
  }
  if (supportedKeysToStore === undefined) {
    supportedKeysToStore = [depositRailKey(picked.currency, picked.network)];
  }
  const password =
    body.password?.trim() || crypto.randomBytes(12).toString("base64url");
  const apiSecret = generateApiKey();

  let mdrP;
  let settlementP;

  if (resellerPartnerId != null) {
    const rp = await prisma.resellerPartner.findFirst({
      where: { id: resellerPartnerId, deletedAt: null },
      select: { mdrPercent: true, payoutMdrPercent: true },
    });
    if (!rp) {
      return {
        ok: false,
        status: 400,
        json: { error: "reseller_partner_not_found" },
      };
    }
    const rpMdr = Number(rp.mdrPercent);
    const hasBodyMdr =
      body.mdr_percent !== undefined &&
      body.mdr_percent !== null &&
      String(body.mdr_percent).trim() !== "";
    mdrP = hasBodyMdr ? parseFeePercent(body.mdr_percent) : rpMdr;
    if (mdrP === null) {
      return { ok: false, status: 400, json: { error: "invalid_fee_percent" } };
    }
    if (!isValidFeePercent(mdrP)) {
      return {
        ok: false,
        status: 400,
        json: {
          error: "fee_percent_range",
          message: "MDR must be between 0 and 100.",
        },
      };
    }
    settlementP = 0;
  } else {
    mdrP = parseFeePercent(body.mdr_percent);
    settlementP = parseFeePercent(body.settlement_rate_percent);
    if (mdrP === null || settlementP === null) {
      return { ok: false, status: 400, json: { error: "invalid_fee_percent" } };
    }
    if (!isValidFeePercent(mdrP) || !isValidFeePercent(settlementP)) {
      return {
        ok: false,
        status: 400,
        json: {
          error: "fee_percent_range",
          message: "MDR and settlement rate must be between 0 and 100.",
        },
      };
    }
    if (mdrP + settlementP > 100) {
      return {
        ok: false,
        status: 400,
        json: {
          error: "fee_percent_sum",
          message: "MDR + settlement rate cannot exceed 100%.",
        },
      };
    }
  }

  /** @type {number} */
  let payoutMdrP;
  if (resellerPartnerId != null) {
    const hasBodyPayoutMdr =
      body.payout_mdr_percent !== undefined &&
      body.payout_mdr_percent !== null &&
      String(body.payout_mdr_percent).trim() !== "";
    payoutMdrP = hasBodyPayoutMdr ? parseFeePercent(body.payout_mdr_percent) : rpPayoutMdr;
    if (payoutMdrP === null || !isValidFeePercent(payoutMdrP)) {
      return {
        ok: false,
        status: 400,
        json: { error: "invalid_payout_mdr_percent" },
      };
    }
  } else {
    payoutMdrP =
      body.payout_mdr_percent !== undefined &&
      body.payout_mdr_percent !== null &&
      String(body.payout_mdr_percent).trim() !== ""
        ? parseFeePercent(body.payout_mdr_percent)
        : mdrP;
    if (payoutMdrP === null || !isValidFeePercent(payoutMdrP)) {
      return {
        ok: false,
        status: 400,
        json: { error: "invalid_payout_mdr_percent" },
      };
    }
  }

  const minSettle = validateAndNormalizeHumanMinSettlement(
    body.min_settlement_amount,
  );
  if (!minSettle.ok) {
    return {
      ok: false,
      status: 400,
      json: {
        error: "invalid_min_settlement_amount",
        message: minSettle.error,
      },
    };
  }

  const periodDays = parseSettlementPeriodDays(body.settlement_period_days);
  if (periodDays === null) {
    return {
      ok: false,
      status: 400,
      json: {
        error: "invalid_settlement_period_days",
        message: "Use a whole number of days from 0 to 3650.",
      },
    };
  }

  try {
    const row = await prisma.merchant.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(password, 10),
        displayName: body.display_name?.trim() || null,
        resellerPartnerId,
        mnemonicCipher,
        defaultChains: parsedChains.chains,
        defaultCurrency: picked.currency,
        defaultNetwork: picked.network,
        supportedDepositRails: supportedKeysToStore,
        callbackUrl: body.callback_url?.trim() || null,
        apiKeyHash: hashApiKey(apiSecret),
        apiKeyHint: apiSecret.slice(-6),
        apiKeyCipher: encryptMerchantApiKey(apiSecret),
        sandboxApiKeyHash: hashApiKey(apiSecret),
        sandboxApiKeyHint: apiSecret.slice(-6),
        sandboxApiKeyCipher: encryptMerchantApiKey(apiSecret),
        mdrPercent: mdrP,
        payoutMdrPercent: payoutMdrP,
        settlementRatePercent: settlementP,
        minSettlementAmount: minSettle.raw,
        settlementPeriodDays: periodDays,
        ...(typeof body.live_gateway_enabled === "boolean"
          ? { liveGatewayEnabled: body.live_gateway_enabled }
          : {}),
        ...(typeof body.sandbox_gateway_enabled === "boolean"
          ? { sandboxGatewayEnabled: body.sandbox_gateway_enabled }
          : {}),
      },
    });
    return { ok: true, row, apiSecret, password };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, status: 409, json: { error: "email_already_exists" } };
    }
    throw e;
  }
}

/**
 * @param {unknown} raw
 * @returns {Promise<{ id: number | null } | { error: string }>}
 */
export async function resolveOptionalResellerPartnerIdForAdmin(raw) {
  if (raw === undefined || raw === null || raw === "") return { id: null };
  const n = parseInt(String(raw).trim(), 10);
  if (!Number.isInteger(n) || n < 1) {
    return { error: "invalid_reseller_partner_id" };
  }
  const rp = await prisma.resellerPartner.findFirst({
    where: { id: n, ...ACTIVE },
    select: { id: true },
  });
  if (!rp) return { error: "reseller_partner_not_found" };
  return { id: n };
}
