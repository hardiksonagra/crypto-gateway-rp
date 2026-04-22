import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { useMerchantPortalEnvironment } from "../../hooks/useMerchantPortalEnvironment.js";
import { useTheme } from "../../hooks/useTheme.js";
import { BrandLoader } from "../../components/BrandLoader.js";
import { lastNDatesInZone } from "../../lib/formatLocalDateTime.js";
import AdminDashboardCharts from "./AdminDashboardCharts.js";

const HUB_LINKS = [
  {
    to: "/control/merchants",
    label: "Merchants",
    desc: "Accounts & keys",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
  },
  {
    to: "/control/users",
    label: "Users",
    desc: "End customers",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    to: "/control/wallets",
    label: "All wallets",
    desc: "Balances list",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
        <rect x="2" y="6" width="20" height="14" rx="2" />
        <path d="M2 10h20" />
        <circle cx="16" cy="14" r="1.5" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    to: "/control/transactions",
    label: "Transactions",
    desc: "Deposits & status",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
        <path d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
      </svg>
    ),
  },
  {
    to: "/control/settlements",
    label: "Settlements",
    desc: "Batches & proofs",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
        <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    ),
  },
  {
    to: "/control/sweep",
    label: "Sweep",
    desc: "Treasury moves",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" />
      </svg>
    ),
  },
  {
    to: "/control/activity",
    label: "Activity",
    desc: "Audit trail",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
  },
  {
    to: "/control/supported-chains",
    label: "Chains",
    desc: "Enable / disable networks",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M3 5v6c0 1.7 4 3 9 3s9-1.3 9-3V5" />
        <path d="M3 11v6c0 1.7 4 3 9 3s9-1.3 9-3v-6" />
      </svg>
    ),
  },
  {
    to: "/control/settings",
    label: "Settings",
    desc: "System config",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
      </svg>
    ),
  },
];

/* Per-card accent config — dark uses low-opacity glass tints, light uses soft pastels */
const CARDS_META = [
  {
    key: "merchants",
    label: "Merchants",
    sublabel: "All time",
    scope: "global",
    darkBg: "rgba(90,100,255,0.07)",
    darkBorder: "rgba(110,120,255,0.18)",
    darkHighlight: "rgba(120,130,255,0.12)",
    darkLabel: "#a5b4fc",
    darkValue: "rgba(230,232,255,0.92)",
    darkSub: "rgba(165,180,252,0.42)",
    darkIconBg: "rgba(99,102,255,0.14)",
    darkIconColor: "#a5b4fc",
    darkGlow: "rgba(90,100,255,0.14)",
    lightBg: "linear-gradient(145deg, #ede9fe 0%, #ddd6fe 100%)",
    lightBorder: "rgba(109,40,217,0.28)",
    lightAccent: "#6d28d9",
    lightLabel: "#5b21b6",
    lightValue: "#1e0a4a",
    lightSub: "rgba(91,33,182,0.82)",
    lightIconBg: "rgba(109,40,217,0.14)",
    lightIconColor: "#6d28d9",
    lightGlow: "rgba(109,40,217,0.18)",
    icon: HUB_LINKS[0].icon,
  },
  {
    key: "wallets_in_env",
    label: "All wallets",
    sublabel: "Deposit rails",
    scope: "env",
    darkBg: "rgba(14,165,233,0.07)",
    darkBorder: "rgba(56,189,248,0.2)",
    darkHighlight: "rgba(125,211,252,0.1)",
    darkLabel: "#7dd3fc",
    darkValue: "rgba(224,250,255,0.92)",
    darkSub: "rgba(125,211,252,0.42)",
    darkIconBg: "rgba(14,165,233,0.14)",
    darkIconColor: "#7dd3fc",
    darkGlow: "rgba(14,165,233,0.14)",
    lightBg: "linear-gradient(145deg, #e0f2fe 0%, #bae6fd 100%)",
    lightBorder: "rgba(3,105,161,0.28)",
    lightAccent: "#0369a1",
    lightLabel: "#0c5a8a",
    lightValue: "#082f49",
    lightSub: "rgba(3,105,161,0.82)",
    lightIconBg: "rgba(3,105,161,0.14)",
    lightIconColor: "#0369a1",
    lightGlow: "rgba(3,105,161,0.18)",
    icon: HUB_LINKS[2].icon,
  },
  {
    key: "users",
    label: "Users",
    sublabel: "Registered",
    scope: "env",
    darkBg: "rgba(6,182,212,0.06)",
    darkBorder: "rgba(34,211,238,0.16)",
    darkHighlight: "rgba(103,232,249,0.10)",
    darkLabel: "#67e8f9",
    darkValue: "rgba(224,247,255,0.90)",
    darkSub: "rgba(103,232,249,0.40)",
    darkIconBg: "rgba(6,182,212,0.13)",
    darkIconColor: "#67e8f9",
    darkGlow: "rgba(6,182,212,0.13)",
    lightBg: "linear-gradient(145deg, #e0f2fe 0%, #bae6fd 100%)",
    lightBorder: "rgba(3,105,161,0.28)",
    lightAccent: "#0369a1",
    lightLabel: "#0c5a8a",
    lightValue: "#082f49",
    lightSub: "rgba(3,105,161,0.82)",
    lightIconBg: "rgba(3,105,161,0.14)",
    lightIconColor: "#0369a1",
    lightGlow: "rgba(3,105,161,0.18)",
    icon: HUB_LINKS[1].icon,
  },
  {
    key: "transactions_total",
    label: "Transactions",
    sublabel: "All time",
    scope: "env",
    darkBg: "rgba(147,51,234,0.07)",
    darkBorder: "rgba(192,132,252,0.17)",
    darkHighlight: "rgba(216,180,254,0.10)",
    darkLabel: "#c084fc",
    darkValue: "rgba(248,242,255,0.90)",
    darkSub: "rgba(192,132,252,0.40)",
    darkIconBg: "rgba(147,51,234,0.14)",
    darkIconColor: "#c084fc",
    darkGlow: "rgba(147,51,234,0.14)",
    lightBg: "linear-gradient(145deg, #f3e8ff 0%, #e9d5ff 100%)",
    lightBorder: "rgba(126,34,206,0.28)",
    lightAccent: "#7e22ce",
    lightLabel: "#6b21a8",
    lightValue: "#2e0a5e",
    lightSub: "rgba(107,33,168,0.82)",
    lightIconBg: "rgba(126,34,206,0.14)",
    lightIconColor: "#7e22ce",
    lightGlow: "rgba(126,34,206,0.18)",
    icon: HUB_LINKS[3].icon,
  },
  {
    key: "transactions_success",
    label: "Successful",
    sublabel: "Completed",
    scope: "env",
    darkBg: "rgba(16,185,129,0.06)",
    darkBorder: "rgba(52,211,153,0.15)",
    darkHighlight: "rgba(110,231,183,0.09)",
    darkLabel: "#6ee7b7",
    darkValue: "rgba(220,255,240,0.90)",
    darkSub: "rgba(110,231,183,0.40)",
    darkIconBg: "rgba(16,185,129,0.13)",
    darkIconColor: "#6ee7b7",
    darkGlow: "rgba(16,185,129,0.13)",
    lightBg: "linear-gradient(145deg, #dcfce7 0%, #bbf7d0 100%)",
    lightBorder: "rgba(21,128,61,0.28)",
    lightAccent: "#15803d",
    lightLabel: "#166534",
    lightValue: "#052e16",
    lightSub: "rgba(21,128,61,0.82)",
    lightIconBg: "rgba(21,128,61,0.15)",
    lightIconColor: "#15803d",
    lightGlow: "rgba(21,128,61,0.18)",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <polyline points="20 6 9 17 4 12" />
      </svg>
    ),
  },
  {
    key: "transactions_last_24h",
    label: "Last 24h",
    sublabel: "Recent activity",
    scope: "env",
    darkBg: "rgba(245,158,11,0.06)",
    darkBorder: "rgba(251,191,36,0.16)",
    darkHighlight: "rgba(252,211,77,0.09)",
    darkLabel: "#fcd34d",
    darkValue: "rgba(255,250,230,0.90)",
    darkSub: "rgba(252,211,77,0.40)",
    darkIconBg: "rgba(245,158,11,0.13)",
    darkIconColor: "#fcd34d",
    darkGlow: "rgba(245,158,11,0.12)",
    lightBg: "linear-gradient(145deg, #fef3c7 0%, #fde68a 100%)",
    lightBorder: "rgba(180,83,9,0.28)",
    lightAccent: "#b45309",
    lightLabel: "#92400e",
    lightValue: "#451a03",
    lightSub: "rgba(146,64,14,0.88)",
    lightIconBg: "rgba(180,83,9,0.14)",
    lightIconColor: "#b45309",
    lightGlow: "rgba(180,83,9,0.18)",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
];

/**
 * @param {{ meta: typeof CARDS_META[0], value: number | undefined, envLabel: string, isDark: boolean }} props
 */
function StatCard({ meta, value, envLabel, isDark }) {
  const bg = isDark ? meta.darkBg : meta.lightBg;
  const border = isDark ? meta.darkBorder : meta.lightBorder;
  const highlight = isDark ? meta.darkHighlight : null;
  const label = isDark ? meta.darkLabel : meta.lightLabel;
  const val = isDark ? meta.darkValue : meta.lightValue;
  const sub = isDark ? meta.darkSub : meta.lightSub;
  const iconBg = isDark ? meta.darkIconBg : meta.lightIconBg;
  const iconColor = isDark ? meta.darkIconColor : meta.lightIconColor;
  const glow = isDark ? meta.darkGlow : meta.lightGlow;
  const accent = isDark ? meta.darkLabel : meta.lightAccent;

  return (
    <div
      className="group relative overflow-hidden rounded-2xl p-5 transition-all duration-200 hover:-translate-y-0.5"
      style={{
        background: bg,
        border: `1px solid ${border}`,
        boxShadow: isDark
          ? `0 1px 0 0 ${highlight} inset, 0 8px 24px ${glow}`
          : `0 1px 3px rgba(0,0,0,0.08), 0 8px 28px ${glow}`,
        backdropFilter: isDark ? "blur(8px)" : undefined,
      }}
    >
      {isDark && (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{ background: `linear-gradient(90deg, transparent, ${highlight}, transparent)` }}
        />
      )}
      {!isDark && (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-[3px] rounded-t-2xl"
          style={{ background: accent }}
        />
      )}
      <div
        className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full blur-3xl"
        style={{
          background: isDark ? `${meta.darkLabel}22` : accent,
          opacity: isDark ? 0.55 : 0.08,
        }}
      />
      <div className="relative">
        <div className="mb-4 flex items-start justify-between">
          <div
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl"
            style={{ background: iconBg, color: iconColor }}
          >
            {meta.icon}
          </div>
          {meta.scope === "env" && (
            <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: sub }}>
              {envLabel}
            </span>
          )}
        </div>
        <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: label }}>
          {meta.label}
        </p>
        <p
          className="mt-2 font-mono text-[2.4rem] font-bold leading-none tracking-tight"
          style={{ color: val }}
        >
          {value ?? 0}
        </p>
        <p className="mt-2 text-[11px] font-medium" style={{ color: sub }}>
          {meta.sublabel}
        </p>
      </div>
    </div>
  );
}

/**
 * @param {Array<{ date: string, pending: number, success: number, failed: number, underpaid?: number }>} daily
 * @param {string} timeZone
 */
function normalizeDailySeries(daily, timeZone) {
  const keys = lastNDatesInZone(14, timeZone);
  const map = new Map((daily ?? []).map((row) => [row.date, row]));
  return keys.map(
    (date) =>
      map.get(date) ?? { date, pending: 0, success: 0, failed: 0, underpaid: 0 },
  );
}

export default function AdminDashboard() {
  const { portalEnvironmentKey, environment } = useMerchantPortalEnvironment();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const dashTz =
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : "UTC";

  const { data, isLoading } = useQuery({
    queryKey: ["admin-dash", portalEnvironmentKey, dashTz],
    queryFn: () =>
      api(
        `/api/v1/admin/dashboard?tz=${encodeURIComponent(dashTz)}`,
      ),
  });

  if (isLoading || !data) {
    return (
      <BrandLoader
        variant="section"
        title=""
        subtitle="Loading dashboard…"
        aria-label="Loading admin dashboard"
      />
    );
  }

  const envLabel = environment === "sandbox" ? "Sandbox" : "Live";

  const values = {
    merchants: data.merchants,
    wallets_in_env: data.wallets_in_env ?? 0,
    users: data.end_users,
    transactions_total: data.transactions_total,
    transactions_success: data.transactions_success,
    transactions_last_24h: data.transactions_last_24h,
  };

  const txs = Number(data.transactions_total) || 0;
  const ok = Number(data.transactions_success) || 0;
  const successRatePct = txs > 0 ? (ok / txs) * 100 : 0;

  const daily = normalizeDailySeries(data.transactions_daily_by_status, dashTz);
  const byStatus = data.transactions_by_status ?? [];
  const byChain = data.transactions_by_chain ?? [];

  return (
    <div className="w-full max-w-none space-y-10 pb-8">
      {/* Hub — whole console in one surface */}
      <section
        className={`relative overflow-hidden rounded-3xl border p-6 sm:p-8 ${
          isDark
            ? ""
            : "border-indigo-200/60 bg-gradient-to-br from-indigo-50/95 via-white to-violet-50/90 shadow-[0_1px_0_rgba(255,255,255,0.8)_inset,0_20px_50px_-20px_rgba(79,70,229,0.2)]"
        }`}
        style={
          isDark
            ? {
                borderColor: "var(--border)",
                background:
                  "linear-gradient(145deg, rgba(15,23,42,0.92) 0%, rgba(30,27,75,0.55) 42%, rgba(15,23,42,0.88) 100%)",
                boxShadow: "0 0 0 1px rgba(255,255,255,0.04) inset, 0 24px 48px -24px rgba(0,0,0,0.5)",
              }
            : undefined
        }
      >
        <div
          className="pointer-events-none absolute -left-1/4 top-0 h-[min(420px,55vw)] w-[min(420px,55vw)] rounded-full opacity-40 blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(56,189,248,0.35) 0%, transparent 65%)" }}
        />
        <div
          className="pointer-events-none absolute -right-1/4 bottom-0 h-[min(380px,50vw)] w-[min(380px,50vw)] rounded-full opacity-35 blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(139,92,246,0.4) 0%, transparent 65%)" }}
        />
        <div
          className={`pointer-events-none absolute left-1/2 top-1/2 h-px w-[min(90%,48rem)] -translate-x-1/2 -translate-y-1/2 ${isDark ? "opacity-[0.07]" : "opacity-[0.12]"}`}
          style={{
            background: isDark
              ? "linear-gradient(90deg, transparent, rgba(255,255,255,0.9), transparent)"
              : "linear-gradient(90deg, transparent, rgba(79,70,229,0.35), transparent)",
          }}
        />

        <div className="relative">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p
                className={`text-[10px] font-bold uppercase tracking-[0.35em] ${isDark ? "text-sky-300/80" : "text-indigo-600/90"}`}
              >
                Operator console
              </p>
              <h1
                className={`font-display mt-2 text-3xl font-bold tracking-tight sm:text-4xl ${isDark ? "text-white" : "text-slate-900"}`}
              >
                Gateway control center
              </h1>
              <p
                className={`mt-2 max-w-xl text-sm leading-relaxed ${isDark ? "text-white/55" : "text-slate-600"}`}
              >
                One hub for merchants, wallets, deposits, settlements, and rails. Jump to any area or scan
                metrics and charts below — all scoped to{" "}
                <span className={`font-semibold ${isDark ? "text-white/85" : "text-slate-900"}`}>
                  {envLabel}
                </span>{" "}
                lists and transaction data.
              </p>
            </div>
            <div
              className={`flex shrink-0 items-center gap-2 rounded-2xl border px-4 py-3 backdrop-blur-sm ${
                isDark ? "border-white/10 bg-black/25" : "border-indigo-200/70 bg-white/70"
              }`}
              title="Portal list & transaction environment"
            >
              <span
                className={`text-[10px] font-bold uppercase tracking-wider ${isDark ? "text-white/40" : "text-slate-700"}`}
              >
                Data plane
              </span>
              <span
                className={`rounded-lg px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${
                  environment === "sandbox"
                    ? isDark
                      ? "border border-sky-400/35 bg-sky-500/15 text-sky-100"
                      : "border border-sky-300 bg-sky-100 text-sky-900"
                    : isDark
                      ? "border border-emerald-400/35 bg-emerald-500/15 text-emerald-100"
                      : "border border-emerald-300 bg-emerald-100 text-emerald-900"
                }`}
              >
                {envLabel}
              </span>
            </div>
          </div>

          <nav
            className="relative mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8"
            aria-label="Admin sections"
          >
            {HUB_LINKS.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={`group flex flex-col items-center gap-2 rounded-2xl border px-2 py-4 text-center transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500/80 ${
                  isDark
                    ? "border-white/[0.08] bg-white/[0.04] hover:border-sky-400/35 hover:bg-white/[0.07] hover:shadow-[0_0_24px_-4px_rgba(56,189,248,0.35)]"
                    : "border-slate-200/90 bg-white/80 hover:border-indigo-300 hover:bg-white hover:shadow-[0_8px_28px_-8px_rgba(79,70,229,0.25)]"
                }`}
              >
                <span
                  className={`flex h-11 w-11 items-center justify-center rounded-xl border bg-gradient-to-br transition ${
                    isDark
                      ? "border-white/10 from-white/10 to-white/[0.02] text-sky-200/90 group-hover:border-sky-400/30 group-hover:text-white"
                      : "border-indigo-100 from-indigo-50 to-violet-50/80 text-indigo-600 group-hover:border-indigo-300 group-hover:text-indigo-800"
                  }`}
                  aria-hidden
                >
                  {item.icon}
                </span>
                <span
                  className={`text-[11px] font-bold uppercase tracking-wide ${isDark ? "text-white/80" : "text-slate-800"}`}
                >
                  {item.label}
                </span>
                <span
                  className={`hidden text-[10px] sm:block ${isDark ? "text-white/40" : "text-slate-700"}`}
                >
                  {item.desc}
                </span>
              </Link>
            ))}
          </nav>
        </div>
      </section>

      {/* KPI grid */}
      <section aria-labelledby="dash-kpi-heading">
        <h2 id="dash-kpi-heading" className="font-display text-lg font-bold" style={{ color: "var(--text-1)" }}>
          Live metrics
        </h2>
        <p className="mt-1 text-sm" style={{ color: "var(--text-2)" }}>
          Counts update with your portal environment; merchants are global.
        </p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {CARDS_META.map((meta) => (
            <StatCard
              key={meta.key}
              meta={meta}
              value={values[meta.key]}
              envLabel={envLabel}
              isDark={isDark}
            />
          ))}
        </div>
      </section>

      {/* Highcharts */}
      <section aria-labelledby="dash-charts-heading">
        <h2 id="dash-charts-heading" className="font-display text-lg font-bold" style={{ color: "var(--text-1)" }}>
          Trends & breakdown
        </h2>
        <p className="mt-1 text-sm" style={{ color: "var(--text-2)" }}>
          Stacked columns, donut, solid gauge, and horizontal bars — powered by Highcharts.
        </p>
        <div className="mt-5">
          <AdminDashboardCharts
            daily={daily}
            byStatus={byStatus}
            byChain={byChain}
            successRatePct={successRatePct}
            isDark={isDark}
          />
        </div>
      </section>
    </div>
  );
}
