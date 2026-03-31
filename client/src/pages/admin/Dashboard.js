import { useQuery } from "@tanstack/react-query";
import { api } from "../../api";
import { useMerchantPortalEnvironment } from "../../hooks/useMerchantPortalEnvironment.js";
import { useTheme } from "../../hooks/useTheme.js";

/* Per-card accent config — dark uses low-opacity glass tints, light uses soft pastels */
const CARDS_META = [
  {
    key: "merchants",
    label: "Merchants",
    sublabel: "All time",
    scope: "global",
    // dark: subtle indigo glass
    darkBg: "rgba(90,100,255,0.07)",
    darkBorder: "rgba(110,120,255,0.18)",
    darkHighlight: "rgba(120,130,255,0.12)",
    darkLabel: "#a5b4fc",
    darkValue: "rgba(230,232,255,0.92)",
    darkSub: "rgba(165,180,252,0.42)",
    darkIconBg: "rgba(99,102,255,0.14)",
    darkIconColor: "#a5b4fc",
    darkGlow: "rgba(90,100,255,0.14)",
    // light: indigo pastel card
    lightBg: "linear-gradient(145deg, #ede9fe 0%, #ddd6fe 100%)",
    lightBorder: "rgba(109,40,217,0.28)",
    lightAccent: "#6d28d9",
    lightLabel: "#5b21b6",
    lightValue: "#1e0a4a",
    lightSub: "rgba(109,40,217,0.55)",
    lightIconBg: "rgba(109,40,217,0.14)",
    lightIconColor: "#6d28d9",
    lightGlow: "rgba(109,40,217,0.18)",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
  },
  {
    key: "users",
    label: "Users",
    sublabel: "Registered",
    scope: "env",
    // dark: subtle cyan glass
    darkBg: "rgba(6,182,212,0.06)",
    darkBorder: "rgba(34,211,238,0.16)",
    darkHighlight: "rgba(103,232,249,0.10)",
    darkLabel: "#67e8f9",
    darkValue: "rgba(224,247,255,0.90)",
    darkSub: "rgba(103,232,249,0.40)",
    darkIconBg: "rgba(6,182,212,0.13)",
    darkIconColor: "#67e8f9",
    darkGlow: "rgba(6,182,212,0.13)",
    // light: sky pastel card
    lightBg: "linear-gradient(145deg, #e0f2fe 0%, #bae6fd 100%)",
    lightBorder: "rgba(3,105,161,0.28)",
    lightAccent: "#0369a1",
    lightLabel: "#0c5a8a",
    lightValue: "#082f49",
    lightSub: "rgba(3,105,161,0.55)",
    lightIconBg: "rgba(3,105,161,0.14)",
    lightIconColor: "#0369a1",
    lightGlow: "rgba(3,105,161,0.18)",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    key: "transactions_total",
    label: "Transactions",
    sublabel: "All time",
    scope: "env",
    // dark: subtle violet glass
    darkBg: "rgba(147,51,234,0.07)",
    darkBorder: "rgba(192,132,252,0.17)",
    darkHighlight: "rgba(216,180,254,0.10)",
    darkLabel: "#c084fc",
    darkValue: "rgba(248,242,255,0.90)",
    darkSub: "rgba(192,132,252,0.40)",
    darkIconBg: "rgba(147,51,234,0.14)",
    darkIconColor: "#c084fc",
    darkGlow: "rgba(147,51,234,0.14)",
    // light: purple pastel card
    lightBg: "linear-gradient(145deg, #f3e8ff 0%, #e9d5ff 100%)",
    lightBorder: "rgba(126,34,206,0.28)",
    lightAccent: "#7e22ce",
    lightLabel: "#6b21a8",
    lightValue: "#2e0a5e",
    lightSub: "rgba(126,34,206,0.55)",
    lightIconBg: "rgba(126,34,206,0.14)",
    lightIconColor: "#7e22ce",
    lightGlow: "rgba(126,34,206,0.18)",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
      </svg>
    ),
  },
  {
    key: "transactions_success",
    label: "Successful",
    sublabel: "Completed",
    scope: "env",
    // dark: subtle emerald glass
    darkBg: "rgba(16,185,129,0.06)",
    darkBorder: "rgba(52,211,153,0.15)",
    darkHighlight: "rgba(110,231,183,0.09)",
    darkLabel: "#6ee7b7",
    darkValue: "rgba(220,255,240,0.90)",
    darkSub: "rgba(110,231,183,0.40)",
    darkIconBg: "rgba(16,185,129,0.13)",
    darkIconColor: "#6ee7b7",
    darkGlow: "rgba(16,185,129,0.13)",
    // light: emerald pastel card
    lightBg: "linear-gradient(145deg, #dcfce7 0%, #bbf7d0 100%)",
    lightBorder: "rgba(21,128,61,0.28)",
    lightAccent: "#15803d",
    lightLabel: "#166534",
    lightValue: "#052e16",
    lightSub: "rgba(21,128,61,0.55)",
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
    // dark: subtle amber glass
    darkBg: "rgba(245,158,11,0.06)",
    darkBorder: "rgba(251,191,36,0.16)",
    darkHighlight: "rgba(252,211,77,0.09)",
    darkLabel: "#fcd34d",
    darkValue: "rgba(255,250,230,0.90)",
    darkSub: "rgba(252,211,77,0.40)",
    darkIconBg: "rgba(245,158,11,0.13)",
    darkIconColor: "#fcd34d",
    darkGlow: "rgba(245,158,11,0.12)",
    // light: amber pastel card
    lightBg: "linear-gradient(145deg, #fef3c7 0%, #fde68a 100%)",
    lightBorder: "rgba(180,83,9,0.28)",
    lightAccent: "#b45309",
    lightLabel: "#92400e",
    lightValue: "#451a03",
    lightSub: "rgba(180,83,9,0.55)",
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
      {/* Dark: top-edge glass highlight line */}
      {isDark && (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{ background: `linear-gradient(90deg, transparent, ${highlight}, transparent)` }}
        />
      )}

      {/* Light: colored top accent strip */}
      {!isDark && (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-[3px] rounded-t-2xl"
          style={{ background: accent }}
        />
      )}

      {/* Glow blob — corner accent */}
      <div
        className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full blur-3xl"
        style={{
          background: isDark ? `${meta.darkLabel}22` : accent,
          opacity: isDark ? 0.55 : 0.08,
        }}
      />

      <div className="relative">
        {/* Icon + env badge row */}
        <div className="mb-4 flex items-start justify-between">
          <div
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl"
            style={{ background: iconBg, color: iconColor }}
          >
            {meta.icon}
          </div>
          {meta.scope === "env" && (
            <span
              className="text-[9px] font-bold uppercase tracking-wider"
              style={{ color: sub }}
            >
              {envLabel}
            </span>
          )}
        </div>

        {/* Label */}
        <p
          className="text-[10px] font-bold uppercase tracking-[0.14em]"
          style={{ color: label }}
        >
          {meta.label}
        </p>

        {/* Big value */}
        <p
          className="mt-2 font-mono text-[2.4rem] font-bold leading-none tracking-tight"
          style={{ color: val }}
        >
          {value ?? 0}
        </p>

        {/* Sublabel */}
        <p
          className="mt-2 text-[11px] font-medium"
          style={{ color: sub }}
        >
          {meta.sublabel}
        </p>
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const { portalEnvironmentKey, environment } = useMerchantPortalEnvironment();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const { data, isLoading } = useQuery({
    queryKey: ["admin-dash", portalEnvironmentKey],
    queryFn: () => api("/api/v1/admin/dashboard"),
  });

  if (isLoading || !data) {
    return (
      <div className="flex items-center gap-3 py-4">
        <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#5a6fff]" />
        <p className="text-sm" style={{ color: "var(--text-2)" }}>Loading…</p>
      </div>
    );
  }

  const envLabel = environment === "sandbox" ? "Sandbox" : "Live";

  const values = {
    merchants: data.merchants,
    users: data.end_users,
    transactions_total: data.transactions_total,
    transactions_success: data.transactions_success,
    transactions_last_24h: data.transactions_last_24h,
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-display text-2xl font-bold" style={{ color: "var(--text-1)" }}>
          Dashboard
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-2)" }}>
          Live overview of your payment gateway
        </p>
      </div>

      {/* Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
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
    </div>
  );
}
