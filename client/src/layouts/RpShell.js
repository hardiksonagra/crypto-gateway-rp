import { Link, Outlet, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import {
  api,
  clearImpersonationAdminToken,
  clearImpersonationRpToken,
  getImpersonationAdminToken,
  getToken,
  isAuthSessionFailure,
  isTransientApiFailure,
  setToken,
} from "../api";
import { useSidebarLayout } from "../hooks/useSidebarLayout.js";
import { useMerchantPortalEnvironment } from "../hooks/useMerchantPortalEnvironment.js";
import { useTheme } from "../hooks/useTheme.js";
import { BrandMark } from "../components/BrandMark.js";
import { BreadcrumbExtrasProvider } from "../contexts/BreadcrumbExtrasContext.js";
import ShellBreadcrumbs from "../components/ShellBreadcrumbs.js";
import { ShellNavLink } from "./ShellNavLink.js";
import {
  IconDashboard,
  IconDoc,
  IconLogout,
  IconMenu,
  IconMerchants,
  IconPanelClose,
  IconPanelOpen,
  IconProfile,
  IconSettlements,
  IconTransactions,
  IconUsers,
  IconWallet,
  IconPayout,
} from "./shellNavIcons.js";

function IconSun() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function IconMoon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function IconChevronDown({ className }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

const navGroups = [
  {
    label: "MAIN",
    items: [
      { to: "/rp", label: "Dashboard", end: true, Icon: IconDashboard },
      { to: "/rp/merchants", label: "Merchants", Icon: IconMerchants },
      { to: "/rp/users", label: "Users", Icon: IconUsers },
      { to: "/rp/wallets", label: "All wallets", Icon: IconWallet },
      { to: "/rp/wallet-details", label: "Wallet details", Icon: IconDoc },
      { to: "/rp/pay-ins", label: "Transactions", Icon: IconTransactions },
      { to: "/rp/pay-outs", label: "Payout", Icon: IconPayout },
    ],
  },
  {
    label: "OPERATIONS",
    items: [
      { to: "/rp/pay-in-settlements", label: "Transactions settlements", Icon: IconSettlements },
      { to: "/rp/pay-out-settlements", label: "Payout settlements", Icon: IconPayout },
    ],
  },
  {
    label: "TOOLS",
    items: [{ to: "/rp/decode-gateway-data", label: "Decode data", Icon: IconDoc }],
  },
];

export default function RpShell() {
  const navigate = useNavigate();
  const [email, setEmail] = useState(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);
  const { collapsed, toggleCollapsed, mobileOpen, setMobileOpen, closeMobile } = useSidebarLayout("rp");
  const [adminImpersonation, setAdminImpersonation] = useState(() =>
    Boolean(getImpersonationAdminToken()),
  );
  const {
    environment: portalEnvironment,
    flagsLoading: portalEnvFlagsLoading,
  } = useMerchantPortalEnvironment();
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  useEffect(() => {
    if (!getToken()) {
      navigate("/rp/login", { replace: true });
      return;
    }
    let cancelled = false;
    let timeoutId = 0;

    const goLogin = () => {
      clearImpersonationAdminToken();
      clearImpersonationRpToken();
      setToken(null);
      navigate("/rp/login", { replace: true });
    };

    const run = async () => {
      try {
        const u = await api("/api/v1/auth/me");
        if (cancelled) return;
        if (u.role !== "RP") {
          goLogin();
          return;
        }
        setEmail(u.email);
        setAdminImpersonation(Boolean(getImpersonationAdminToken()));
      } catch (e) {
        if (cancelled) return;
        if (isTransientApiFailure(e)) {
          timeoutId = window.setTimeout(run, 3000);
          return;
        }
        if (isAuthSessionFailure(e)) {
          goLogin();
          return;
        }
        timeoutId = window.setTimeout(run, 5000);
      }
    };

    void run();
    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [navigate]);

  useEffect(() => {
    if (!userMenuOpen) return;
    function onDocMouseDown(e) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setUserMenuOpen(false);
      }
    }
    function onKey(e) {
      if (e.key === "Escape") setUserMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [userMenuOpen]);

  function logout() {
    clearImpersonationAdminToken();
    clearImpersonationRpToken();
    setToken(null);
    navigate("/rp/login");
  }

  function backToAdmin() {
    const adminTok = getImpersonationAdminToken();
    if (!adminTok) return;
    clearImpersonationAdminToken();
    clearImpersonationRpToken();
    setToken(adminTok);
    setAdminImpersonation(false);
    navigate("/control/reseller-partners", { replace: true });
  }

  const avatarInitial = email ? email[0].toUpperCase() : "P";

  return (
    <div className="mesh-bg flex min-h-screen">
      {mobileOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm md:hidden"
          aria-label="Close menu"
          onClick={closeMobile}
        />
      ) : null}

      <aside
        className={`sidebar-shell fixed inset-y-0 left-0 z-40 flex h-screen shrink-0 flex-col border-r p-4 md:sticky md:top-0 md:z-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        } ${
          collapsed
            ? "md:w-[4.5rem]"
            : "w-64 max-w-[min(100vw-3rem,16rem)] md:max-w-none md:w-64"
        } transition-[transform,width] duration-200 ease-out`}
        aria-label="Partner navigation"
      >
        <div className={`mb-6 flex items-center ${collapsed ? "justify-center" : "justify-between"}`}>
          <div className="flex min-w-0 items-center gap-2.5">
            {collapsed ? (
              <BrandMark variant="icon" />
            ) : (
              <BrandMark variant="full" className="max-h-[4.5rem] max-w-[22rem]" />
            )}
          </div>
          <button
            type="button"
            onClick={toggleCollapsed}
            className="hidden shrink-0 rounded-lg p-1.5 transition-colors hover:opacity-80 md:flex"
            style={{ color: "var(--text-3)" }}
            aria-expanded={!collapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <IconPanelOpen /> : <IconPanelClose />}
          </button>
        </div>

        <nav className="flex flex-1 flex-col overflow-y-auto" aria-label="Main">
          {navGroups.map((group, gi) => (
            <div key={group.label} className={gi > 0 ? "mt-4" : ""}>
              {!collapsed && (
                <p
                  className="mb-1.5 px-3 text-[9px] font-bold tracking-[0.16em] uppercase"
                  style={{ color: isDark ? "var(--text-3)" : "rgba(45, 55, 100, 0.72)" }}
                >
                  {group.label}
                </p>
              )}
              {collapsed && gi > 0 && (
                <div className="my-3 mx-2 h-px" style={{ background: "var(--border)" }} />
              )}
              <div className="flex flex-col gap-0.5">
                {group.items.map((l) => (
                  <ShellNavLink
                    key={l.to}
                    to={l.to}
                    end={l.end}
                    label={l.label}
                    Icon={l.Icon}
                    collapsed={collapsed}
                    onPick={closeMobile}
                  />
                ))}
              </div>
            </div>
          ))}

          <Link
            to="/rp/merchants/new"
            onClick={closeMobile}
            title={collapsed ? "Create merchant" : undefined}
            className={`mt-3 flex items-center gap-3 rounded-xl border border-emerald-500/35 py-2.5 text-sm font-medium transition-colors hover:bg-emerald-500/12 ${
              collapsed
                ? "justify-start border-l-2 border-transparent pl-3 pr-3 md:justify-center md:gap-0 md:border-0 md:px-0"
                : "border-l-2 border-transparent px-3"
            }`}
            style={{ color: "var(--text-1)" }}
          >
            <span className={`text-base font-semibold leading-none ${collapsed ? "" : "text-emerald-400"}`}>+</span>
            {!collapsed && <span className="text-emerald-200/95">Create merchant</span>}
            {collapsed && <span className="sr-only">Create merchant</span>}
          </Link>
        </nav>

        <button
          type="button"
          onClick={logout}
          title="Log out"
          className={`mt-4 flex items-center gap-3 rounded-xl border py-2.5 text-sm font-medium transition-all duration-150 ${
            collapsed ? "justify-center px-0" : "px-3"
          }`}
          style={{ borderColor: "var(--border)", color: "var(--text-2)" }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(239,68,68,0.08)";
            e.currentTarget.style.borderColor = "rgba(239,68,68,0.3)";
            e.currentTarget.style.color = "#f87171";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "";
            e.currentTarget.style.borderColor = "var(--border)";
            e.currentTarget.style.color = "var(--text-2)";
          }}
        >
          <IconLogout />
          {!collapsed && <span>Log out</span>}
        </button>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <BreadcrumbExtrasProvider>
          <header className="topbar-shell sticky top-0 z-20 flex items-center gap-2 border-b px-4 py-2.5 sm:gap-3 sm:px-6">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="shrink-0 rounded-xl border p-2 transition-colors md:hidden"
              style={{ borderColor: "var(--border)", color: "var(--text-2)" }}
              aria-label="Open menu"
            >
              <IconMenu />
            </button>

            <div className="min-w-0 flex-1 overflow-hidden">
              <ShellBreadcrumbs
                variant="rp"
                className="text-[11px] leading-snug sm:text-sm [&_ol]:flex-nowrap [&_ol]:overflow-hidden"
              />
            </div>

            <div className="flex shrink-0 items-center gap-2 sm:gap-2.5">
              {!portalEnvFlagsLoading && (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider sm:px-2.5 sm:py-0.5 ${
                    portalEnvironment === "sandbox"
                      ? isDark
                        ? "border-amber-400/25 bg-amber-500/10 text-amber-400"
                        : "border-amber-300 bg-amber-100 text-amber-950"
                      : isDark
                        ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-400"
                        : "border-emerald-300 bg-emerald-100 text-emerald-950"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 animate-pulse rounded-full ${
                      portalEnvironment === "sandbox"
                        ? isDark
                          ? "bg-amber-400"
                          : "bg-amber-600"
                        : isDark
                          ? "bg-emerald-400"
                          : "bg-emerald-600"
                    }`}
                  />
                  {portalEnvironment === "sandbox" ? "Sandbox" : "Live"}
                </span>
              )}

              <button
                type="button"
                onClick={(e) => toggleTheme(e)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-all duration-150"
                style={{ borderColor: "var(--border)", color: "var(--text-2)" }}
                title={isDark ? "Switch to light" : "Switch to dark"}
              >
                {isDark ? <IconSun /> : <IconMoon />}
              </button>

              {email ? (
                <div className="relative" ref={userMenuRef}>
                  <button
                    type="button"
                    id="rp-user-menu-button"
                    aria-haspopup="menu"
                    aria-expanded={userMenuOpen}
                    aria-controls="rp-user-menu"
                    onClick={() => setUserMenuOpen((o) => !o)}
                    className="flex max-w-[min(100vw-8rem,20rem)] items-center gap-2 rounded-xl border py-1.5 pl-2 pr-2 transition-colors sm:gap-2.5 sm:pl-2.5 sm:pr-2"
                    style={{
                      borderColor: "var(--border)",
                      background: isDark ? "var(--bg-surface2)" : "rgba(255,255,255,0.85)",
                      boxShadow: isDark ? undefined : "0 1px 3px rgba(15, 23, 42, 0.06)",
                    }}
                  >
                    <div className="hidden min-w-0 flex-1 flex-col items-end text-right sm:flex">
                      <span
                        className="max-w-[140px] truncate text-xs font-semibold xl:max-w-[200px]"
                        style={{ color: "var(--text-1)" }}
                      >
                        {email}
                      </span>
                      <span
                        className="text-[10px] uppercase tracking-wider"
                        style={{ color: "var(--text-3)" }}
                      >
                        Partner
                      </span>
                    </div>
                    <div
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#5a6fff] to-[#9b59ff] text-sm font-bold text-white sm:rounded-xl"
                      style={{ boxShadow: "0 2px 10px rgba(90,111,255,0.35)" }}
                    >
                      {avatarInitial}
                    </div>
                    <span className="shrink-0 opacity-70" style={{ color: "var(--text-2)" }}>
                      <IconChevronDown
                        className={`transition-transform duration-200 ${userMenuOpen ? "rotate-180" : ""}`}
                      />
                    </span>
                  </button>

                  {userMenuOpen ? (
                    <div
                      id="rp-user-menu"
                      role="menu"
                      aria-labelledby="rp-user-menu-button"
                      className="absolute right-0 top-[calc(100%+0.375rem)] z-50 min-w-[13.5rem] overflow-hidden rounded-xl border py-1 shadow-lg"
                      style={{
                        borderColor: "var(--border)",
                        background: isDark ? "var(--bg-surface2)" : "#ffffff",
                        boxShadow: isDark
                          ? "0 12px 40px rgba(0,0,0,0.45)"
                          : "0 12px 40px rgba(15, 23, 42, 0.12)",
                      }}
                    >
                      <div
                        className="border-b px-3 py-2.5 sm:hidden"
                        style={{ borderColor: "var(--border)" }}
                      >
                        <p
                          className="truncate text-xs font-semibold"
                          style={{ color: "var(--text-1)" }}
                        >
                          {email}
                        </p>
                        <p className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-3)" }}>
                          Partner
                        </p>
                      </div>
                      <Link
                        role="menuitem"
                        to="/rp/profile"
                        onClick={() => setUserMenuOpen(false)}
                        className="flex items-center gap-3 px-3 py-2.5 text-sm font-medium transition-colors"
                        style={{ color: "var(--text-2)" }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = isDark ? "var(--bg-surface3)" : "rgba(99,102,241,0.08)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "";
                        }}
                      >
                        <IconProfile />
                        Profile
                      </Link>
                      <Link
                        role="menuitem"
                        to="/rp/decode-gateway-data"
                        onClick={() => setUserMenuOpen(false)}
                        className="flex items-center gap-3 px-3 py-2.5 text-sm font-medium transition-colors"
                        style={{ color: "var(--text-2)" }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = isDark ? "var(--bg-surface3)" : "rgba(99,102,241,0.08)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "";
                        }}
                      >
                        <IconDoc />
                        Decode Data
                      </Link>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </header>

          <main className="flex min-h-0 flex-1 flex-col overflow-auto p-5 sm:p-7 lg:p-8">
            {adminImpersonation ? (
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100/95">
                <p className="min-w-0 text-pretty">
                  You are signed in to the{" "}
                  <span className="font-medium text-white">reseller partner</span> portal from an admin
                  session.
                </p>
                <button
                  type="button"
                  onClick={backToAdmin}
                  className="shrink-0 rounded-lg border border-amber-300/35 bg-white/10 px-3 py-1.5 text-xs font-semibold tracking-wide text-white uppercase transition hover:bg-white/15"
                >
                  Back to admin
                </button>
              </div>
            ) : null}

            {!portalEnvFlagsLoading && portalEnvironment === "sandbox" ? (
              <div
                className={`mb-6 flex items-start gap-3 rounded-2xl border px-4 py-3.5 text-sm ${
                  isDark ? "border-amber-400/20 bg-amber-500/8" : "border-amber-300 bg-amber-50"
                }`}
              >
                <span
                  className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
                    isDark ? "bg-amber-400" : "bg-amber-600"
                  }`}
                />
                <p style={{ color: "var(--text-1)" }}>
                  Viewing{" "}
                  <span
                    className={`font-semibold ${isDark ? "text-amber-400" : "text-amber-900"}`}
                  >
                    sandbox
                  </span>{" "}
                  data only.{" "}
                  <Link
                    to="/rp/profile"
                    className={`font-semibold underline underline-offset-2 ${
                      isDark
                        ? "text-amber-400 decoration-amber-400/40 hover:decoration-amber-300"
                        : "text-amber-900 decoration-amber-700/35 hover:decoration-amber-800"
                    }`}
                  >
                    Open Profile
                  </Link>{" "}
                  to switch to <span className="font-semibold">Live</span>.
                </p>
              </div>
            ) : null}

            <Outlet />
          </main>
        </BreadcrumbExtrasProvider>
      </div>
    </div>
  );
}
