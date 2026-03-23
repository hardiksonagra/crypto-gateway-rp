import { Formik, Form, Field, ErrorMessage } from "formik";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api, setToken } from "../api";
import { loginSchema } from "../admin/merchantSchemas";

const initial = { email: "", password: "" };

export default function LoginPage() {
  const nav = useNavigate();
  const location = useLocation();
  const resetOk = Boolean(location.state?.resetOk);

  return (
    <div className="mesh-bg flex min-h-screen flex-col lg:flex-row">
      <section className="relative flex min-h-[min(40vh,320px)] flex-col justify-between overflow-hidden border-b border-white/8 px-6 py-10 sm:px-10 lg:min-h-0 lg:w-[42%] lg:max-w-xl lg:flex-none lg:border-b-0 lg:border-r lg:border-white/8 lg:py-14">
        <div
          className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-white/[0.04] blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-white/[0.03] blur-3xl"
          aria-hidden
        />
        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/15 bg-white/5 font-display text-lg font-bold text-white">
              P
            </div>
            <div>
              <p className="font-display text-[10px] font-bold tracking-[0.22em] text-white/55 uppercase">Paython</p>
              <p className="text-sm text-white/45">Payment gateway</p>
            </div>
          </div>
          <h1 className="font-display mt-10 max-w-[18ch] text-4xl font-semibold leading-[1.08] tracking-tight text-white sm:text-5xl">
            Operations desk for your rails.
          </h1>
          <p className="mt-5 max-w-md text-sm leading-relaxed text-white/45">
            One console for admin oversight and merchant configuration — deposits, withdrawals, and API integration.
          </p>
        </div>
        <div className="relative mt-10 flex flex-wrap gap-6 border-t border-white/6 pt-8 text-xs text-white/35 lg:mt-0">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-white/35">Scope</p>
            <p className="mt-1 text-white/50">Multi-chain · multi-merchant</p>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-white/35">Access</p>
            <p className="mt-1 text-white/50">Role-based sessions</p>
          </div>
        </div>
      </section>

      <section className="flex flex-1 items-stretch justify-center px-4 py-8 sm:px-8 sm:py-12 lg:items-center lg:py-16">
        <div className="glass flex w-full max-w-md flex-col justify-center rounded-2xl p-8 sm:p-10">
          <div className="mb-8">
            <h2 className="font-display text-2xl font-semibold tracking-tight text-white">Sign in</h2>
            <p className="mt-2 text-sm text-white/45">Use your admin or merchant credentials.</p>
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
                setToken(r.token);
                nav(r.role === "ADMIN" ? "/admin" : "/m", { replace: true });
              } catch (e) {
                setStatus(String(e));
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {({ isSubmitting, status }) => (
              <Form className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-white/60" htmlFor="email">
                    Email
                  </label>
                  <Field
                    id="email"
                    name="email"
                    type="email"
                    className="w-full rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm text-white outline-none ring-white/20 focus:ring-2"
                    autoComplete="username"
                  />
                  <ErrorMessage name="email" component="p" className="mt-1 text-xs text-rose-400" />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-white/60" htmlFor="password">
                    Password
                  </label>
                  <Field
                    id="password"
                    name="password"
                    type="password"
                    className="w-full rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm text-white outline-none ring-white/20 focus:ring-2"
                    autoComplete="current-password"
                  />
                  <ErrorMessage name="password" component="p" className="mt-1 text-xs text-rose-400" />
                </div>
                {resetOk ? (
                  <p className="text-sm text-emerald-300/90">
                    Password updated. Sign in with your new password.
                  </p>
                ) : null}
                {status ? <p className="text-sm text-rose-400">{status}</p> : null}
                <p className="text-right text-sm">
                  <Link
                    to="/forgot-password"
                    className="text-white/50 underline-offset-2 hover:text-white/75 hover:underline"
                  >
                    Forgot password?
                  </Link>
                </p>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="btn-primary w-full rounded-xl py-3 text-sm"
                >
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
