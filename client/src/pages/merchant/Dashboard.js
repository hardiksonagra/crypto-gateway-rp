import { useQuery } from "@tanstack/react-query";
import { api } from "../../api";

function fmt(raw, dec) {
  try {
    const n = BigInt(raw);
    const d = BigInt(10) ** BigInt(dec);
    const whole = n / d;
    const frac = n % d;
    if (dec === 0) return whole.toString();
    const fs = frac.toString().padStart(dec, "0").replace(/0+$/, "");
    return fs ? `${whole}.${fs}` : whole.toString();
  } catch {
    return raw;
  }
}

export default function MerchantDashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ["m-dash"],
    queryFn: () => api("/api/v1/merchant/dashboard"),
  });

  if (isLoading || !data) return <p className="text-white/50">Loading…</p>;

  return (
    <div>
      <h1 className="text-2xl font-semibold text-white">Dashboard</h1>
      <p className="mt-1 text-sm text-white/50">
        Balances reflect successful deposits minus completed withdrawals (per asset).
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="glass rounded-2xl p-5">
          <p className="text-xs text-white/50 uppercase">Users</p>
          <p className="mt-1 font-mono text-3xl text-white">{data.stats.end_users}</p>
        </div>
        <div className="glass rounded-2xl p-5">
          <p className="text-xs text-white/50 uppercase">Transactions</p>
          <p className="mt-1 font-mono text-3xl text-white">{data.stats.transactions}</p>
        </div>
      </div>

      <h2 className="mt-10 text-sm font-semibold tracking-wide text-violet-300/90 uppercase">Balances</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.balances.length === 0 ? (
          <p className="text-sm text-white/45">No settled balance yet.</p>
        ) : (
          data.balances.map((b) => (
            <div key={`${b.chain}-${b.token_symbol}`} className="glass glow-border rounded-xl p-4">
              <p className="text-xs text-white/45">
                {b.chain} · {b.token_symbol}
              </p>
              <p className="mt-1 font-mono text-xl text-white">{fmt(b.balance_raw, b.token_decimals)}</p>
              <p className="mt-1 font-mono text-[10px] text-white/35">raw {b.balance_raw}</p>
            </div>
          ))
        )}
      </div>

      <h2 className="mt-10 text-sm font-semibold tracking-wide text-violet-300/90 uppercase">Recent (7d)</h2>
      <div className="glass mt-3 overflow-hidden rounded-2xl">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-white/10 text-xs text-white/50 uppercase">
            <tr>
              <th className="px-4 py-2">When</th>
              <th className="px-4 py-2">Chain</th>
              <th className="px-4 py-2">Token</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {data.recent_transactions.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-white/50">
                  No record found.
                </td>
              </tr>
            ) : (
              data.recent_transactions.map((t) => (
                <tr key={t.id} className="text-white/80">
                  <td className="px-4 py-2 text-xs">{t.created_at.slice(0, 19)}</td>
                  <td className="px-4 py-2">{t.chain}</td>
                  <td className="px-4 py-2">{t.token_symbol}</td>
                  <td className="px-4 py-2 text-xs">{t.status}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
