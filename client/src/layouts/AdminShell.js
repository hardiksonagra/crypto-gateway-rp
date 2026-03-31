import { Link, Outlet, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { api, getToken, setToken } from "../api";
import { useSidebarLayout } from "../hooks/useSidebarLayout.js";
import { useMerchantPortalEnvironment } from "../hooks/useMerchantPortalEnvironment.js";
import { useTheme } from "../hooks/useTheme.js";
import { ShellNavLink } from "./ShellNavLink.js";
import {
  IconActivity,
  IconDashboard,
  IconLogout,
  IconMenu,
  IconMerchants,
  IconPanelClose,
  IconPanelOpen,
  IconProfile,
  IconSettings,
  IconTransactions,
  IconUsers,
  IconWallet,
  IconWithdrawals,
} from "./shellNavIcons.js";

const navGroups = [
  {
    label: "MAIN",
    items: [
      { to: "/control", label: "Dashboard", end: true, Icon: IconDashboard },
      { to: "/control/merchants", label: "Merchants", Icon: IconMerchants },
      { to: "/control/users", label: "Users", Icon: IconUsers },
      { to: "/control/wallets", label: "Wallets", Icon: IconWallet },
      { to: "/control/transactions", label: "Transactions", Icon: IconTransactions },
    ],
  },
  {
    label: "OPERATIONS",
    items: [
      { to: "/control/withdrawals", label: "Withdrawals", Icon: IconWithdrawals },
      { to: "/control/sweep", label: "Sweep", Icon: IconWallet },
      { to: "/control/activity", label: "Activity log", Icon: IconActivity },
    ],
  },
  {
    label: "SETTINGS",
    items: [
      { to: "/control/settings", label: "System settings", Icon: IconSettings },
      { to: "/control/profile", label: "Profile", Icon: IconProfile },
    ],
  },
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

function IconBolt() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M13 2L4.09 12.97A1 1 0 005 14.5h6.5l-1 7.5L19.91 11A1 1 0 0019 9.5h-6.5L13 2z" />
    </svg>
  );
}

export default function AdminShell() {
  const navigate = useNavigate();
  const [email, setEmail] = useState(null);
  const { collapsed, toggleCollapsed, mobileOpen, setMobileOpen, closeMobile } =
    useSidebarLayout("admin");
  const {
    environment: portalEnvironment,
    flagsLoading: portalEnvFlagsLoading,
  } = useMerchantPortalEnvironment();
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  useEffect(() => {
    if (!getToken()) {
      navigate("/control/login", { replace: true });
      return;
    }
    api("/api/v1/auth/me")
      .then((u) => {
        if (u.role !== "ADMIN") {
          setToken(null);
          navigate("/control/login", { replace: true });
          return;
        }
        setEmail(u.email);
      })
      .catch(() => navigate("/control/login", { replace: true }));
  }, [navigate]);

  function logout() {
    setToken(null);
    navigate("/control/login");
  }

  const avatarInitial = email ? email[0].toUpperCase() : "A";

  return (
    <div className="mesh-bg flex min-h-screen">
      {/* Mobile overlay */}
      {mobileOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm md:hidden"
          aria-label="Close menu"
          onClick={closeMobile}
        />
      ) : null}

      {/* ── Sidebar ────────────────────────────────────────────── */}
      <aside
        className={`sidebar-shell fixed inset-y-0 left-0 z-40 flex h-screen shrink-0 flex-col border-r p-4 md:sticky md:top-0 md:z-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        } ${
          collapsed
            ? "md:w-[4.5rem]"
            : "w-64 max-w-[min(100vw-3rem,16rem)] md:max-w-none md:w-64"
        } transition-[transform,width] duration-200 ease-out`}
        aria-label="Main navigation"
      >
        {/* Logo row */}
        <div className={`mb-6 flex items-center ${collapsed ? "justify-center" : "justify-between"}`}>
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#5a6fff] to-[#9b59ff] text-white shadow-lg"
                 style={{ boxShadow: "0 4px 16px rgba(90,111,255,0.4)" }}>
              <IconBolt />
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <p className="font-display text-[10px] font-bold tracking-[0.2em] uppercase"
                   style={{ color: "var(--text-3)" }}>Crypto</p>
                <p className="font-display text-sm font-bold truncate"
                   style={{ color: "var(--text-1)" }}>Gateway</p>
              </div>
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

        {/* User card */}
        {email && !collapsed ? (
          <div className="mb-5 flex items-center gap-2.5 rounded-xl px-3 py-2.5"
               style={{ background: "var(--bg-surface3)", border: "1px solid var(--border)" }}>
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#5a6fff] to-[#9b59ff] text-[11px] font-bold text-white">
              {avatarInitial}
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-widest"
                 style={{ color: "var(--text-3)" }}>Administrator</p>
              <p className="truncate text-xs font-medium"
                 style={{ color: "var(--text-2)" }}>{email}</p>
            </div>
          </div>
        ) : null}

        {/* Nav groups */}
        <nav className="flex flex-1 flex-col overflow-y-auto" aria-label="Main">
          {navGroups.map((group, gi) => (
            <div key={group.label} className={gi > 0 ? "mt-4" : ""}>
              {!collapsed && (
                <p className="mb-1.5 px-3 text-[9px] font-bold tracking-[0.16em] uppercase"
                   style={{ color: "var(--text-3)" }}>
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
        </nav>

        {/* Logout */}
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

      {/* ── Main ───────────────────────────────────────────────── */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="topbar-shell sticky top-0 z-20 flex items-center gap-3 border-b px-4 py-3 sm:px-6">
          {/* Mobile hamburger */}
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="shrink-0 rounded-xl border p-2 transition-colors md:hidden"
            style={{ borderColor: "var(--border)", color: "var(--text-2)" }}
            aria-label="Open menu"
          >
            <IconMenu />
          </button>

          {/* Title + env badge */}
          <div className="flex flex-1 items-center gap-2.5">
            <span className="font-display text-sm font-bold" style={{ color: "var(--text-1)" }}>
              Admin Panel
            </span>
            {!portalEnvFlagsLoading && (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                  portalEnvironment === "sandbox"
                    ? "border-amber-400/25 bg-amber-500/10 text-amber-400"
                    : "border-emerald-400/25 bg-emerald-500/10 text-emerald-400"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 animate-pulse rounded-full ${
                    portalEnvironment === "sandbox" ? "bg-amber-400" : "bg-emerald-400"
                  }`}
                />
                {portalEnvironment === "sandbox" ? "Sandbox" : "Live"}
              </span>
            )}
          </div>

          {/* Theme toggle */}
          <button
            type="button"
            onClick={(e) => toggleTheme(e)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-all duration-150"
            style={{ borderColor: "var(--border)", color: "var(--text-2)" }}
            title={isDark ? "Switch to light" : "Switch to dark"}
          >
            {isDark ? <IconSun /> : <IconMoon />}
          </button>

          {/* Avatar + email */}
          {email && (
            <div className="flex items-center gap-2.5">
              <div className="hidden flex-col items-end sm:flex">
                <span className="max-w-[160px] truncate text-xs font-semibold"
                      style={{ color: "var(--text-1)" }}>{email}</span>
                <span className="text-[10px] uppercase tracking-wider"
                      style={{ color: "var(--text-3)" }}>Admin</span>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#5a6fff] to-[#9b59ff] text-sm font-bold text-white"
                   style={{ boxShadow: "0 2px 10px rgba(90,111,255,0.35)" }}>
                {avatarInitial}
              </div>
            </div>
          )}
        </header>

        {/* Sandbox banner */}
        <main className="min-h-0 flex-1 overflow-auto p-5 sm:p-7 lg:p-8">
          {!portalEnvFlagsLoading && portalEnvironment === "sandbox" ? (
            <div className="mb-6 flex items-start gap-3 rounded-2xl border border-amber-400/20 bg-amber-500/8 px-4 py-3.5 text-sm">
              <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-amber-400" />
              <p style={{ color: "var(--text-1)" }}>
                Viewing <span className="font-semibold text-amber-400">sandbox</span> data only.{" "}
                <Link
                  to="/control/profile"
                  className="font-semibold text-amber-400 underline decoration-amber-400/40 underline-offset-2 hover:decoration-amber-300"
                >
                  Open Profile
                </Link>{" "}
                to switch to <span className="font-semibold">Live</span>.
              </p>
            </div>
          ) : null}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
