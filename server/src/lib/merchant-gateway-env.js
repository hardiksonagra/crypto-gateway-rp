import { AdminRole, MerchantGatewayEnv } from "@prisma/client";
import { prisma } from "./prisma.js";

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
 * @param {string} userId
 * @returns {Promise<{ portalEnvironment: import("@prisma/client").MerchantGatewayEnv; liveGatewayEnabled: boolean; sandboxGatewayEnabled: boolean } | null>}
 */
export async function ensureMerchantPortalEnvironmentConsistent(userId) {
  const m = await prisma.adminUser.findUnique({
    where: { id: userId },
    select: {
      portalEnvironment: true,
      liveGatewayEnabled: true,
      sandboxGatewayEnabled: true,
      role: true,
    },
  });
  if (!m || m.role !== AdminRole.MERCHANT) return null;

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
    await prisma.adminUser.update({
      where: { id: userId },
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
 * @param {string} userId
 * @param {import("@prisma/client").MerchantGatewayEnv} environment
 */
export async function assertPortalEnvironmentUpdateAllowed(userId, environment) {
  const m = await prisma.adminUser.findUnique({
    where: { id: userId },
    select: {
      role: true,
      liveGatewayEnabled: true,
      sandboxGatewayEnabled: true,
    },
  });
  if (!m) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  if (m.role === AdminRole.ADMIN) {
    return { ok: true };
  }
  if (m.role !== AdminRole.MERCHANT) {
    return { ok: false, status: 403, error: "forbidden" };
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
 * @param {import("@prisma/client").AdminUser} merchant
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
