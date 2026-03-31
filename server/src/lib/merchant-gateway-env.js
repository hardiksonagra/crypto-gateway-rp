import { MerchantGatewayEnv } from "@prisma/client";
import { prisma } from "./prisma.js";
import { merchantWhereFromRouteParam } from "./entity-internal-id.js";

/**
 * Optional gateway JSON override when live and sandbox share one API key.
 * If omitted or empty, resolveMerchantByGatewayApiKey uses the merchant’s portal environment.
 *
 * @param {Record<string, unknown> | null | undefined} body
 * @returns {"live" | "sandbox" | undefined}
 */
export function parseGatewayEnvironmentFromBody(body) {
  const v = String(
    body?.gateway_environment ?? body?.gatewayEnvironment ?? "",
  )
    .trim()
    .toLowerCase();
  if (v === "sandbox") return "sandbox";
  if (v === "live") return "live";
  return undefined;
}

/**
 * If portal environment disagrees with gateway enable flags, persist a valid value (merchant rows only).
 *
 * @param {string | number} userId — account integer `id` or JWT `sub` (numeric string).
 * @returns {Promise<{ portalEnvironment: import("@prisma/client").MerchantGatewayEnv; liveGatewayEnabled: boolean; sandboxGatewayEnabled: boolean } | null>}
 */
export async function ensureMerchantPortalEnvironmentConsistent(userId) {
  const where =
    typeof userId === "number" && Number.isInteger(userId)
      ? { id: userId }
      : merchantWhereFromRouteParam(String(userId ?? ""));
  if (!where) return null;
  const m = await prisma.merchant.findFirst({
    where,
    select: {
      id: true,
      portalEnvironment: true,
      liveGatewayEnabled: true,
      sandboxGatewayEnabled: true,
    },
  });
  if (!m) return null;

  let nextEnv = m.portalEnvironment;
  if (nextEnv === MerchantGatewayEnv.sandbox && !m.sandboxGatewayEnabled) {
    nextEnv = MerchantGatewayEnv.live;
  } else if (
    nextEnv === MerchantGatewayEnv.live &&
    !m.liveGatewayEnabled &&
    m.sandboxGatewayEnabled
  ) {
    nextEnv = MerchantGatewayEnv.sandbox;
  }

  if (nextEnv !== m.portalEnvironment) {
    await prisma.merchant.update({
      where: { id: m.id },
      data: { portalEnvironment: nextEnv },
    });
    return {
      portalEnvironment: nextEnv,
      liveGatewayEnabled: m.liveGatewayEnabled,
      sandboxGatewayEnabled: m.sandboxGatewayEnabled,
    };
  }
  return {
    portalEnvironment: m.portalEnvironment,
    liveGatewayEnabled: m.liveGatewayEnabled,
    sandboxGatewayEnabled: m.sandboxGatewayEnabled,
  };
}

/**
 * Whether the signed-in user may set portal to `environment` (merchants: gateway flags; admins: always).
 *
 * @param {string | number} userId
 * @param {import("@prisma/client").MerchantGatewayEnv} environment
 */
export async function assertPortalEnvironmentUpdateAllowed(userId, environment) {
  const adminWhere =
    typeof userId === "number" && Number.isInteger(userId)
      ? { id: userId }
      : merchantWhereFromRouteParam(String(userId ?? ""));
  const adminRow = adminWhere
    ? await prisma.admin.findFirst({ where: adminWhere, select: { id: true } })
    : null;
  if (adminRow) {
    return { ok: true };
  }
  const merchWhere =
    typeof userId === "number" && Number.isInteger(userId)
      ? { id: userId }
      : merchantWhereFromRouteParam(String(userId ?? ""));
  const m = merchWhere
    ? await prisma.merchant.findFirst({
        where: merchWhere,
        select: {
          liveGatewayEnabled: true,
          sandboxGatewayEnabled: true,
        },
      })
    : null;
  if (!m) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  if (environment === MerchantGatewayEnv.sandbox && !m.sandboxGatewayEnabled) {
    return {
      ok: false,
      status: 403,
      error: "sandbox_gateway_disabled",
      message: "Sandbox is disabled for your account. Ask an admin to enable it.",
    };
  }
  if (environment === MerchantGatewayEnv.live && !m.liveGatewayEnabled) {
    return {
      ok: false,
      status: 403,
      error: "live_gateway_disabled",
      message: "Live gateway is disabled for your account.",
    };
  }
  return { ok: true };
}

/**
 * @param {"live" | "sandbox"} keyType
 * @returns {import("@prisma/client").MerchantGatewayEnv}
 */
export function gatewayEnvironmentFromKeyType(keyType) {
  return keyType === "sandbox" ? MerchantGatewayEnv.sandbox : MerchantGatewayEnv.live;
}

/**
 * @param {import("@prisma/client").Merchant} merchant
 * @param {"live" | "sandbox"} keyType
 * @returns {{ ok: true } | { ok: false, error: string, message?: string }}
 */
export function assertMerchantGatewayKeyAllowed(merchant, keyType) {
  if (keyType === "sandbox" && !merchant.sandboxGatewayEnabled) {
    return {
      ok: false,
      error: "sandbox_gateway_disabled",
      message: "Sandbox gateway is disabled for this merchant (admin can enable it).",
    };
  }
  if (keyType === "live" && !merchant.liveGatewayEnabled) {
    return {
      ok: false,
      error: "live_gateway_disabled",
      message: "Live gateway is disabled for this merchant (admin can enable it).",
    };
  }
  return { ok: true };
}
