import { Formik, Form, Field, ErrorMessage } from "formik";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { resetPasswordSchema } from "../authSchemas";

const initial = { new_password: "", new_password_confirm: "" };

function mapResetError(msg) {
  if (msg === "invalid_or_expired_token")
    return "This reset link is invalid or has expired. Request a new one from the sign-in page.";
  if (msg === "new_password_too_short")
    return "Password must be at least 8 characters.";
  return msg;
}

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token")?.trim() ?? "";
  const navigate = useNavigate();

  if (!token) {
    return (
      <div className="mesh-bg flex min-h-screen items-center justify-center px-4 py-12">
        <div className="glass w-full max-w-md rounded-2xl p-8 sm:p-10 text-center">
          <h1 className="font-display text-xl font-semibold text-white">Invalid link</h1>
          <p className="mt-2 text-sm text-white/45">Missing reset token. Open the link from your email.</p>
          <Link
            to="/forgot-password"
            className="mt-6 inline-block text-sm text-white/70 underline-offset-2 hover:underline"
          >
            Request a new link
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mesh-bg flex min-h-screen items-center justify-center px-4 py-12">
      <div className="glass w-full max-w-md rounded-2xl p-8 sm:p-10">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-white">
          Set new password
        </h1>
        <p className="mt-2 text-sm text-white/45">Choose a new password for your account.</p>
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
            <Form className="mt-8 space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-white/60" htmlFor="new_password">
                  New password
                </label>
                <Field
                  id="new_password"
                  name="new_password"
                  type="password"
                  className="w-full rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm text-white outline-none ring-white/20 focus:ring-2"
                  autoComplete="new-password"
                />
                <ErrorMessage name="new_password" component="p" className="mt-1 text-xs text-rose-400" />
              </div>
              <div>
                <label
                  className="mb-1.5 block text-xs font-medium text-white/60"
                  htmlFor="new_password_confirm"
                >
                  Confirm password
                </label>
                <Field
                  id="new_password_confirm"
                  name="new_password_confirm"
                  type="password"
                  className="w-full rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm text-white outline-none ring-white/20 focus:ring-2"
                  autoComplete="new-password"
                />
                <ErrorMessage
                  name="new_password_confirm"
                  component="p"
                  className="mt-1 text-xs text-rose-400"
                />
              </div>
              {status ? <p className="text-sm text-rose-400">{status}</p> : null}
              <button
                type="submit"
                disabled={isSubmitting}
                className="btn-primary w-full rounded-xl py-3 text-sm"
              >
                {isSubmitting ? "Saving…" : "Save password"}
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
