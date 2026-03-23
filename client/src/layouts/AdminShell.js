import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { api, getToken, setToken } from "../api";

const nav = [
  { to: "/admin", label: "Dashboard", end: true },
  { to: "/admin/merchants", label: "Merchants" },
  { to: "/admin/users", label: "Users" },
  { to: "/admin/transactions", label: "Transactions" },
  { to: "/admin/withdrawals", label: "Withdrawals" },
];

export default function AdminShell() {
  const navigate = useNavigate();
  const [email, setEmail] = useState(null);

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
      <aside className="sticky top-0 flex h-screen max-h-screen w-60 shrink-0 flex-col overflow-y-auto border-r border-white/5 bg-black/20 p-4 backdrop-blur-md">
        <div className="mb-10 px-2">
          <p className="text-xs font-semibold tracking-widest text-cyan-400/90 uppercase">
            Paython
          </p>
          <p className="text-lg font-semibold text-white">Admin</p>
          {email ? (
            <p className="truncate text-xs text-white/45">{email}</p>
          ) : null}
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {nav.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                `rounded-lg px-3 py-2.5 text-sm font-medium transition ${isActive ? "bg-white/10 text-white" : "text-white/55 hover:bg-white/5 hover:text-white"}`
              }
            >
              {l.label}
            </NavLink>
          ))}
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
