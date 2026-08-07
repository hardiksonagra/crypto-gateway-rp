import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { PendingSettlementBucketCard } from "../../components/PendingSettlementBucketCard.js";
import { BrandLoader } from "../../components/BrandLoader.js";
import AdminDashboardCharts from "../admin/AdminDashboardCharts.js";
import { renderMerchantPortalBlockers } from "../../components/MerchantPortalPageGates.js";
import { useMerchantPortalEnvironment } from "../../hooks/useMerchantPortalEnvironment.js";
import { useTheme } from "../../hooks/useTheme.js";
import { formatTokenAmount } from "../../lib/formatTokenAmount.js";
import { formatLocalDateTime } from "../../lib/formatLocalDateTime.js";

const cardShell =
  "surface-adaptive-card group relative overflow-hidden rounded-2xl border border-white/[0.09] bg-gradient-to-br from-[#141a2e]/92 via-[#0e1222]/96 to-[#090c18] p-5 shadow-[0_20px_40px_-14px_rgba(0,0,0,0.5)] ring-1 ring-inset ring-white/[0.04]";

const rail =
  "pointer-events-none absolute inset-y-3 left-0 w-1 rounded-full bg-gradient-to-b from-cyan-400 via-indigo-500 to-fuchsia-500 opacity-90";

/**
 * @param {{ status: string }} props
 */
function TxStatusBadge({ status }) {
  const s = String(status).toLowerCase();
  const cls =
    s === "success"
      ? "bg-emerald-500/15 text-emerald-100/90 ring-emerald-400/30"
      : s === "pending"
        ? "bg-amber-500/12 text-amber-100/90 ring-amber-400/25"
        : s === "underpaid"
          ? "bg-sky-500/12 text-sky-100/90 ring-sky-400/30"
          : s === "failed"
            ? "bg-rose-500/12 text-rose-100/90 ring-rose-400/25"
            : "bg-white/[0.06] text-white/50 ring-white/10";
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${cls}`}>
      {status}
    </span>
  );
}

export default function MerchantDashboard() {
  const {
    environment,
    portalEnvironmentKey,
    liveGatewayEnabled,
    sandboxGatewayEnabled,
    flagsLoading,
    merchantEmail,
    merchantDisplayName,
    needsPortalSwitch,
    merchantApiReady,
    portalListAccess,
    portalListDeniedMessage,
    wrongPortalRole,
    authMeIsError,
    authMeError,
  } = useMerchantPortalEnvironment();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const dashTz =
    typeof Intl !== "undefined" && typeof Intl.DateTimeFormat === "function"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : "UTC";

  const { data, isPending, isError, error } = useQuery({
    queryKey: ["m-dash", portalEnvironmentKey, dashTz],
    queryFn: () =>
      api(`/api/v1/merchant/dashboard?tz=${encodeURIComponent(dashTz)}`),
    enabled: merchantApiReady,
  });

  const portalGate = renderMerchantPortalBlockers({
    pageTitle: "Dashboard",
    loaderSubtitle: "Loading dashboard…",
    flagsLoading,
    authMeIsError,
    authMeError,
    liveGatewayEnabled,
    sandboxGatewayEnabled,
    needsPortalSwitch,
    environment,
    merchantApiReady,
    portalListAccess,
    portalListDeniedMessage,
    wrongPortalRole,
  });
  if (portalGate) return portalGate;

  /** v5: disabled queries stay `isPending`; only show loader when fetch is actually enabled */
  if (merchantApiReady && isPending) {
    return (
      <BrandLoader
        variant="page"
        title=""
        subtitle="Loading dashboard…"
        aria-label="Loading dashboard data"
      />
    );
  }

  if (isError) {
    const st = error && typeof error === "object" && "status" in error ? Number(error.status) : NaN;
    const code =
      error && typeof error === "object" && "errorCode" in error
        ? String(/** @type {{ errorCode?: unknown }} */ (error).errorCode ?? "")
        : "";
    const detail =
      error && typeof error === "object" && "message" in error
        ? String(/** @type {{ message?: unknown }} */ (error).message ?? "").trim()
        : "";
    const msg =
      st === 403 && code === "forbidden"
        ? "This area needs a merchant session. Sign out and sign in with Merchant sign in."
        : st === 403 && detail
          ? detail
          : st === 403
            ? "Access was denied. Please sign out and sign in again."
            : String(error?.message ?? error ?? "Request failed");
    return (
      <div>
        <h1 className="font-display text-2xl font-semibold text-white">Dashboard</h1>
        <p className="mt-4 text-sm text-rose-200/90">{msg}</p>
      </div>
    );
  }

  const pending = data.pending_settlement_batches ?? [];
  const envLabel = data.environment === "live" ? "Live" : "Sandbox";
  const envBadgeCls =
    data.environment === "live"
      ? "border-emerald-400/35 bg-emerald-500/12 text-emerald-100/95"
      : "border-sky-400/35 bg-sky-500/12 text-sky-100/95";

  return (
    <div className="w-full max-w-[1400px]">
      <header className="surface-adaptive-hero relative overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-r from-[#151a2e]/95 via-[#0c1020]/98 to-[#0a0d18] p-6 ring-1 ring-inset ring-white/[0.04] sm:p-7">
        <div
          className="pointer-events-none absolute -right-8 -top-12 h-40 w-56 rounded-full bg-indigo-500/[0.15] blur-3xl"
          aria-hidden
        />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Dashboard
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest ${envBadgeCls}`}
            >
              {envLabel}
            </span>
            <Link
              to="/pay-in-settlements"
              className="rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/75 transition hover:border-indigo-400/40 hover:bg-indigo-500/10 hover:text-white"
            >
              Transactions settlements →
            </Link>
          </div>
        </div>
      </header>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <article className={`${cardShell} pl-6`}>
          <div className={rail} aria-hidden />
          <p className="text-[10px] font-bold uppercase tracking-widest text-white/38">End users</p>
          <p className="mt-2 font-mono text-3xl font-semibold tabular-nums text-white">{data.stats.end_users}</p>
        </article>
        <article className={`${cardShell} pl-6`}>
          <div className={rail} aria-hidden />
          <p className="text-[10px] font-bold uppercase tracking-widest text-white/38">Transactions</p>
          <p className="mt-2 font-mono text-3xl font-semibold tabular-nums text-white">
            {data.stats.transactions}
          </p>
        </article>
      </div>

      {data.charts ? (
        <section className="mt-10" aria-label="Transaction charts">
          <h2 className="text-sm font-semibold tracking-wide text-white/40 uppercase">Activity charts</h2>
          <div className="mt-5">
            <AdminDashboardCharts
              daily={data.charts.transactions_daily_by_status}
              byStatus={data.charts.transactions_by_status}
              byChain={data.charts.transactions_by_chain}
              successRatePct={data.charts.success_rate_pct}
              isDark={isDark}
            />
          </div>
        </section>
      ) : null}

      <section className="mt-12">
        <h2 className="text-sm font-semibold tracking-wide text-white/40 uppercase">Next settlement (estimate)</h2>
        {pending.length === 0 ? (
          <p className="mt-4 text-sm text-white/45">Nothing queued for settlement in this environment.</p>
        ) : (
          <div className="mt-5 flex w-full flex-col gap-4">
            {pending.map((b) => (
              <PendingSettlementBucketCard
                key={`${b.chain}-${b.token_symbol}-${b.token_decimals}`}
                variant="merchant"
                b={b}
                merchantEmail={merchantEmail}
                merchantDisplayName={merchantDisplayName}
              />
            ))}
          </div>
        )}
      </section>

      <section className="mt-12">
        <h2 className="text-sm font-semibold tracking-wide text-white/40 uppercase">Available balance</h2>
        {data.balances.length === 0 ? (
          <p className="mt-4 text-sm text-white/45">No positive balance in this environment.</p>
        ) : (
          <div className="mt-5 flex flex-col gap-3">
            {data.balances.map((b) => (
              <article
                key={`${b.chain}-${b.token_symbol}-${b.token_decimals}`}
                className="surface-adaptive-row relative flex flex-wrap items-center justify-between gap-4 overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-r from-slate-900/80 via-[#0e1324]/90 to-[#090c16] px-5 py-4 pl-6 ring-1 ring-inset ring-white/[0.04] sm:px-6"
              >
                <div
                  className="pointer-events-none absolute inset-y-2 left-0 w-0.5 rounded-full bg-gradient-to-b from-violet-400 to-cyan-500 opacity-90"
                  aria-hidden
                />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-lg border border-cyan-500/30 bg-cyan-500/[0.12] px-2.5 py-0.5 font-mono text-[11px] font-bold uppercase tracking-wider text-cyan-100/95">
                    {b.chain}
                  </span>
                  <span className="rounded-lg border border-violet-500/30 bg-violet-500/[0.12] px-2.5 py-0.5 font-mono text-[11px] font-semibold text-violet-100/95">
                    {b.token_symbol}
                  </span>
                </div>
                <div className="text-right">
                  <p className="font-mono text-xl font-semibold tabular-nums text-white">
                    {formatTokenAmount(b.balance_raw, b.token_decimals)}
                  </p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="mt-12">
        <h2 className="text-sm font-semibold tracking-wide text-white/40 uppercase">
          Recent Success (7d)
        </h2>
        <div className="surface-adaptive-inset mt-4 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0a0d14]/60 ring-1 ring-inset ring-white/[0.04]">
          <div className="data-table-surface border-0 !shadow-none">
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
                      No successful deposits in the last 7 days.
                    </td>
                  </tr>
                ) : (
                  data.recent_transactions.map((t) => (
                    <tr key={t.id}>
                      <td className="whitespace-nowrap text-xs text-white/45">
                        {formatLocalDateTime(t.created_at)}
                      </td>
                      <td className="text-xs text-white/75">{t.chain}</td>
                      <td className="text-xs text-white/75">{t.token_symbol}</td>
                      <td className="font-mono text-xs text-white/90">
                        {formatTokenAmount(t.amount, t.token_decimals)}
                      </td>
                      <td>
                        <TxStatusBadge status={t.status} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
