import { Formik, Form, Field, ErrorMessage } from "formik";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api, clearImpersonationAdminToken, clearImpersonationRpToken, setToken } from "../api";
import { loginSchema } from "../admin/merchantSchemas";
import { useTheme } from "../hooks/useTheme.js";
import { BrandMark } from "../components/BrandMark.js";

const initial = { email: "", password: "" };

function IconSun() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function IconMoon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

export default function LoginPage() {
  const nav = useNavigate();
  const location = useLocation();
  const resetOk = Boolean(location.state?.resetOk);
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <div className="mesh-bg flex min-h-screen flex-col lg:flex-row">
      {/* Theme toggle — fixed top-right */}
      <button
        type="button"
        onClick={(e) => toggleTheme(e)}
        className="fixed right-4 top-4 z-50 flex h-9 w-9 items-center justify-center rounded-xl border transition-all duration-150"
        style={{ borderColor: "var(--border-mid)", color: "var(--text-2)", background: "var(--bg-surface)" }}
        title={isDark ? "Switch to light" : "Switch to dark"}
      >
        {isDark ? <IconSun /> : <IconMoon />}
      </button>

      {/* Left branding panel */}
      <section
        className="relative flex min-h-[min(40vh,300px)] flex-col justify-between overflow-hidden px-6 py-10 sm:px-10 lg:min-h-0 lg:w-[45%] lg:max-w-lg lg:flex-none lg:py-14"
        style={{ borderRight: "1px solid var(--border)" }}
      >
        {/* Glow blobs */}
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full blur-3xl"
             style={{ background: "rgba(90,111,255,0.08)" }} aria-hidden />
        <div className="pointer-events-none absolute -bottom-24 -left-16 h-64 w-64 rounded-full blur-3xl"
             style={{ background: "rgba(155,89,255,0.06)" }} aria-hidden />

        <div className="relative">
          <BrandMark variant="full" className="h-24 max-h-28 max-w-none" />

          <h1 className="font-display mt-12 max-w-[20ch] text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl"
              style={{ color: "var(--text-1)" }}>
            Your gateway dashboard.
          </h1>
          <p className="mt-5 max-w-sm text-sm leading-relaxed" style={{ color: "var(--text-2)" }}>
            Merchant portal: users, wallets, transactions, API keys, and webhooks. Platform operators sign in at Control.
          </p>

          {/* Feature pills */}
          <div className="mt-8 flex flex-wrap gap-2">
            {["Multi-chain", "Deposits & callbacks", "Live & sandbox", "API integration"].map((f) => (
              <span
                key={f}
                className="rounded-full px-3 py-1 text-xs font-medium"
                style={{ background: "var(--link-active-bg)", color: "var(--link-active-color)", border: "1px solid var(--link-active-border)" }}
              >
                {f}
              </span>
            ))}
          </div>
        </div>

        <div className="relative mt-10 flex flex-wrap gap-6 pt-8 text-xs lg:mt-0"
             style={{ borderTop: "1px solid var(--border)" }}>
          {[["Portal","Merchant"],["Ops","/control/login for admins"]].map(([label, val]) => (
            <div key={label}>
              <p className="font-mono text-[10px] uppercase tracking-wider" style={{ color: "var(--text-3)" }}>{label}</p>
              <p className="mt-1" style={{ color: "var(--text-2)" }}>{val}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Right sign-in panel */}
      <section className="flex flex-1 items-stretch justify-center px-4 py-8 sm:px-8 sm:py-12 lg:items-center lg:py-16">
        <div
          className="w-full max-w-md rounded-2xl p-8 sm:p-10"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", boxShadow: "0 8px 40px var(--glass-shadow)" }}
        >
          <div className="mb-8">
            <h2 className="font-display text-2xl font-bold tracking-tight" style={{ color: "var(--text-1)" }}>
              Merchant sign in
            </h2>
            <p className="mt-1.5 text-sm" style={{ color: "var(--text-2)" }}>
              Use your merchant gateway account. Operators use Control.
            </p>
          </div>

          <Formik
            initialValues={initial}
            validationSchema={loginSchema}
            validateOnBlur
            validateOnChange={false}
            onSubmit={async (values, { setStatus, setSubmitting }) => {
              setStatus(undefined);
              try {
                const r = await api("/api/v1/auth/login", {
                  method: "POST",
                  json: { email: values.email.trim().toLowerCase(), password: values.password },
                });
                clearImpersonationAdminToken();
                clearImpersonationRpToken();
                setToken(r.token);
                nav("/", { replace: true });
              } catch (e) {
                setStatus(String(e));
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {({ isSubmitting, status }) => (
              <Form className="space-y-5">
                <div>
                  <label className="form-label" htmlFor="email">Email address</label>
                  <Field id="email" name="email" type="email" className="form-input" autoComplete="username" placeholder="you@example.com" />
                  <ErrorMessage name="email" component="p" className="mt-1 text-xs text-rose-400" />
                </div>
                <div>
                  <label className="form-label" htmlFor="password">Password</label>
                  <Field id="password" name="password" type="password" className="form-input" autoComplete="current-password" placeholder="••••••••" />
                  <ErrorMessage name="password" component="p" className="mt-1 text-xs text-rose-400" />
                </div>

                {resetOk && (
                  <div className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm text-emerald-500"
                       style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)" }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    Password updated. Sign in with your new password.
                  </div>
                )}
                {status && (
                  <div className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm text-rose-500"
                       style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                    {status}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Link to="/control/login" className="text-sm transition"
                        style={{ color: "var(--text-3)" }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--link-active-color)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-3)"; }}>
                    Admin sign in
                  </Link>
                  <Link to="/forgot-password" className="text-sm transition"
                        style={{ color: "var(--text-3)" }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--link-active-color)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-3)"; }}>
                    Forgot password?
                  </Link>
                </div>

                <button type="submit" disabled={isSubmitting} className="btn-primary w-full rounded-xl py-3 text-sm font-semibold">
                  {isSubmitting ? "Signing in…" : "Sign in"}
                </button>
              </Form>
            )}
          </Formik>
        </div>
      </section>
    </div>
  );
}
