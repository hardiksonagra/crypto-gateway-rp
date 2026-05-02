import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, getToken } from "../api";

/**
 * Live vs sandbox from DB (`portalEnvironment` on auth/me). Merchants: gateway flags apply.
 * Admins: both modes always available; global Users & Transactions lists follow this setting.
 * Toggle: PATCH /api/v1/auth/me/portal-environment
 *
 * Session loading uses `me.data` / `me.isError` (not `isPending`/`isSuccess` alone) so React Query v5
 * + `enabled` never leaves merchants stuck on loaders or "Redirecting" with a valid session.
 *
 * @returns {{
 *   environment: 'live' | 'sandbox',
 *   setEnvironment: (v: 'live' | 'sandbox') => Promise<void>,
 *   liveGatewayEnabled: boolean,
 *   sandboxGatewayEnabled: boolean,
 *   flagsLoading: boolean,
 *   portalEnvironmentKey: string,
 *   isMerchantPortal: boolean,
 *   merchantEmail: string | null,
 *   merchantDisplayName: string | null,
 *   gatewayAllowsCurrentEnv: boolean,
 *   needsPortalSwitch: boolean,
 *   merchantApiReady: boolean,
 *   portalListAccess: boolean | undefined,
 *   portalListDeniedMessage: string | null,
 *   wrongPortalRole: boolean,
 *   authMeIsError: boolean,
 *   authMeError: unknown,
 * }}
 */
export function useMerchantPortalEnvironment() {
  const queryClient = useQueryClient();
  const token = getToken() ?? "";

  const me = useQuery({
    queryKey: ["auth-me"],
    queryFn: () => api("/api/v1/auth/me"),
    staleTime: 60_000,
    enabled: Boolean(token),
    retry: (failureCount, err) => {
      const st = err && typeof err === "object" && "status" in err ? Number(err.status) : NaN;
      if (st === 401 || st === 403) return false;
      return failureCount < 2;
    },
  });

  const isAdmin = me.data?.role === "ADMIN";
  const isRp = me.data?.role === "RP";
  const isMerchantPortal = me.data?.role === "MERCHANT";

  const environment =
    me.data?.portalEnvironment === "sandbox" ? "sandbox" : "live";
  const liveGatewayEnabled = isAdmin || isRp
    ? true
    : me.data?.liveGatewayEnabled !== false;
  const sandboxGatewayEnabled = isAdmin || isRp
    ? true
    : me.data?.sandboxGatewayEnabled !== false;

  const gatewayAllowsCurrentEnv =
    (environment === "live" && liveGatewayEnabled) ||
    (environment === "sandbox" && sandboxGatewayEnabled);

  /** Mirrors server `resolveMerchantPortalForLists` (GET /api/v1/merchant/*). Undefined = older API — fall back. */
  const serverPortalListAccess =
    me.data && typeof me.data === "object" && "portalListAccess" in me.data
      ? /** @type {{ portalListAccess?: boolean }} */ (me.data).portalListAccess
      : undefined;

  const merchantListReady =
    serverPortalListAccess === true ||
    (serverPortalListAccess === undefined && gatewayAllowsCurrentEnv);

  const hasProfile = Boolean(me.data) && !me.isError;

  const needsPortalSwitch =
    hasProfile &&
    isMerchantPortal &&
    !gatewayAllowsCurrentEnv &&
    (liveGatewayEnabled || sandboxGatewayEnabled);

  const merchantApiReady =
    hasProfile && isMerchantPortal && merchantListReady;

  const portalListDeniedMessage =
    typeof me.data?.portalListDeniedMessage === "string" && me.data.portalListDeniedMessage.trim()
      ? me.data.portalListDeniedMessage.trim()
      : null;

  const wrongPortalRole =
    hasProfile && (me.data?.role === "ADMIN" || me.data?.role === "RP");

  /**
   * First auth/me resolution only. Do not use `!me.data` — v5 keeps `enabled: false`
   * child queries `isPending: true`, and `data` can be null/empty while status is success.
   */
  const flagsLoading = Boolean(token) && me.isPending && !me.isError;

  const setEnvironment = useCallback(
    async (next) => {
      await api("/api/v1/auth/me/portal-environment", {
        method: "PATCH",
        json: { portal_environment: next },
      });
      await queryClient.invalidateQueries({ queryKey: ["auth-me"] });
      await queryClient.invalidateQueries({ queryKey: ["m-dash"] });
      await queryClient.invalidateQueries({ queryKey: ["m-users"] });
      await queryClient.invalidateQueries({ queryKey: ["m-txs"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-txs"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-dash"] });
      await queryClient.invalidateQueries({ queryKey: ["rp-dash"] });
      await queryClient.invalidateQueries({ queryKey: ["rp-users"] });
      await queryClient.invalidateQueries({ queryKey: ["rp-txs"] });
      await queryClient.invalidateQueries({ queryKey: ["rp-wallets"] });
    },
    [queryClient],
  );

  const portalEnvironmentKey = me.data?.portalEnvironment ?? "pending";

  return {
    environment,
    setEnvironment,
    portalEnvironmentKey,
    liveGatewayEnabled,
    sandboxGatewayEnabled,
    flagsLoading,
    isMerchantPortal,
    merchantEmail: typeof me.data?.email === "string" ? me.data.email : null,
    merchantDisplayName:
      typeof me.data?.displayName === "string" && me.data.displayName.trim()
        ? me.data.displayName.trim()
        : null,
    gatewayAllowsCurrentEnv,
    needsPortalSwitch,
    merchantApiReady,
    portalListAccess: serverPortalListAccess,
    portalListDeniedMessage,
    wrongPortalRole,
    authMeIsError: me.isError,
    authMeError: me.error,
  };
}
