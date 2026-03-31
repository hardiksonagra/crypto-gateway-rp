import { Link, Outlet, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import {
  api,
  clearImpersonationAdminToken,
  getImpersonationAdminToken,
  getToken,
  setToken,
} from "../api";
import { useSidebarLayout } from "../hooks/useSidebarLayout.js";
import { useMerchantPortalEnvironment } from "../hooks/useMerchantPortalEnvironment.js";
import { useTheme } from "../hooks/useTheme.js";
import { BrandMark } from "../components/BrandMark.js";
import ShellBreadcrumbs from "../components/ShellBreadcrumbs.js";
import { BreadcrumbExtrasProvider } from "../contexts/BreadcrumbExtrasContext.js";
import { ShellNavLink } from "./ShellNavLink.js";
import {
  IconDashboard,
  IconDoc,
  IconKey,
  IconLogout,
  IconMenu,
  IconPanelClose,
  IconPanelOpen,
  IconProfile,
  IconSettings,
  IconTransactions,
  IconUsers,
  IconWallet,
  IconSettlements,
} from "./shellNavIcons.js";

const primaryNav = [
  { to: "/", label: "Dashboard", end: true, Icon: IconDashboard },
  { to: "/users", label: "Users", Icon: IconUsers },
  { to: "/wallets", label: "Wallets", Icon: IconWallet },
  { to: "/transactions", label: "Transactions", Icon: IconTransactions },
  { to: "/settlements", label: "Settlements", Icon: IconSettlements },
];

const settingsNav = [
  { to: "/profile", label: "Profile", Icon: IconProfile },
  { to: "/api-key", label: "API key", Icon: IconKey },
  { to: "/settings", label: "Gateway & webhooks", Icon: IconSettings },
  { to: "/docs", label: "Doc", Icon: IconDoc },
];

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

export default function MerchantShell() {
  const navigate = useNavigate();
  const [email, setEmail] = useState(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);
  const [adminImpersonation, setAdminImpersonation] = useState(() =>
    Boolean(getImpersonationAdminToken()),
  );
  const { collapsed, toggleCollapsed, mobileOpen, setMobileOpen, closeMobile } =
    useSidebarLayout("merchant");
  const {
    environment: portalEnvironment,
    sandboxGatewayEnabled,
    flagsLoading: portalEnvFlagsLoading,
  } = useMerchantPortalEnvironment();
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  useEffect(() => {
    if (!getToken()) {
      navigate("/login", { replace: true });
      return;
    }
    api("/api/v1/auth/me")
      .then((u) => {
        if (u.role !== "MERCHANT") {
          clearImpersonationAdminToken();
          setToken(null);
          navigate("/login", { replace: true });
          return;
        }
        setEmail(u.email);
        setAdminImpersonation(Boolean(getImpersonationAdminToken()));
      })
      .catch(() => navigate("/login", { replace: true }));
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
    setToken(null);
    navigate("/login");
  }

  function backToAdmin() {
    const adminTok = getImpersonationAdminToken();
    if (!adminTok) return;
    clearImpersonationAdminToken();
    setToken(adminTok);
    setAdminImpersonation(false);
    navigate("/control", { replace: true });
  }

  const avatarInitial = email ? email[0].toUpperCase() : "M";

  return (
    <div className="mesh-bg flex min-h-screen">
      {mobileOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          aria-label="Close menu"
          onClick={closeMobile}
        />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex h-screen w-60 max-w-[min(100vw-3rem,16rem)] shrink-0 flex-col border-r border-white/10 bg-surface2/95 p-3 backdrop-blur-md transition-[transform,width] duration-200 ease-out md:sticky md:top-0 md:z-0 md:max-w-none ${
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        } ${collapsed ? "md:w-17 md:max-w-none" : "md:w-60"}`}
        aria-label="Main navigation"
      >
        <div
          className={`mb-6 flex items-start gap-2 ${collapsed ? "md:flex-col md:items-center" : ""}`}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            {collapsed ? (
              <BrandMark variant="icon" className="md:mx-auto" />
            ) : (
              <div className="min-w-0">
                <BrandMark variant="full" className="max-h-[4.5rem] max-w-[22rem]" />
                <p className="mt-1 truncate text-xs font-medium text-white/45">Merchant portal</p>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={toggleCollapsed}
            className="hidden shrink-0 rounded-lg border border-white/12 p-2 text-white/55 transition hover:border-white/20 hover:bg-white/5 hover:text-white md:flex"
            aria-expanded={!collapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <IconPanelOpen /> : <IconPanelClose />}
          </button>
        </div>

        <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto" aria-label="Main">
          {primaryNav.map((l) => (
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
        </nav>

        <button
          type="button"
          onClick={logout}
          title="Log out"
          className={`mt-4 flex items-center gap-3 rounded-lg border border-white/12 py-2.5 text-sm text-white/50 transition hover:border-white/20 hover:bg-white/5 hover:text-white/85 ${
            collapsed
              ? "justify-start px-3 md:justify-center md:px-0"
              : "px-3"
          }`}
        >
          <IconLogout />
          <span className={collapsed ? "md:sr-only" : ""}>Log out</span>
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
                variant="merchant"
                uiVariant="admin"
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
                    id="merchant-user-menu-button"
                    aria-haspopup="menu"
                    aria-expanded={userMenuOpen}
                    aria-controls="merchant-user-menu"
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
                        Merchant
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
                      id="merchant-user-menu"
                      role="menu"
                      aria-labelledby="merchant-user-menu-button"
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
                          Merchant
                        </p>
                      </div>
                      {settingsNav.map((l) => {
                        const Icon = l.Icon;
                        return (
                          <Link
                            key={l.to}
                            role="menuitem"
                            to={l.to}
                            onClick={() => setUserMenuOpen(false)}
                            className="flex items-center gap-3 px-3 py-2.5 text-sm font-medium transition-colors"
                            style={{ color: "var(--text-2)" }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = isDark
                                ? "var(--bg-surface3)"
                                : "rgba(99,102,241,0.08)";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = "";
                            }}
                          >
                            <Icon />
                            {l.label}
                          </Link>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </header>

          <main className="flex min-h-0 flex-1 flex-col overflow-auto p-5 sm:p-8 lg:p-10">
            {adminImpersonation ? (
              <div
                className={`mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${
                  isDark
                    ? "border-amber-400/25 bg-amber-500/10 text-amber-100/95"
                    : "border-amber-300 bg-amber-50 text-amber-950"
                }`}
              >
                <p className="min-w-0 text-pretty">
                  You are signed in to the{" "}
                  <span className={`font-medium ${isDark ? "text-white" : "text-amber-950"}`}>
                    merchant
                  </span>{" "}
                  portal from an admin session.
                </p>
                <button
                  type="button"
                  onClick={backToAdmin}
                  className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-semibold tracking-wide uppercase transition ${
                    isDark
                      ? "border-amber-300/35 bg-white/10 text-white hover:bg-white/15"
                      : "border-amber-400 bg-amber-100 text-amber-950 hover:bg-amber-200"
                  }`}
                >
                  Back to admin
                </button>
              </div>
            ) : null}
            {!portalEnvFlagsLoading &&
            portalEnvironment === "sandbox" &&
            sandboxGatewayEnabled ? (
              <div
                className={`mb-6 rounded-xl border px-4 py-3 text-sm ${
                  isDark
                    ? "border-sky-400/25 bg-sky-500/10 text-sky-100/95"
                    : "border-sky-300 bg-sky-50 text-sky-950"
                }`}
              >
                <p className="text-pretty">
                  You are in{" "}
                  <span className={`font-medium ${isDark ? "text-white" : "text-sky-900"}`}>
                    sandbox
                  </span>{" "}
                  mode. Dashboard, Users, and Transactions show test data only. To use live data and
                  settlements, open{" "}
                  <Link
                    to="/profile"
                    className={`font-medium underline underline-offset-2 ${
                      isDark
                        ? "text-white decoration-sky-400/50 hover:decoration-sky-300/80"
                        : "text-sky-900 decoration-sky-700/40 hover:decoration-sky-800"
                    }`}
                  >
                    Profile
                  </Link>{" "}
                  and switch to{" "}
                  <span className={`font-medium ${isDark ? "text-white" : "text-sky-900"}`}>Live</span>.
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
