import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "cpg_theme";

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === "light") {
    root.classList.add("light");
    root.classList.remove("dark");
  } else {
    root.classList.add("dark");
    root.classList.remove("light");
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || "dark";
    } catch {
      return "dark";
    }
  });

  // Apply on mount
  useEffect(() => {
    applyTheme(theme);
    try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* ignore */ }
  }, [theme]);

  /**
   * Toggle theme with a ZenoxPay-style radial View Transition expanding
   * from the pointer position (or the center of the screen as fallback).
   * @param {MouseEvent | null | undefined} event
   */
  const toggleTheme = useCallback((event) => {
    const nextTheme = theme === "dark" ? "light" : "dark";

    // Store click position for the CSS animation
    const x = event?.clientX ?? window.innerWidth / 2;
    const y = event?.clientY ?? window.innerHeight / 2;
    document.documentElement.style.setProperty("--vt-x", `${x}px`);
    document.documentElement.style.setProperty("--vt-y", `${y}px`);
    // Expose to CSS which direction we're going (dark→light grows a light circle)
    document.documentElement.setAttribute("data-vt-going", nextTheme);

    if (!document.startViewTransition) {
      // Fallback: no animation
      applyTheme(nextTheme);
      setThemeState(nextTheme);
      try { localStorage.setItem(STORAGE_KEY, nextTheme); } catch { /* ignore */ }
      return;
    }

    const transition = document.startViewTransition(() => {
      applyTheme(nextTheme);
      setThemeState(nextTheme);
      try { localStorage.setItem(STORAGE_KEY, nextTheme); } catch { /* ignore */ }
    });

    transition.ready.catch(() => {/* ignore */});
  }, [theme]);

  return { theme, toggleTheme };
}
