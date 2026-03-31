import { useEffect, useState } from "react";
import { Formik, Form, Field, ErrorMessage } from "formik";
import { api } from "../api";
import { changePasswordSchema } from "../authSchemas";
import MerchantPortalEnvBar from "../components/MerchantPortalEnvBar.js";
import { useMerchantPortalEnvironment } from "../hooks/useMerchantPortalEnvironment.js";

const passwordInitial = { current_password: "", new_password: "", new_password_confirm: "" };

function mapPasswordError(msg) {
  if (msg === "current_password_invalid") return "Current password is incorrect.";
  if (msg === "new_password_too_short") return "New password must be at least 8 characters.";
  return msg;
}

/**
 * @param {{ title: string; subtitle?: string; children: import("react").ReactNode; className?: string; bodyClassName?: string }} props
 */
function SectionCard({ title, subtitle, children, className = "", bodyClassName = "" }) {
  return (
    <div
      className={`w-full rounded-2xl p-4 sm:p-5 lg:p-6 ${className}`}
      style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
    >
      <div className={`mb-3 flex flex-wrap items-start justify-between gap-2 sm:mb-4 ${bodyClassName}`}>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-base font-bold" style={{ color: "var(--text-1)" }}>
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-0.5 text-xs leading-snug sm:text-sm" style={{ color: "var(--text-2)" }}>
              {subtitle}
            </p>
          ) : null}
        </div>
      </div>
      {children}
    </div>
  );
}

/**
 * @param {{ me: Record<string, unknown> & { id?: string; email?: string; displayName?: string; mdr_percent?: number; settlement_rate_percent?: number; min_settlement_amount?: string; settlement_period_days?: number } }} props
 */
function MerchantFeeRatesSection({ me }) {
  const mdr = typeof me.mdr_percent === "number" ? me.mdr_percent : Number(me.mdr_percent ?? 0);
  const settlePct =
    typeof me.settlement_rate_percent === "number"
      ? me.settlement_rate_percent
      : Number(me.settlement_rate_percent ?? 0);
  const minRaw = String(me.min_settlement_amount ?? "0").trim();
  const minLabel = minRaw === "" || minRaw === "0" ? "No minimum" : minRaw;
  const holdDays =
    typeof me.settlement_period_days === "number"
      ? me.settlement_period_days
      : Number(me.settlement_period_days ?? 0);

  const tile =
    "rounded-lg border px-2.5 py-2.5 sm:px-3 sm:py-3 h-full min-h-0 flex flex-col";
  const tileStyle = {
    background: "rgba(255,255,255,0.03)",
    borderColor: "var(--border)",
  };
  const dtCls = "text-[10px] font-bold uppercase tracking-wider";
  const dtStyle = { color: "var(--text-3)" };

  return (
    <SectionCard
      className="h-full"
      title="Fees & settlement"
      subtitle="Set by your admin — same values used for batch previews and payouts."
    >
      <dl className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
        <div className={`${tile} col-span-2 lg:col-span-4`} style={tileStyle}>
          <dt className={dtCls} style={dtStyle}>
            Merchant ID
          </dt>
          <dd className="mt-0.5 font-mono text-[11px] leading-relaxed break-all sm:text-xs" style={{ color: "var(--text-1)" }}>
            {me.id ?? "—"}
          </dd>
        </div>
        <div className={`${tile} col-span-1`} style={tileStyle}>
          <dt className={dtCls} style={dtStyle}>
            MDR
          </dt>
          <dd className="mt-0.5 font-mono text-lg font-semibold tabular-nums sm:text-xl" style={{ color: "var(--text-1)" }}>
            {Number.isFinite(mdr) ? mdr.toFixed(2) : "—"}%
          </dd>
          <dd className="mt-auto pt-1.5 text-[10px] leading-snug sm:text-[11px]" style={{ color: "var(--text-3)" }}>
            On gross batch volume.
          </dd>
        </div>
        <div className={`${tile} col-span-1`} style={tileStyle}>
          <dt className={dtCls} style={dtStyle}>
            Settlement fee
          </dt>
          <dd className="mt-0.5 font-mono text-lg font-semibold tabular-nums sm:text-xl" style={{ color: "var(--text-1)" }}>
            {Number.isFinite(settlePct) ? settlePct.toFixed(2) : "—"}%
          </dd>
          <dd className="mt-auto pt-1.5 text-[10px] leading-snug sm:text-[11px]" style={{ color: "var(--text-3)" }}>
            After MDR, before net.
          </dd>
        </div>
        <div className={`${tile} col-span-2 lg:col-span-2`} style={tileStyle}>
          <dt className={dtCls} style={dtStyle}>
            Minimum settlement
          </dt>
          <dd className="mt-0.5 font-mono text-base font-semibold tabular-nums sm:text-lg" style={{ color: "var(--text-1)" }}>
            {minLabel}
          </dd>
          <dd className="mt-auto pt-1.5 text-[10px] leading-snug sm:text-[11px]" style={{ color: "var(--text-3)" }}>
            Token units per asset. Net must be strictly above the converted minimum.
          </dd>
        </div>
        <div className={`${tile} col-span-2 lg:col-span-4`} style={tileStyle}>
          <dt className={dtCls} style={dtStyle}>
            Settlement hold
          </dt>
          <dd className="mt-0.5 font-mono text-base font-semibold tabular-nums sm:text-lg" style={{ color: "var(--text-1)" }}>
            {holdDays === 0 ? "None" : `${holdDays} day(s)`}
          </dd>
          <dd className="mt-auto pt-1.5 text-[10px] leading-snug sm:text-[11px]" style={{ color: "var(--text-3)" }}>
            Newer deposits are excluded from the next batch estimate.
          </dd>
        </div>
      </dl>
    </SectionCard>
  );
}

/** Portal environment controls for merchant profile hero (right column). */
function MerchantProfileHeroPortal() {
  const { environment, liveGatewayEnabled, sandboxGatewayEnabled, flagsLoading } = useMerchantPortalEnvironment();

  if (flagsLoading) {
    return (
      <div className="flex h-full min-h-[7rem] flex-col rounded-lg border border-white/10 bg-black/25 p-3.5 sm:p-4">
        <p className="text-xs text-white/50">Loading portal…</p>
      </div>
    );
  }
  if (!liveGatewayEnabled && !sandboxGatewayEnabled) {
    return (
      <div className="flex h-full min-h-0 flex-col rounded-lg border border-rose-500/30 bg-rose-500/10 p-3.5 sm:p-4">
        <p className="text-[10px] font-bold uppercase tracking-widest text-white/45">Portal environment</p>
        <p className="mt-1.5 text-xs leading-snug text-rose-200/95">
          Neither live nor sandbox gateway is enabled. Contact support.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col rounded-lg border border-white/10 bg-black/25 p-3.5 sm:p-4">
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/45">Portal environment</p>
      <p className="mt-0.5 text-[11px] leading-snug text-white/50 sm:text-xs">
        Dashboard, Users, and Transactions follow this mode. Settlements and live balances use Live.
      </p>
      <p className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-white/40">Data mode</p>
      <MerchantPortalEnvBar className="mt-1.5 w-full" />
      {environment === "sandbox" ? (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-400/25 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-snug text-amber-100/95 sm:text-xs">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mt-0.5 shrink-0 opacity-90"
            aria-hidden
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span>Sandbox — switch to Live for production data and settlements.</span>
        </div>
      ) : (
        <p className="mt-3 text-[11px] leading-snug text-white/45 sm:text-xs">
          Live mode uses production gateway data for this portal.
        </p>
      )}
    </div>
  );
}

function AdminProfilePortalSection() {
  const { environment, flagsLoading } = useMerchantPortalEnvironment();

  if (flagsLoading) {
    return (
      <SectionCard title="Admin data scope">
        <p className="text-sm" style={{ color: "var(--text-3)" }}>
          Loading…
        </p>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Admin data scope"
      subtitle="The global Users and Transactions lists show only the selected environment's data."
    >
      <div className="space-y-4">
        <div>
          <p className="form-label">List data mode</p>
          <MerchantPortalEnvBar className="mt-2" />
        </div>
        {environment === "sandbox" && (
          <div
            className="flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm"
            style={{ background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.2)", color: "#fbbf24" }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mt-0.5 shrink-0"
              aria-hidden
            >
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            Viewing sandbox data only — switch to Live for production gateway users and transactions.
          </div>
        )}
      </div>
    </SectionCard>
  );
}

/**
 * @param {{ me: Record<string, unknown> & { email?: string; displayName?: string; role?: string } }} props
 */
function MerchantProfileHero({ me }) {
  const email = me.email ?? "";
  const initial = email.length ? email[0].toUpperCase() : "?";

  return (
    <header className="relative w-full overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-br from-[#151a2e]/95 via-[#0e1222]/98 to-[#090c18] p-4 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.55)] ring-1 ring-inset ring-white/[0.04] sm:p-5 lg:p-6">
      <div
        className="pointer-events-none absolute -right-12 -top-16 h-40 w-56 rounded-full bg-indigo-500/[0.12] blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute bottom-0 left-1/3 h-20 w-64 bg-gradient-to-r from-cyan-500/[0.06] to-transparent blur-2xl"
        aria-hidden
      />
      <div className="relative grid gap-4 sm:gap-5 lg:grid-cols-2 lg:items-stretch lg:gap-6">
        <div className="flex min-w-0 items-start gap-3 sm:items-center sm:gap-4">
          <div
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#5a6fff] to-[#9b59ff] text-xl font-bold text-white sm:h-16 sm:w-16 sm:rounded-2xl sm:text-2xl lg:h-[4.25rem] lg:w-[4.25rem] lg:text-3xl"
            style={{ boxShadow: "0 6px 22px rgba(90,111,255,0.32)" }}
          >
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">Profile</p>
            <h1 className="font-display mt-0.5 truncate text-xl font-bold tracking-tight text-white sm:text-2xl lg:text-3xl">
              {me.displayName || email || "Merchant"}
            </h1>
            <p className="mt-0.5 truncate text-xs text-white/55 sm:text-sm">{email}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="rounded-full border border-white/15 bg-white/[0.08] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white/80">
                {me.role}
              </span>
            </div>
          </div>
        </div>
        <MerchantProfileHeroPortal />
      </div>
    </header>
  );
}

/**
 * @param {{ me: Record<string, unknown> }} props
 */
function PasswordSection({ me }) {
  const merchantLayout = me.role === "MERCHANT";

  return (
    <SectionCard
      title="Change password"
      subtitle="Current password, then a new one (min. 8 characters)."
    >
      <Formik
        initialValues={passwordInitial}
        validationSchema={changePasswordSchema}
        validateOnBlur
        validateOnChange={false}
        onSubmit={async (values, { setStatus, setSubmitting, resetForm }) => {
          setStatus(undefined);
          try {
            await api("/api/v1/auth/me/password", {
              method: "PATCH",
              json: { current_password: values.current_password, new_password: values.new_password },
            });
            resetForm({ values: passwordInitial });
            setStatus("ok");
          } catch (e) {
            setStatus(mapPasswordError(String(e).replace(/^Error:\s*/, "")));
          } finally {
            setSubmitting(false);
          }
        }}
      >
        {({ isSubmitting, status }) =>
          merchantLayout ? (
            <Form className="space-y-3">
              <div className="grid gap-3 lg:grid-cols-12 lg:items-end lg:gap-x-3 lg:gap-y-2">
                <div className="lg:col-span-4">
                  <label className="form-label" htmlFor="current_password">
                    Current password
                  </label>
                  <Field
                    id="current_password"
                    name="current_password"
                    type="password"
                    autoComplete="current-password"
                    className="form-input w-full"
                  />
                  <ErrorMessage name="current_password" component="p" className="mt-1 text-xs text-rose-400" />
                </div>
                <div className="lg:col-span-3">
                  <label className="form-label" htmlFor="new_password">
                    New password
                  </label>
                  <Field
                    id="new_password"
                    name="new_password"
                    type="password"
                    autoComplete="new-password"
                    className="form-input w-full"
                  />
                  <ErrorMessage name="new_password" component="p" className="mt-1 text-xs text-rose-400" />
                </div>
                <div className="lg:col-span-3">
                  <label className="form-label" htmlFor="new_password_confirm">
                    Confirm new
                  </label>
                  <Field
                    id="new_password_confirm"
                    name="new_password_confirm"
                    type="password"
                    autoComplete="new-password"
                    className="form-input w-full"
                  />
                  <ErrorMessage name="new_password_confirm" component="p" className="mt-1 text-xs text-rose-400" />
                </div>
                <div className="lg:col-span-2">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="btn-primary w-full rounded-xl px-5 py-2.5 text-sm lg:mt-0"
                  >
                    {isSubmitting ? "Updating…" : "Update"}
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                {status === "ok" && <p className="text-sm text-emerald-400">Password updated successfully.</p>}
                {status && status !== "ok" && <p className="text-sm text-rose-400">{status}</p>}
              </div>
            </Form>
          ) : (
            <Form className="space-y-4">
              <div>
                <label className="form-label" htmlFor="current_password">
                  Current password
                </label>
                <Field
                  id="current_password"
                  name="current_password"
                  type="password"
                  autoComplete="current-password"
                  className="form-input"
                />
                <ErrorMessage name="current_password" component="p" className="mt-1 text-xs text-rose-400" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="form-label" htmlFor="new_password">
                    New password
                  </label>
                  <Field
                    id="new_password"
                    name="new_password"
                    type="password"
                    autoComplete="new-password"
                    className="form-input"
                  />
                  <ErrorMessage name="new_password" component="p" className="mt-1 text-xs text-rose-400" />
                </div>
                <div>
                  <label className="form-label" htmlFor="new_password_confirm">
                    Confirm new password
                  </label>
                  <Field
                    id="new_password_confirm"
                    name="new_password_confirm"
                    type="password"
                    autoComplete="new-password"
                    className="form-input"
                  />
                  <ErrorMessage name="new_password_confirm" component="p" className="mt-1 text-xs text-rose-400" />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-4 pt-1">
                <button type="submit" disabled={isSubmitting} className="btn-primary rounded-xl px-5 py-2.5 text-sm">
                  {isSubmitting ? "Updating…" : "Update password"}
                </button>
                {status === "ok" && <p className="text-sm text-emerald-400">Password updated successfully.</p>}
                {status && status !== "ok" && <p className="text-sm text-rose-400">{status}</p>}
              </div>
            </Form>
          )
        }
      </Formik>
    </SectionCard>
  );
}

/**
 * @param {{ me: Record<string, unknown> }} props
 */
function MerchantProfilePage({ me }) {
  return (
    <div className="w-full min-w-0">
      <MerchantProfileHero me={me} />

      <div className="mt-4 flex w-full flex-col gap-4 sm:mt-5 sm:gap-5">
        <MerchantFeeRatesSection me={me} />
        <PasswordSection me={me} />
      </div>
    </div>
  );
}

export default function Profile() {
  const [me, setMe] = useState(null);

  useEffect(() => {
    api("/api/v1/auth/me").then(setMe);
  }, []);

  if (!me) {
    return (
      <div className="flex items-center gap-2 py-4">
        <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#5a6fff]" />
        <p className="text-sm" style={{ color: "var(--text-2)" }}>
          Loading…
        </p>
      </div>
    );
  }

  if (me.role === "MERCHANT") {
    return <MerchantProfilePage me={me} />;
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-2">
        <h1 className="font-display text-2xl font-bold" style={{ color: "var(--text-1)" }}>
          Profile
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-2)" }}>
          Signed in as <span style={{ color: "var(--text-1)", fontWeight: 600 }}>{me.email}</span>
          {me.displayName && (
            <>
              {" "}
              · <span style={{ color: "var(--text-1)" }}>{me.displayName}</span>
            </>
          )}
        </p>
      </div>

      <div
        className="mt-6 flex items-center gap-4 rounded-2xl p-5"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
      >
        <div
          className="flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-[#5a6fff] to-[#9b59ff] text-xl font-bold text-white"
          style={{ boxShadow: "0 4px 16px rgba(90,111,255,0.3)" }}
        >
          {me.email[0].toUpperCase()}
        </div>
        <div>
          <p className="font-semibold" style={{ color: "var(--text-1)" }}>
            {me.displayName || me.email}
          </p>
          <p className="text-sm" style={{ color: "var(--text-2)" }}>
            {me.email}
          </p>
          <span
            className="mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
            style={{ background: "var(--link-active-bg)", color: "var(--link-active-color)" }}
          >
            {me.role}
          </span>
        </div>
      </div>

      <div className="mt-6">
        <AdminProfilePortalSection />
      </div>

      <div className="mt-6">
        <PasswordSection me={me} />
      </div>
    </div>
  );
}
