import { useQuery } from "@tanstack/react-query";
import { api } from "../../api";

export default function AdminDashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-dash"],
    queryFn: () => api("/api/v1/admin/dashboard"),
  });

  if (isLoading || !data) {
    return <p className="text-white/50">Loading…</p>;
  }

  const cards = [
    { label: "Merchants", value: data.merchants, tone: "from-cyan-500/20 to-cyan-500/5" },
    { label: "Users", value: data.end_users, tone: "from-violet-500/20 to-violet-500/5" },
    { label: "All transactions", value: data.transactions_total, tone: "from-white/10 to-white/5" },
    { label: "Successful", value: data.transactions_success, tone: "from-emerald-500/20 to-emerald-500/5" },
    { label: "Last 24h", value: data.transactions_last_24h, tone: "from-amber-500/15 to-amber-500/5" },
  ];

  return (
    <div>
      <h1 className="text-2xl font-semibold text-white">Dashboard</h1>
      <p className="mt-1 text-sm text-white/50">Network-wide snapshot of your payment gateway.</p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {cards.map((c) => (
          <div
            key={c.label}
            className={`glass glow-border relative overflow-hidden rounded-2xl bg-gradient-to-br p-5 ${c.tone}`}
          >
            <p className="text-xs font-medium tracking-wide text-white/50 uppercase">{c.label}</p>
            <p className="mt-2 font-mono text-3xl font-semibold text-white">{c.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
