import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";

/**
 * Live vs sandbox from DB (`portalEnvironment` on auth/me). Merchants: gateway flags apply.
 * Admins: both modes always available; global Users & Transactions lists follow this setting.
 * Toggle: PATCH /api/v1/auth/me/portal-environment
 *
 * @returns {{
 *   environment: 'live' | 'sandbox',
 *   setEnvironment: (v: 'live' | 'sandbox') => Promise<void>,
 *   liveGatewayEnabled: boolean,
 *   sandboxGatewayEnabled: boolean,
 *   flagsLoading: boolean,
 *   portalEnvironmentKey: string,
 * }}
 */
export function useMerchantPortalEnvironment() {
  const queryClient = useQueryClient();
  const me = useQuery({
    queryKey: ["auth-me"],
    queryFn: () => api("/api/v1/auth/me"),
    staleTime: 60_000,
  });

  const isAdmin = me.data?.role === "ADMIN";

  const environment =
    me.data?.portalEnvironment === "sandbox" ? "sandbox" : "live";
  const liveGatewayEnabled = isAdmin
    ? true
    : me.data?.liveGatewayEnabled !== false;
  const sandboxGatewayEnabled = isAdmin
    ? true
    : me.data?.sandboxGatewayEnabled !== false;

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
    flagsLoading: me.isLoading,
  };
}
