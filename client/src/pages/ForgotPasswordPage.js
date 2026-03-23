import { Formik, Form, Field, ErrorMessage } from "formik";
import { Link } from "react-router-dom";
import { api } from "../api";
import { forgotPasswordSchema } from "../authSchemas";

const initial = { email: "" };

export default function ForgotPasswordPage() {
  return (
    <div className="mesh-bg flex min-h-screen items-center justify-center px-4 py-12">
      <div className="glass w-full max-w-md rounded-2xl p-8 sm:p-10">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-white">
          Forgot password
        </h1>
        <p className="mt-2 text-sm text-white/45">
          Enter your account email. If it exists, we will send a reset link.
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
            <Form className="mt-8 space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-white/60" htmlFor="email">
                  Email
                </label>
                <Field
                  id="email"
                  name="email"
                  type="email"
                  className="w-full rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm text-white outline-none ring-white/20 focus:ring-2"
                  autoComplete="email"
                />
                <ErrorMessage name="email" component="p" className="mt-1 text-xs text-rose-400" />
              </div>
              {status?.type === "ok" ? (
                <p className="text-sm text-emerald-300/90">{status.message}</p>
              ) : status?.type === "err" ? (
                <p className="text-sm text-rose-400">{status.message}</p>
              ) : null}
              <button
                type="submit"
                disabled={isSubmitting}
                className="btn-primary w-full rounded-xl py-3 text-sm"
              >
                {isSubmitting ? "Sending…" : "Send reset link"}
              </button>
              <p className="text-center text-sm text-white/45">
                <Link to="/login" className="text-white/70 underline-offset-2 hover:underline">
                  Back to sign in
                </Link>
              </p>
            </Form>
          )}
        </Formik>
      </div>
    </div>
  );
}
