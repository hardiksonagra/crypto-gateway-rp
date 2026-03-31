import { Formik, Form, Field, ErrorMessage } from "formik";
import { Link } from "react-router-dom";
import { api } from "../api";
import { forgotPasswordSchema } from "../authSchemas";
import { useTheme } from "../hooks/useTheme.js";
import { BrandMark } from "../components/BrandMark.js";

const initial = { email: "" };

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

export default function ForgotPasswordPage() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <div className="mesh-bg flex min-h-screen items-center justify-center px-4 py-12">
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

      <div
        className="w-full max-w-md rounded-2xl p-8 sm:p-10"
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          boxShadow: "0 8px 40px var(--glass-shadow)",
        }}
      >
        <div className="mb-6">
          <BrandMark variant="full" className="max-h-20 max-w-[440px]" />
        </div>

        <h1 className="font-display text-2xl font-bold tracking-tight" style={{ color: "var(--text-1)" }}>
          Forgot password
        </h1>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text-2)" }}>
          Enter your account email. If it exists, we'll send you a reset link.
        </p>

        <Formik
          initialValues={initial}
          validationSchema={forgotPasswordSchema}
          validateOnBlur
          validateOnChange={false}
          onSubmit={async (values, { setStatus, setSubmitting }) => {
            setStatus(undefined);
            try {
              const r = await api("/api/v1/auth/forgot-password", {
                method: "POST",
                json: { email: values.email.trim().toLowerCase() },
              });
              setStatus({ type: "ok", message: r.message ?? "Check your email." });
            } catch (e) {
              setStatus({ type: "err", message: String(e) });
            } finally {
              setSubmitting(false);
            }
          }}
        >
          {({ isSubmitting, status }) => (
            <Form className="mt-7 space-y-4">
              <div>
                <label className="form-label" htmlFor="email">Email address</label>
                <Field
                  id="email"
                  name="email"
                  type="email"
                  className="form-input"
                  autoComplete="email"
                  placeholder="you@example.com"
                />
                <ErrorMessage name="email" component="p" className="mt-1 text-xs text-rose-400" />
              </div>

              {status?.type === "ok" ? (
                <div className="flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm"
                     style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)", color: "#22c55e" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0" aria-hidden>
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  {status.message}
                </div>
              ) : status?.type === "err" ? (
                <div className="flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm"
                     style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#ef4444" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0" aria-hidden>
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  {status.message}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={isSubmitting}
                className="btn-primary w-full rounded-xl py-3 text-sm font-semibold"
              >
                {isSubmitting ? "Sending…" : "Send reset link"}
              </button>

              <p className="text-center text-sm" style={{ color: "var(--text-3)" }}>
                <Link
                  to="/login"
                  className="transition"
                  style={{ color: "var(--text-2)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "var(--link-active-color)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-2)"; }}
                >
                  ← Back to sign in
                </Link>
              </p>
            </Form>
          )}
        </Formik>
      </div>
    </div>
  );
}
