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

function SectionCard({ title, subtitle, children }) {
  return (
    <div
      className="mt-6 w-full rounded-2xl p-6 lg:p-8"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
    >
      <div className="mb-5 flex items-start gap-3">
        <div>
          <h2 className="font-display text-base font-bold" style={{ color: "var(--text-1)" }}>{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm" style={{ color: "var(--text-2)" }}>{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

function MerchantProfilePortalSection() {
  const { environment, liveGatewayEnabled, sandboxGatewayEnabled, flagsLoading } = useMerchantPortalEnvironment();

  if (flagsLoading) {
    return (
      <SectionCard title="Portal environment">
        <p className="text-sm" style={{ color: "var(--text-3)" }}>Loading…</p>
      </SectionCard>
    );
  }
  if (!liveGatewayEnabled && !sandboxGatewayEnabled) {
    return (
      <SectionCard title="Portal environment">
        <p className="text-sm text-rose-400">Neither live nor sandbox gateway is enabled. Contact support.</p>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Portal environment"
      subtitle="Dashboard, Users, and Transactions follow your selected mode. Withdrawals are available in Live only."
    >
      <div className="space-y-4">
        <div>
          <p className="form-label">Data mode</p>
          <MerchantPortalEnvBar className="mt-2" />
        </div>
        {environment === "sandbox" && (
          <div
            className="flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm"
            style={{ background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.2)", color: "#fbbf24" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0" aria-hidden>
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            Sandbox mode — switch to Live to access production data and withdrawals.
          </div>
        )}
      </div>
    </SectionCard>
  );
}

function AdminProfilePortalSection() {
  const { environment, flagsLoading } = useMerchantPortalEnvironment();

  if (flagsLoading) {
    return (
      <SectionCard title="Admin data scope">
        <p className="text-sm" style={{ color: "var(--text-3)" }}>Loading…</p>
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
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0" aria-hidden>
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            Viewing sandbox data only — switch to Live for production gateway users and transactions.
          </div>
        )}
      </div>
    </SectionCard>
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
        <p className="text-sm" style={{ color: "var(--text-2)" }}>Loading…</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      {/* Page header */}
      <div className="mb-2">
        <h1 className="font-display text-2xl font-bold" style={{ color: "var(--text-1)" }}>Profile</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-2)" }}>
          Signed in as <span style={{ color: "var(--text-1)", fontWeight: 600 }}>{me.email}</span>
          {me.displayName && <> · <span style={{ color: "var(--text-1)" }}>{me.displayName}</span></>}
        </p>
      </div>

      {/* Account card */}
      <div
        className="mt-6 flex items-center gap-4 rounded-2xl p-5"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-[#5a6fff] to-[#9b59ff] text-xl font-bold text-white"
             style={{ boxShadow: "0 4px 16px rgba(90,111,255,0.3)" }}>
          {me.email[0].toUpperCase()}
        </div>
        <div>
          <p className="font-semibold" style={{ color: "var(--text-1)" }}>{me.displayName || me.email}</p>
          <p className="text-sm" style={{ color: "var(--text-2)" }}>{me.email}</p>
          <span
            className="mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
            style={{ background: "var(--link-active-bg)", color: "var(--link-active-color)" }}
          >
            {me.role}
          </span>
        </div>
      </div>

      {/* Environment sections */}
      {me.role === "MERCHANT" ? <MerchantProfilePortalSection /> : null}
      {me.role === "ADMIN" ? <AdminProfilePortalSection /> : null}

      {/* Change password */}
      <SectionCard
        title="Change password"
        subtitle="Use your current password, then choose a new one (at least 8 characters)."
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
          {({ isSubmitting, status }) => (
            <Form className="space-y-4">
              <div>
                <label className="form-label" htmlFor="current_password">Current password</label>
                <Field id="current_password" name="current_password" type="password" autoComplete="current-password" className="form-input" />
                <ErrorMessage name="current_password" component="p" className="mt-1 text-xs text-rose-400" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="form-label" htmlFor="new_password">New password</label>
                  <Field id="new_password" name="new_password" type="password" autoComplete="new-password" className="form-input" />
                  <ErrorMessage name="new_password" component="p" className="mt-1 text-xs text-rose-400" />
                </div>
                <div>
                  <label className="form-label" htmlFor="new_password_confirm">Confirm new password</label>
                  <Field id="new_password_confirm" name="new_password_confirm" type="password" autoComplete="new-password" className="form-input" />
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
          )}
        </Formik>
      </SectionCard>
    </div>
  );
}
