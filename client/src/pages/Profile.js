import { useEffect, useState } from "react";
import { Formik, Form, Field, ErrorMessage } from "formik";
import { api } from "../api";
import { changePasswordSchema } from "../authSchemas";
import MerchantPortalEnvBar from "../components/MerchantPortalEnvBar.js";
import { useMerchantPortalEnvironment } from "../hooks/useMerchantPortalEnvironment.js";

const passwordInitial = {
  current_password: "",
  new_password: "",
  new_password_confirm: "",
};

function mapPasswordError(msg) {
  if (msg === "current_password_invalid") return "Current password is incorrect.";
  if (msg === "new_password_too_short")
    return "New password must be at least 8 characters.";
  return msg;
}

function MerchantProfilePortalSection() {
  const {
    environment,
    liveGatewayEnabled,
    sandboxGatewayEnabled,
    flagsLoading,
  } = useMerchantPortalEnvironment();

  if (flagsLoading) {
    return (
      <div className="glass mt-8 w-full rounded-2xl p-6 lg:p-8">
        <h2 className="font-display text-lg font-semibold text-white">Portal environment</h2>
        <p className="mt-2 text-sm text-white/45">Loading…</p>
      </div>
    );
  }

  if (!liveGatewayEnabled && !sandboxGatewayEnabled) {
    return (
      <div className="glass mt-8 w-full rounded-2xl p-6 lg:p-8">
        <h2 className="font-display text-lg font-semibold text-white">Portal environment</h2>
        <p className="mt-2 text-sm text-rose-200/90">
          Neither live nor sandbox gateway is enabled for your account. Contact support.
        </p>
      </div>
    );
  }

  return (
    <div className="glass mt-8 w-full rounded-2xl p-6 lg:p-8">
      <h2 className="font-display text-lg font-semibold text-white">Portal environment</h2>
      <p className="mt-1 text-sm text-white/45">
        Saved on your account: Dashboard, Users, and Transactions follow Live or Sandbox. Your live and
        sandbox API keys are unchanged. Withdrawals are available in Live only.
      </p>
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <p className="text-xs text-white/50">Data mode</p>
          <MerchantPortalEnvBar className="mt-2" />
        </div>
        {environment === "sandbox" ? (
          <p className="text-sm text-amber-200/90 lg:col-span-2">
            You are in sandbox mode. To use live production data and withdrawals, switch to Live above.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function AdminProfilePortalSection() {
  const { environment, flagsLoading } = useMerchantPortalEnvironment();

  if (flagsLoading) {
    return (
      <div className="glass mt-8 w-full rounded-2xl p-6 lg:p-8">
        <h2 className="font-display text-lg font-semibold text-white">Admin data scope</h2>
        <p className="mt-2 text-sm text-white/45">Loading…</p>
      </div>
    );
  }

  return (
    <div className="glass mt-8 w-full rounded-2xl p-6 lg:p-8">
      <h2 className="font-display text-lg font-semibold text-white">Admin data scope</h2>
      <p className="mt-1 text-sm text-white/45">
        Saved on your account: the global <span className="text-white/60">Users</span> and{" "}
        <span className="text-white/60">Transactions</span> pages list only{" "}
        <span className="text-white/60">live</span> or <span className="text-white/60">sandbox</span>{" "}
        end-user data, matching your choice below.
      </p>
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <p className="text-xs text-white/50">List data mode</p>
          <MerchantPortalEnvBar className="mt-2" />
        </div>
        {environment === "sandbox" ? (
          <p className="text-sm text-amber-200/90 lg:col-span-2">
            You are viewing <span className="font-medium text-white">sandbox</span> data only. Switch to
            Live above to see production gateway users and transactions.
          </p>
        ) : null}
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
    return <p className="text-white/50">Loading…</p>;
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-white">Profile</h1>
      <p className="mt-1 text-sm text-white/50">
        Signed in as <span className="text-white/70">{me.email}</span>
        {me.displayName ? (
          <>
            {" "}
            · <span className="text-white/70">{me.displayName}</span>
          </>
        ) : null}
      </p>

      {me.role === "MERCHANT" ? <MerchantProfilePortalSection /> : null}
      {me.role === "ADMIN" ? <AdminProfilePortalSection /> : null}

      <div className="glass mt-8 w-full rounded-2xl p-6 lg:p-8">
        <h2 className="font-display text-lg font-semibold text-white">Change password</h2>
        <p className="mt-1 text-sm text-white/45">
          Use your current password, then choose a new one (at least 8 characters).
        </p>
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
                json: {
                  current_password: values.current_password,
                  new_password: values.new_password,
                },
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
            <Form className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="lg:col-span-2">
                <label className="text-xs text-white/50" htmlFor="current_password">
                  Current password
                </label>
                <Field
                  id="current_password"
                  name="current_password"
                  type="password"
                  autoComplete="current-password"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                />
                <ErrorMessage
                  name="current_password"
                  component="p"
                  className="mt-1 text-xs text-rose-400"
                />
              </div>
              <div>
                <label className="text-xs text-white/50" htmlFor="new_password">
                  New password
                </label>
                <Field
                  id="new_password"
                  name="new_password"
                  type="password"
                  autoComplete="new-password"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                />
                <ErrorMessage
                  name="new_password"
                  component="p"
                  className="mt-1 text-xs text-rose-400"
                />
              </div>
              <div>
                <label className="text-xs text-white/50" htmlFor="new_password_confirm">
                  Confirm new password
                </label>
                <Field
                  id="new_password_confirm"
                  name="new_password_confirm"
                  type="password"
                  autoComplete="new-password"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                />
                <ErrorMessage
                  name="new_password_confirm"
                  component="p"
                  className="mt-1 text-xs text-rose-400"
                />
              </div>
              <div className="flex flex-wrap items-center gap-4 lg:col-span-2">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="btn-primary rounded-lg px-4 py-2 text-sm"
                >
                  {isSubmitting ? "Updating…" : "Update password"}
                </button>
                {status === "ok" ? (
                  <p className="text-sm text-emerald-300/90">Password updated.</p>
                ) : status ? (
                  <p className="text-sm text-rose-400">{status}</p>
                ) : null}
              </div>
            </Form>
          )}
        </Formik>
      </div>
    </div>
  );
}
