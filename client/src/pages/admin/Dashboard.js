import { useQuery } from "@tanstack/react-query";
import { api } from "../../api";
import { useMerchantPortalEnvironment } from "../../hooks/useMerchantPortalEnvironment.js";

export default function AdminDashboard() {
  const { portalEnvironmentKey, environment } = useMerchantPortalEnvironment();
  const { data, isLoading } = useQuery({
    queryKey: ["admin-dash", portalEnvironmentKey],
    queryFn: () => api("/api/v1/admin/dashboard"),
  });

  if (isLoading || !data) {
    return <p className="text-white/50">Loading…</p>;
  }

  const envLabel = environment === "sandbox" ? "Sandbox" : "Live";

  const cards = [
    { label: "Merchants", value: data.merchants, scope: "global" },
    { label: "Users", value: data.end_users, scope: "env" },
    { label: "All transactions", value: data.transactions_total, scope: "env" },
    { label: "Successful", value: data.transactions_success, scope: "env" },
    { label: "Last 24h", value: data.transactions_last_24h, scope: "env" },
  ];

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-white">Dashboard</h1>
      <p className="mt-1 text-sm text-white/50">
        Merchant count is global. Users and transaction stats follow your Profile data scope (
        <span className="text-white/65">{envLabel}</span>).
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className="glass relative overflow-hidden rounded-2xl bg-gradient-to-br from-white/6 to-transparent p-5">
            <p className="text-xs font-medium tracking-wide text-white/50 uppercase">{c.label}</p>
            {c.scope === "env" ? (
              <p className="mt-0.5 text-[10px] font-medium tracking-wide text-sky-300/70 uppercase">
                {envLabel}
              </p>
            ) : null}
            <p className="mt-2 font-mono text-3xl font-semibold text-white">{c.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
