import { useLocation } from "react-router-dom";

/**
 * Admin: `/control` + `/api/v1/admin`. RP: `/rp` + `/api/v1/rp`. Merchant portal (e.g. `/tool-send-usdt`): `/api/v1/merchant`.
 *
 * @returns {{ apiPrefix: string; isRp: boolean; isMerchant: boolean; listBase: "/control" | "/rp" | "" }}
 */
export function usePanelApiPrefix() {
  const { pathname } = useLocation();
  if (pathname.startsWith("/rp")) {
    return {
      isRp: true,
      isMerchant: false,
      apiPrefix: "/api/v1/rp",
      listBase: "/rp",
    };
  }
  if (pathname.startsWith("/control")) {
    return {
      isRp: false,
      isMerchant: false,
      apiPrefix: "/api/v1/admin",
      listBase: "/control",
    };
  }
  return {
    isRp: false,
    isMerchant: true,
    apiPrefix: "/api/v1/merchant",
    listBase: "",
  };
}
