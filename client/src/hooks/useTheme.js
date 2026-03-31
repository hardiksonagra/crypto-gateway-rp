import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

const STORAGE_KEY = "cpg_theme";

/** @type {import("react").Context<{ theme: string; toggleTheme: (event?: import("react").MouseEvent | null) => void } | null>} */
const ThemeContext = createContext(null);

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

/**
 * Single source of truth for portal light/dark — wrap the app root.
 * @param {{ children: import("react").ReactNode }} props
 */
export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || "dark";
    } catch {
      return "dark";
    }
  });

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  /**
   * Toggle theme with a ZenoxPay-style radial View Transition.
   * @param {import("react").MouseEvent | null | undefined} event
   */
  const toggleTheme = useCallback(
    (event) => {
      const nextTheme = theme === "dark" ? "light" : "dark";

      const x = event?.clientX ?? window.innerWidth / 2;
      const y = event?.clientY ?? window.innerHeight / 2;
      document.documentElement.style.setProperty("--vt-x", `${x}px`);
      document.documentElement.style.setProperty("--vt-y", `${y}px`);
      document.documentElement.setAttribute("data-vt-going", nextTheme);

      if (!document.startViewTransition) {
        applyTheme(nextTheme);
        setThemeState(nextTheme);
        try {
          localStorage.setItem(STORAGE_KEY, nextTheme);
        } catch {
          /* ignore */
        }
        return;
      }

      const transition = document.startViewTransition(() => {
        applyTheme(nextTheme);
        setThemeState(nextTheme);
        try {
          localStorage.setItem(STORAGE_KEY, nextTheme);
        } catch {
          /* ignore */
        }
      });

      transition.ready.catch(() => {
        /* ignore */
      });
    },
    [theme],
  );

  const value = useMemo(() => ({ theme, toggleTheme }), [theme, toggleTheme]);

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

/**
 * @returns {{ theme: string; toggleTheme: (event?: import("react").MouseEvent | null) => void }}
 */
export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
}
