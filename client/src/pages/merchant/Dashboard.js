import { useQuery } from "@tanstack/react-query";
import { api } from "../../api";
import { useMerchantPortalEnvironment } from "../../hooks/useMerchantPortalEnvironment.js";
import { formatTokenAmount } from "../../lib/formatTokenAmount.js";

export default function MerchantDashboard() {
  const {
    environment,
    portalEnvironmentKey,
    liveGatewayEnabled,
    sandboxGatewayEnabled,
    flagsLoading,
  } = useMerchantPortalEnvironment();

  const envQueryEnabled =
    !flagsLoading &&
    ((environment === "live" && liveGatewayEnabled) ||
      (environment === "sandbox" && sandboxGatewayEnabled));

  const { data, isPending, isError, error } = useQuery({
    queryKey: ["m-dash", portalEnvironmentKey],
    queryFn: () => api("/api/v1/merchant/dashboard"),
    enabled: envQueryEnabled,
  });

  if (flagsLoading) {
    return <p className="text-white/50">Loading…</p>;
  }

  if (!liveGatewayEnabled && !sandboxGatewayEnabled) {
    return (
      <div>
        <h1 className="font-display text-2xl font-semibold text-white">Dashboard</h1>
        <p className="mt-4 text-sm text-rose-200/90">
          Neither live nor sandbox gateway is enabled for your account. Contact support.
        </p>
      </div>
    );
  }

  if (!envQueryEnabled) {
    return <p className="text-white/50">Loading…</p>;
  }

  if (isPending) {
    return <p className="text-white/50">Loading…</p>;
  }

  if (isError) {
    return (
      <div>
        <h1 className="font-display text-2xl font-semibold text-white">Dashboard</h1>
        <p className="mt-4 text-sm text-rose-200/90">{String(error)}</p>
      </div>
    );
  }

  return (
    <div>
      <div>
        <h1 className="font-display text-2xl font-semibold text-white">Dashboard</h1>
      </div>

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

      <h2 className="mt-10 text-sm font-semibold tracking-wide text-white/40 uppercase">Balances</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.balances.length === 0 ? (
          <p className="text-sm text-white/45">No settled balance yet.</p>
        ) : (
          data.balances.map((b) => (
            <div key={`${b.chain}-${b.token_symbol}`} className="glass rounded-xl p-4">
              <p className="text-xs text-white/45">
                {b.chain} · {b.token_symbol}
              </p>
              <p className="mt-1 font-mono text-xl text-white">
                {formatTokenAmount(b.balance_raw, b.token_decimals)}
              </p>
              <p className="mt-1 font-mono text-[10px] text-white/35">raw {b.balance_raw}</p>
            </div>
          ))
        )}
      </div>

      <h2 className="mt-10 text-sm font-semibold tracking-wide text-white/40 uppercase">Recent (7d)</h2>
      <div className="data-table-surface mt-3">
        <table className="data-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Chain</th>
              <th>Token</th>
              <th>Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.recent_transactions.length === 0 ? (
              <tr>
                <td colSpan={5} className="!py-12 text-center text-sm text-white/45">
                  No record found.
                </td>
              </tr>
            ) : (
              data.recent_transactions.map((t) => (
                <tr key={t.id}>
                  <td className="text-xs text-white/45">{t.created_at.slice(0, 19)}</td>
                  <td>{t.chain}</td>
                  <td>{t.token_symbol}</td>
                  <td className="font-mono text-xs text-white/90">
                    {formatTokenAmount(t.amount, t.token_decimals)}
                  </td>
                  <td className="text-xs">{t.status}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
