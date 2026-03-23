import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { api, getToken, setToken } from "../api";

const primaryNav = [
  { to: "/m", label: "Dashboard", end: true },
  { to: "/m/users", label: "Users" },
  { to: "/m/transactions", label: "Transactions" },
  { to: "/m/withdraw", label: "Withdraw" },
];

/** Shown under a “Settings” heading (callback URL, chains, rails, API docs). */
const settingsNav = [
  { to: "/m/settings", label: "Gateway & webhooks" },
  { to: "/m/docs", label: "Doc" },
];

export default function MerchantShell() {
  const navigate = useNavigate();
  const [email, setEmail] = useState(null);

  useEffect(() => {
    if (!getToken()) {
      navigate("/login", { replace: true });
      return;
    }
    api("/api/v1/auth/me")
      .then((u) => {
        if (u.role !== "MERCHANT") {
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
      <aside className="sticky top-0 flex h-screen max-h-screen w-60 shrink-0 flex-col overflow-y-auto border-r border-white/5 bg-black/20 p-4 backdrop-blur-md">
        <div className="mb-10 px-2">
          <p className="text-xs font-semibold tracking-widest text-violet-400/90 uppercase">Paython</p>
          <p className="text-lg font-semibold text-white">Merchant</p>
          {email ? <p className="truncate text-xs text-white/45">{email}</p> : null}
        </div>
        <nav className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-col gap-1">
            {primaryNav.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2.5 text-sm font-medium transition ${isActive ? "bg-violet-500/15 text-violet-200" : "text-white/55 hover:bg-white/5 hover:text-white"}`
                }
              >
                {l.label}
              </NavLink>
            ))}
          </div>
          <div className="mt-auto border-t border-white/10 pt-4">
            <p className="mb-2 px-3 text-[10px] font-semibold tracking-wider text-white/40 uppercase">Settings</p>
            <div className="flex flex-col gap-1">
              {settingsNav.map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  className={({ isActive }) =>
                    `rounded-lg px-3 py-2.5 text-sm font-medium transition ${isActive ? "bg-violet-500/15 text-violet-200" : "text-white/55 hover:bg-white/5 hover:text-white"}`
                  }
                >
                  {l.label}
                </NavLink>
              ))}
            </div>
          </div>
        </nav>
        <button
          type="button"
          onClick={logout}
          className="mt-4 rounded-lg border border-white/10 px-3 py-2 text-sm text-white/60 hover:bg-white/5"
        >
          Log out
        </button>
      </aside>
      <main className="min-h-0 flex-1 overflow-auto p-8">
        <Outlet />
      </main>
    </div>
  );
}
