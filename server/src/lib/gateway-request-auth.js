import { MerchantGatewayEnv } from "@prisma/client";
import { prisma } from "./prisma.js";
import { decryptMerchantApiKey } from "./merchant-api-key-cipher.js";
import {
  isUnifiedGatewayApiKey,
  resolveMerchantByGatewayApiKey,
} from "./gateway-merchant-auth.js";
import {
  parseGatewayEnvironmentFromBody,
  parseGatewayEnvironmentFromQuery,
} from "./merchant-gateway-env.js";
import { merchantWhereFromRouteParam } from "./entity-internal-id.js";
import { verifyGatewayBodyXToken } from "./gateway-x-token.js";

/**
 * @typedef {{ ok: true, merchant: import("@prisma/client").Merchant, keyType: "live" | "sandbox" }} GatewayAuthOk
 * @typedef {{ ok: false, status: number, error: string, message?: string }} GatewayAuthErr
 */

/**
 * Authenticate POST /api/v1/gateway/* JSON requests.
 *
 * Preferred: `X-Token` (AES-256-GCM of canonical JSON body) + `X-Merchant-Id` (numeric id from portal).
 * Legacy: `api_key` in JSON body.
 *
 * @param {import("express").Request} req
 * @returns {Promise<GatewayAuthOk | GatewayAuthErr>}
 */
export async function authenticateGatewayJsonPost(req) {
  const body =
    req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? /** @type {Record<string, unknown>} */ (req.body)
      : {};
  const xTokenRaw = req.headers["x-token"];
  const xToken = typeof xTokenRaw === "string" ? xTokenRaw.trim() : "";
  const xMidRaw = req.headers["x-merchant-id"];
  const xMerchantId = typeof xMidRaw === "string" ? xMidRaw.trim() : "";
  const apiKey =
    typeof body.api_key === "string" ? body.api_key.trim() : "";

  if (xToken) {
    if (!xMerchantId) {
      return {
        ok: false,
        status: 400,
        error: "x_merchant_id_required",
        message:
          "X-Merchant-Id header is required when using X-Token (use your merchant id from the portal /auth/me).",
      };
    }
    if (apiKey) {
      return {
        ok: false,
        status: 400,
        error: "ambiguous_gateway_auth",
        message: "Send either api_key in the JSON body or X-Token, not both.",
      };
    }
    return resolveMerchantByGatewayXToken(body, xToken, xMerchantId);
  }

  if (apiKey) {
    const gwEnvHint = parseGatewayEnvironmentFromBody(body);
    const resolved = await resolveMerchantByGatewayApiKey(apiKey, {
      gatewayEnvironment: gwEnvHint,
    });
    if (!resolved) {
      return { ok: false, status: 401, error: "invalid_api_key" };
    }
    return { ok: true, merchant: resolved.merchant, keyType: resolved.keyType };
  }

  return {
    ok: false,
    status: 400,
    error: "gateway_auth_required",
    message:
      "Provide api_key in the JSON body, or X-Token plus X-Merchant-Id headers.",
  };
}

/**
 * GET `/api/v1/gateway/supported-currency`: no JSON body.
 * `X-Token` must be AES-256-GCM of the **canonical JSON** of exactly:
 * `{"api_key":"<your_gateway_secret>"}` (same encryption rules as other gateway X-Tokens).
 *
 * @param {import("express").Request} req
 * @returns {Promise<GatewayAuthOk | GatewayAuthErr>}
 */
export async function authenticateGatewaySupportedCurrencyGet(req) {
  const xTokenRaw = req.headers["x-token"];
  const xToken = typeof xTokenRaw === "string" ? xTokenRaw.trim() : "";
  const xMidRaw = req.headers["x-merchant-id"];
  const xMerchantId = typeof xMidRaw === "string" ? xMidRaw.trim() : "";

  if (!xToken || !xMerchantId) {
    return {
      ok: false,
      status: 400,
      error: "gateway_auth_required",
      message:
        "GET requires X-Token and X-Merchant-Id. Build X-Token from canonical JSON {\"api_key\":\"<your_gateway_secret>\"} (encrypted with your secret per gateway docs). Live vs sandbox follows the merchant portal profile (Settings) unless you pass optional query gateway_environment=live|sandbox to override when using one shared key.",
    };
  }

  const gwEnvHint = parseGatewayEnvironmentFromQuery(req.query ?? {});
  return resolveMerchantByApiKeyEnvelopeXToken(xToken, xMerchantId, gwEnvHint);
}

/**
 * @param {Record<string, unknown>} body
 * @param {string} xToken
 * @param {string} xMerchantId
 * @returns {Promise<GatewayAuthOk | GatewayAuthErr>}
 */
async function resolveMerchantByGatewayXToken(body, xToken, xMerchantId) {
  const where = merchantWhereFromRouteParam(xMerchantId);
  if (!where) {
    return {
      ok: false,
      status: 400,
      error: "invalid_x_merchant_id",
      message: "X-Merchant-Id must be a positive integer (your merchant id).",
    };
  }

  const merchant = await prisma.merchant.findFirst({
    where: {
      ...where,
      isActive: true,
      deletedAt: null,
    },
  });
  if (!merchant) {
    return {
      ok: false,
      status: 401,
      error: "invalid_x_merchant_id",
      message: "Unknown or inactive merchant for X-Merchant-Id.",
    };
  }

  let liveSecret = null;
  let sandboxSecret = null;
  try {
    if (merchant.apiKeyCipher) {
      liveSecret = decryptMerchantApiKey(merchant.apiKeyCipher);
    }
  } catch {
    liveSecret = null;
  }
  try {
    if (merchant.sandboxApiKeyCipher) {
      sandboxSecret = decryptMerchantApiKey(merchant.sandboxApiKeyCipher);
    }
  } catch {
    sandboxSecret = null;
  }

  const unified = isUnifiedGatewayApiKey(merchant);
  const secretForUnified = liveSecret ?? sandboxSecret;

  if (unified) {
    if (!secretForUnified) {
      return {
        ok: false,
        status: 503,
        error: "gateway_secret_unavailable",
        message:
          "Cannot verify X-Token (missing stored secret). Use api_key in the body or ask an admin to regenerate the gateway API key.",
      };
    }
    if (!verifyGatewayBodyXToken(body, xToken, secretForUnified)) {
      return {
        ok: false,
        status: 401,
        error: "invalid_x_token",
        message:
          "X-Token does not match this body and merchant API secret (canonical JSON must match).",
      };
    }
    const gwEnvHint = parseGatewayEnvironmentFromBody(body);
    let keyType;
    if (gwEnvHint === "sandbox" || gwEnvHint === "live") {
      keyType = gwEnvHint === "sandbox" ? "sandbox" : "live";
    } else {
      keyType =
        merchant.portalEnvironment === MerchantGatewayEnv.sandbox
          ? "sandbox"
          : "live";
    }
    return { ok: true, merchant, keyType };
  }

  if (!liveSecret && !sandboxSecret) {
    return {
      ok: false,
      status: 503,
      error: "gateway_secret_unavailable",
      message:
        "Cannot verify X-Token (missing stored secrets). Use api_key in the body or ask an admin to regenerate keys.",
    };
  }

  if (liveSecret && verifyGatewayBodyXToken(body, xToken, liveSecret)) {
    return { ok: true, merchant, keyType: "live" };
  }
  if (sandboxSecret && verifyGatewayBodyXToken(body, xToken, sandboxSecret)) {
    return { ok: true, merchant, keyType: "sandbox" };
  }

  return {
    ok: false,
    status: 401,
    error: "invalid_x_token",
    message:
      "X-Token does not match this body and the live/sandbox API secret (canonical JSON must match).",
  };
}

/**
 * X-Token plaintext is canonical JSON of `{ "api_key": "<same_plaintext_secret>" }`.
 *
 * @param {string} xToken
 * @param {string} xMerchantId
 * @param {"live" | "sandbox" | undefined} gwEnvHint
 * @returns {Promise<GatewayAuthOk | GatewayAuthErr>}
 */
async function resolveMerchantByApiKeyEnvelopeXToken(
  xToken,
  xMerchantId,
  gwEnvHint,
) {
  const where = merchantWhereFromRouteParam(xMerchantId);
  if (!where) {
    return {
      ok: false,
      status: 400,
      error: "invalid_x_merchant_id",
      message: "X-Merchant-Id must be a positive integer (your merchant id).",
    };
  }

  const merchant = await prisma.merchant.findFirst({
    where: {
      ...where,
      isActive: true,
      deletedAt: null,
    },
  });
  if (!merchant) {
    return {
      ok: false,
      status: 401,
      error: "invalid_x_merchant_id",
      message: "Unknown or inactive merchant for X-Merchant-Id.",
    };
  }

  let liveSecret = null;
  let sandboxSecret = null;
  try {
    if (merchant.apiKeyCipher) {
      liveSecret = decryptMerchantApiKey(merchant.apiKeyCipher);
    }
  } catch {
    liveSecret = null;
  }
  try {
    if (merchant.sandboxApiKeyCipher) {
      sandboxSecret = decryptMerchantApiKey(merchant.sandboxApiKeyCipher);
    }
  } catch {
    sandboxSecret = null;
  }

  const unified = isUnifiedGatewayApiKey(merchant);
  const secretForUnified = liveSecret ?? sandboxSecret;

  const envelope = (secret) => ({ api_key: secret });

  if (unified) {
    if (!secretForUnified) {
      return {
        ok: false,
        status: 503,
        error: "gateway_secret_unavailable",
        message:
          "Cannot verify X-Token (missing stored secret). Ask an admin to regenerate the gateway API key.",
      };
    }
    if (
      !verifyGatewayBodyXToken(
        envelope(secretForUnified),
        xToken,
        secretForUnified,
      )
    ) {
      return {
        ok: false,
        status: 401,
        error: "invalid_x_token",
        message:
          "X-Token must encrypt canonical JSON {\"api_key\":\"<your_gateway_secret>\"} using that same secret.",
      };
    }
    let keyType;
    if (gwEnvHint === "sandbox" || gwEnvHint === "live") {
      keyType = gwEnvHint === "sandbox" ? "sandbox" : "live";
    } else {
      keyType =
        merchant.portalEnvironment === MerchantGatewayEnv.sandbox
          ? "sandbox"
          : "live";
    }
    return { ok: true, merchant, keyType };
  }

  if (!liveSecret && !sandboxSecret) {
    return {
      ok: false,
      status: 503,
      error: "gateway_secret_unavailable",
      message:
        "Cannot verify X-Token (missing stored secrets). Ask an admin to regenerate keys.",
    };
  }

  if (
    liveSecret &&
    verifyGatewayBodyXToken(envelope(liveSecret), xToken, liveSecret)
  ) {
    return { ok: true, merchant, keyType: "live" };
  }
  if (
    sandboxSecret &&
    verifyGatewayBodyXToken(envelope(sandboxSecret), xToken, sandboxSecret)
  ) {
    return { ok: true, merchant, keyType: "sandbox" };
  }

  return {
    ok: false,
    status: 401,
    error: "invalid_x_token",
    message:
      "X-Token must encrypt canonical JSON {\"api_key\":\"<matching_live_or_sandbox_secret>\"}.",
  };
}
