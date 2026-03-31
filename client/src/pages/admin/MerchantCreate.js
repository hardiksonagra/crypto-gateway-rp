import { Formik, Form, Field, ErrorMessage } from "formik";
import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { api } from "../../api";
import { merchantCreateSchema } from "../../admin/merchantSchemas";
import ChainMultiSelectField from "../../components/ChainMultiSelectField";
import DepositRailsMultiSelectField from "../../components/DepositRailsMultiSelectField";

const input =
  "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-white/20 focus:ring-1";
const label = "mb-1 block text-xs font-medium text-white/60";

const initial = {
  email: "",
  password: "",
  display_name: "",
  default_chains: ["TRON"],
  supported_deposit_rails: ["USDT|TRC20"],
  callback_url: "",
  live_gateway_enabled: true,
  sandbox_gateway_enabled: true,
};

export default function MerchantCreate() {
  const nav = useNavigate();
  const [secretModal, setSecretModal] = useState(null);

  return (
    <div className="w-full max-w-none">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Link
          to="/control/merchants"
          className="text-sm text-white/50 hover:text-white"
        >
          ← Merchants
        </Link>
      </div>
      <h1 className="font-display text-2xl font-semibold text-white">Create merchant</h1>

      <div className="glass mt-8 w-full rounded-2xl p-6 lg:p-8">
        <Formik
          initialValues={initial}
          validationSchema={merchantCreateSchema}
          validateOnBlur
          validateOnChange={false}
          onSubmit={async (values, { setStatus, setSubmitting }) => {
            setStatus(undefined);
            try {
              const r = await api("/api/v1/admin/merchants", {
                method: "POST",
                json: {
                  email: values.email.trim().toLowerCase(),
                  password: values.password?.trim() || undefined,
                  display_name: values.display_name?.trim() || undefined,
                  default_chains: values.default_chains,
                  supported_deposit_rails: values.supported_deposit_rails,
                  callback_url: values.callback_url?.trim() || undefined,
                  live_gateway_enabled: values.live_gateway_enabled,
                  sandbox_gateway_enabled: values.sandbox_gateway_enabled,
                },
              });
              setSecretModal({
                api_key: r.api_key,
                sandbox_api_key: r.sandbox_api_key,
                temporary_password: r.temporary_password,
              });
            } catch (e) {
              setStatus(String(e));
            } finally {
              setSubmitting(false);
            }
          }}
        >
          {({ isSubmitting, status }) => (
            <Form className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div>
                <label className={label} htmlFor="email">
                  Email
                </label>
                <Field
                  id="email"
                  name="email"
                  type="email"
                  className={input}
                  autoComplete="off"
                />
                <ErrorMessage
                  name="email"
                  component="p"
                  className="mt-1 text-xs text-rose-400"
                />
              </div>
              <div>
                <label className={label} htmlFor="password">
                  Password (optional — auto-generated if empty)
                </label>
                <Field
                  id="password"
                  name="password"
                  type="password"
                  className={input}
                  autoComplete="new-password"
                />
                <ErrorMessage
                  name="password"
                  component="p"
                  className="mt-1 text-xs text-rose-400"
                />
              </div>
              <div>
                <label className={label} htmlFor="display_name">
                  Display name
                </label>
                <Field
                  id="display_name"
                  name="display_name"
                  type="text"
                  className={input}
                />
                <ErrorMessage
                  name="display_name"
                  component="p"
                  className="mt-1 text-xs text-rose-400"
                />
              </div>
              <div className="lg:col-span-2">
                <span className={label}>Supported chains</span>
                <p className="mb-2 text-xs text-white/40">
                  The gateway only issues addresses for rails whose underlying
                  chain is selected here.
                </p>
                <ChainMultiSelectField name="default_chains" />
                <ErrorMessage
                  name="default_chains"
                  component="p"
                  className="mt-1 text-xs text-rose-400"
                />
              </div>
              <div className="lg:col-span-2">
                <span className={label}>Supported currency / network</span>
                <p className="mb-2 text-xs text-white/40">
                  Integrators may only use these rails (within the chains above).
                </p>
                <DepositRailsMultiSelectField name="supported_deposit_rails" />
                <p className="mt-1 text-xs text-white/35">
                  When the client omits <span className="font-mono">currency</span> and{" "}
                  <span className="font-mono">network</span> on{" "}
                  <span className="font-mono">POST /api/v1/gateway/deposit-address</span>, the{" "}
                  <strong className="text-white/50">first</strong> rail selected above is used.
                </p>
                <ErrorMessage
                  name="supported_deposit_rails"
                  component="p"
                  className="mt-1 text-xs text-rose-400"
                />
              </div>
              <div className="lg:col-span-2">
                <label className={label} htmlFor="callback_url">
                  Callback URL
                </label>
                <Field
                  id="callback_url"
                  name="callback_url"
                  type="url"
                  className={input}
                  placeholder="https://…"
                />
                <ErrorMessage
                  name="callback_url"
                  component="p"
                  className="mt-1 text-xs text-rose-400"
                />
              </div>
              <div className="flex items-end pb-1">
                <label className={`${label} flex items-center gap-2`}>
                  <Field type="checkbox" name="live_gateway_enabled" className="rounded border-white/20" />
                  Live gateway enabled
                </label>
              </div>
              <div className="flex items-end pb-1">
                <label className={`${label} flex items-center gap-2`}>
                  <Field type="checkbox" name="sandbox_gateway_enabled" className="rounded border-white/20" />
                  Sandbox gateway enabled
                </label>
              </div>
              {status ? (
                <p className="text-sm text-rose-400 lg:col-span-2">{status}</p>
              ) : null}
              <div className="flex flex-wrap gap-3 pt-2 lg:col-span-2">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="btn-primary rounded-lg px-4 py-2 text-sm"
                >
                  {isSubmitting ? "Creating…" : "Create merchant"}
                </button>
                <Link
                  to="/control/merchants"
                  className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/70"
                >
                  Cancel
                </Link>
              </div>
            </Form>
          )}
        </Formik>
      </div>

      {secretModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="glass w-full max-w-lg rounded-2xl p-6">
            <h3 className="text-lg font-semibold text-white">
              Save these credentials
            </h3>
            <p className="mt-2 text-sm text-amber-200/90">
              They are not shown again.
            </p>
            {secretModal.api_key || secretModal.sandbox_api_key ? (
              <div className="mt-3">
                <p className="text-[10px] font-semibold tracking-wide text-white/40 uppercase">
                  Gateway API key (live + sandbox)
                </p>
                <p className="mt-1 break-all font-mono text-xs text-white/55">
                  {secretModal.api_key ?? secretModal.sandbox_api_key}
                </p>
              </div>
            ) : null}
            {secretModal.temporary_password ? (
              <p className="mt-2 font-mono text-sm text-amber-200">
                Password: {secretModal.temporary_password}
              </p>
            ) : null}
            <button
              type="button"
              className="mt-6 rounded-lg bg-white/10 px-4 py-2 text-sm text-white"
              onClick={() => {
                setSecretModal(null);
                nav("/control/merchants");
              }}
            >
              Done
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
