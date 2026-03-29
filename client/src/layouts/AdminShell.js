import { Link, Outlet, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { api, getToken, setToken } from "../api";
import { useSidebarLayout } from "../hooks/useSidebarLayout.js";
import { useMerchantPortalEnvironment } from "../hooks/useMerchantPortalEnvironment.js";
import { ShellNavLink } from "./ShellNavLink.js";
import {
  IconActivity,
  IconDashboard,
  IconDoc,
  IconLogout,
  IconMenu,
  IconMerchants,
  IconPanelClose,
  IconPanelOpen,
  IconProfile,
  IconTransactions,
  IconUsers,
  IconWallet,
  IconWithdrawals,
} from "./shellNavIcons.js";

const nav = [
  { to: "/admin", label: "Dashboard", end: true, Icon: IconDashboard },
  { to: "/admin/merchants", label: "Merchants", Icon: IconMerchants },
  { to: "/admin/users", label: "Users", Icon: IconUsers },
  { to: "/admin/transactions", label: "Transactions", Icon: IconTransactions },
  { to: "/admin/withdrawals", label: "Withdrawals", Icon: IconWithdrawals },
  { to: "/admin/sweep", label: "Sweep", Icon: IconWallet },
  { to: "/admin/activity", label: "Activity log", Icon: IconActivity },
  { to: "/admin/profile", label: "Profile", Icon: IconProfile },
];

export default function AdminShell() {
  const navigate = useNavigate();
  const [email, setEmail] = useState(null);
  const { collapsed, toggleCollapsed, mobileOpen, setMobileOpen, closeMobile } =
    useSidebarLayout("admin");
  const {
    environment: portalEnvironment,
    flagsLoading: portalEnvFlagsLoading,
  } = useMerchantPortalEnvironment();

  useEffect(() => {
    if (!getToken()) {
      navigate("/login", { replace: true });
      return;
    }
    api("/api/v1/auth/me")
      .then((u) => {
        if (u.role !== "ADMIN") {
          setToken(null);
          navigate("/login", { replace: true });
          return;
        }
        setEmail(u.email);
      })
      .catch(() => navigate("/login", { replace: true }));
  }, [navigate]);

  function logout() {
    setToken(null);
    navigate("/login");
  }

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
          <div className="flex min-w-0 flex-1 items-center gap-2.5 md:min-w-0">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-white/5 font-display text-xs font-bold text-white"
              aria-hidden
            >
              P
            </div>
            <div
              className={`min-w-0 ${collapsed ? "md:sr-only" : ""}`}
            >
              <p className="font-display text-[10px] font-semibold tracking-[0.18em] text-white/55 uppercase">
                Paython
              </p>
              <p className="truncate text-sm font-semibold text-white">Admin</p>
            </div>
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

        {email ? (
          <p
            className={`mb-4 truncate px-1 text-xs text-white/35 ${collapsed ? "md:sr-only" : ""}`}
          >
            {email}
          </p>
        ) : null}

        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto" aria-label="Main">
          {nav.map((l) => (
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
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-white/10 bg-surface2/85 px-4 py-3 backdrop-blur-md md:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded-lg border border-white/12 p-2 text-white/70 hover:bg-white/5"
            aria-label="Open menu"
          >
            <IconMenu />
          </button>
          <span className="font-display text-sm font-semibold text-white">Admin</span>
        </header>
        <main className="min-h-0 flex-1 overflow-auto p-5 sm:p-8 lg:p-10">
          {!portalEnvFlagsLoading && portalEnvironment === "sandbox" ? (
            <div className="mb-6 rounded-xl border border-sky-400/25 bg-sky-500/10 px-4 py-3 text-sm text-sky-100/95">
              <p className="text-pretty">
                You are viewing <span className="font-medium text-white">sandbox</span> data only
                (Users and Transactions lists). To see live production data, open{" "}
                <Link
                  to="/admin/profile"
                  className="font-medium text-white underline decoration-sky-400/50 underline-offset-2 hover:decoration-sky-300/80"
                >
                  Profile
                </Link>{" "}
                and switch to <span className="font-medium text-white">Live</span>.
              </p>
            </div>
          ) : null}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
