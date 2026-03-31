import { createContext, useCallback, useContext, useMemo, useState } from "react";

/**
 * @typedef {{ id: string, label: string } | null} MerchantCrumb
 */

/** @type {React.Context<{ merchantCrumb: MerchantCrumb, setMerchantCrumb: (v: MerchantCrumb) => void } | null>} */
const BreadcrumbExtrasContext = createContext(null);

/**
 * Wrap `<Outlet />` in admin/merchant shells so detail pages can set dynamic labels.
 *
 * @param {{ children: React.ReactNode }} props
 */
export function BreadcrumbExtrasProvider({ children }) {
  const [merchantCrumb, setMerchantCrumbState] = useState(
    /** @type {MerchantCrumb} */ (null),
  );
  const setMerchantCrumb = useCallback((v) => {
    setMerchantCrumbState(v);
  }, []);
  const value = useMemo(
    () => ({ merchantCrumb, setMerchantCrumb }),
    [merchantCrumb, setMerchantCrumb],
  );
  return (
    <BreadcrumbExtrasContext.Provider value={value}>
      {children}
    </BreadcrumbExtrasContext.Provider>
  );
}

/**
 * @returns {{ merchantCrumb: MerchantCrumb, setMerchantCrumb: (v: MerchantCrumb) => void }}
 */
export function useBreadcrumbExtras() {
  const ctx = useContext(BreadcrumbExtrasContext);
  if (!ctx) {
    return {
      merchantCrumb: null,
      setMerchantCrumb: () => {},
    };
  }
  return ctx;
}
