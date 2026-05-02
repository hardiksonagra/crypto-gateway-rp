import { MerchantGatewayEnv } from "@prisma/client";
import { ensureMerchantPortalEnvironmentConsistent } from "./merchant-gateway-env.js";

/**
 * Portal lists use `portal_environment` on the merchant row (not query params).
 *
 * @param {number} mid
 * @returns {Promise<
 *   | { ok: true, environment: MerchantGatewayEnv, flags: { liveGatewayEnabled: boolean, sandboxGatewayEnabled: boolean } }
 *   | { ok: false, status: number, error: string, message?: string }
 * >}
 */
export async function resolveMerchantPortalForLists(mid) {
  const synced = await ensureMerchantPortalEnvironmentConsistent(mid);
  if (!synced) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  const environment = synced.portalEnvironment;
  if (
    environment === MerchantGatewayEnv.sandbox &&
    !synced.sandboxGatewayEnabled
  ) {
    return {
      ok: false,
      status: 403,
      error: "sandbox_gateway_disabled",
      message:
        "Sandbox is disabled for your account. Ask an admin to enable it.",
    };
  }
  if (environment === MerchantGatewayEnv.live && !synced.liveGatewayEnabled) {
    return {
      ok: false,
      status: 403,
      error: "live_gateway_disabled",
      message: "Live gateway is disabled for your account.",
    };
  }
  if (!synced.liveGatewayEnabled && !synced.sandboxGatewayEnabled) {
    return {
      ok: false,
      status: 403,
      error: "gateway_disabled",
      message:
        "Neither live nor sandbox gateway is enabled for your account. Contact support.",
    };
  }
  return {
    ok: true,
    environment,
    flags: {
      liveGatewayEnabled: synced.liveGatewayEnabled,
      sandboxGatewayEnabled: synced.sandboxGatewayEnabled,
    },
  };
}
