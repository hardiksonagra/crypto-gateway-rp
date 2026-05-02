import { useCallback, useEffect, useState } from "react";

/**
 * Collapsed = narrow icon rail (md+). Mobile drawer open state separate.
 * @param {"admin"|"merchant"|"rp"} scope Persist collapse per portal.
 */
export function useSidebarLayout(scope) {
  const storageKey = `cpg_sidebar_collapsed_${scope}`;

  const [collapsed, setCollapsedState] = useState(() => {
    try {
      return localStorage.getItem(storageKey) === "1";
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  function persistCollapsed(v) {
    try {
      if (v) localStorage.setItem(storageKey, "1");
      else localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  }

  const setCollapsed = useCallback((v) => {
    setCollapsedState(v);
    persistCollapsed(v);
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsedState((prev) => {
      const next = !prev;
      persistCollapsed(next);
      return next;
    });
  }, []);

  const closeMobile = useCallback(() => setMobileOpen(false), []);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    function onChange() {
      if (mq.matches) setMobileOpen(false);
    }
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return {
    collapsed,
    setCollapsed,
    toggleCollapsed,
    mobileOpen,
    setMobileOpen,
    closeMobile,
  };
}
