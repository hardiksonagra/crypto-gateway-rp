import { Formik, Form, Field, ErrorMessage } from "formik";
import { useNavigate } from "react-router-dom";
import { api, setToken } from "../api";
import { loginSchema } from "../admin/merchantSchemas";

const initial = { email: "", password: "" };

export default function LoginPage() {
  const nav = useNavigate();

  return (
    <div className="mesh-bg flex min-h-screen items-center justify-center p-6">
      <div className="glow-border glass relative w-full max-w-md rounded-2xl p-8">
        <div className="mb-8 text-center">
          <p className="text-sm font-medium tracking-widest text-cyan-400/90 uppercase">Paython</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">Gateway console</h1>
          <p className="mt-2 text-sm text-white/50">Admin &amp; merchant operations in one place.</p>
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
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none ring-cyan-500/40 focus:ring-2"
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
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none ring-cyan-500/40 focus:ring-2"
                  autoComplete="current-password"
                />
                <ErrorMessage name="password" component="p" className="mt-1 text-xs text-rose-400" />
              </div>
              {status ? <p className="text-sm text-rose-400">{status}</p> : null}
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full rounded-xl bg-gradient-to-r from-cyan-500 to-violet-500 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-cyan-500/20 transition hover:opacity-95 disabled:opacity-50"
              >
                {isSubmitting ? "Signing in…" : "Sign in"}
              </button>
            </Form>
          )}
        </Formik>
      </div>
    </div>
  );
}
