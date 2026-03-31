import { Formik, Form, Field, ErrorMessage } from "formik";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { resetPasswordSchema } from "../authSchemas";
import { useTheme } from "../hooks/useTheme.js";
import { BrandMark } from "../components/BrandMark.js";

const initial = { new_password: "", new_password_confirm: "" };

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

function mapResetError(msg) {
  if (msg === "invalid_or_expired_token")
    return "This reset link is invalid or has expired. Request a new one from the sign-in page.";
  if (msg === "new_password_too_short")
    return "Password must be at least 8 characters.";
  return msg;
}

function AuthCard({ children }) {
  return (
    <div
      className="w-full max-w-md rounded-2xl p-8 sm:p-10"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        boxShadow: "0 8px 40px var(--glass-shadow)",
      }}
    >
      {children}
    </div>
  );
}

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token")?.trim() ?? "";
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  const themeToggle = (
    <button
      type="button"
      onClick={(e) => toggleTheme(e)}
      className="fixed right-4 top-4 z-50 flex h-9 w-9 items-center justify-center rounded-xl border transition-all duration-150"
      style={{ borderColor: "var(--border-mid)", color: "var(--text-2)", background: "var(--bg-surface)" }}
      title={isDark ? "Switch to light" : "Switch to dark"}
    >
      {isDark ? <IconSun /> : <IconMoon />}
    </button>
  );

  const logoMark = (
    <div className="mb-6">
      <BrandMark variant="full" className="max-h-20 max-w-[440px]" />
    </div>
  );

  if (!token) {
    return (
      <div className="mesh-bg flex min-h-screen items-center justify-center px-4 py-12">
        {themeToggle}
        <AuthCard>
          {logoMark}
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl"
                 style={{ background: "rgba(239,68,68,0.1)" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </div>
            <h1 className="font-display text-xl font-bold" style={{ color: "var(--text-1)" }}>Invalid link</h1>
            <p className="mt-2 text-sm" style={{ color: "var(--text-2)" }}>
              Missing reset token. Open the link from your email.
            </p>
            <Link
              to="/forgot-password"
              className="mt-6 inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-medium transition"
              style={{ background: "var(--link-active-bg)", color: "var(--link-active-color)", border: "1px solid var(--link-active-border)" }}
            >
              Request a new link
            </Link>
          </div>
        </AuthCard>
      </div>
    );
  }

  return (
    <div className="mesh-bg flex min-h-screen items-center justify-center px-4 py-12">
      {themeToggle}
      <AuthCard>
        {logoMark}

        <h1 className="font-display text-2xl font-bold tracking-tight" style={{ color: "var(--text-1)" }}>
          Set new password
        </h1>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text-2)" }}>
          Choose a strong password for your account.
        </p>

        <Formik
          initialValues={initial}
          validationSchema={resetPasswordSchema}
          validateOnBlur
          validateOnChange={false}
          onSubmit={async (values, { setStatus, setSubmitting }) => {
            setStatus(undefined);
            try {
              await api("/api/v1/auth/reset-password", {
                method: "POST",
                json: { token, new_password: values.new_password },
              });
              navigate("/login", { replace: true, state: { resetOk: true } });
            } catch (e) {
              setStatus(mapResetError(String(e).replace(/^Error:\s*/, "")));
            } finally {
              setSubmitting(false);
            }
          }}
        >
          {({ isSubmitting, status }) => (
            <Form className="mt-7 space-y-4">
              <div>
                <label className="form-label" htmlFor="new_password">New password</label>
                <Field
                  id="new_password"
                  name="new_password"
                  type="password"
                  className="form-input"
                  autoComplete="new-password"
                  placeholder="Min. 8 characters"
                />
                <ErrorMessage name="new_password" component="p" className="mt-1 text-xs text-rose-400" />
              </div>
              <div>
                <label className="form-label" htmlFor="new_password_confirm">Confirm password</label>
                <Field
                  id="new_password_confirm"
                  name="new_password_confirm"
                  type="password"
                  className="form-input"
                  autoComplete="new-password"
                  placeholder="Repeat your password"
                />
                <ErrorMessage name="new_password_confirm" component="p" className="mt-1 text-xs text-rose-400" />
              </div>

              {status ? (
                <div className="flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm"
                     style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#ef4444" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0" aria-hidden>
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  {status}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={isSubmitting}
                className="btn-primary w-full rounded-xl py-3 text-sm font-semibold"
              >
                {isSubmitting ? "Saving…" : "Save new password"}
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
      </AuthCard>
    </div>
  );
}
