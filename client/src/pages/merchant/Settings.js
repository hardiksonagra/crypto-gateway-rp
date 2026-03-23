import { useEffect, useState } from "react";
import { Formik, Form, Field, ErrorMessage } from "formik";
import { api } from "../../api";
import { merchantSettingsSchema } from "../../admin/merchantSchemas";
import ChainMultiSelectField from "../../components/ChainMultiSelectField";

export default function MerchantSettings() {
  const [boot, setBoot] = useState(null);

  useEffect(() => {
    api("/api/v1/auth/me").then((u) => {
      setBoot({
        callback_url: u.callbackUrl ?? "",
        default_chains:
          Array.isArray(u.defaultChains) && u.defaultChains.length > 0 ? u.defaultChains : ["TRON"],
      });
    });
  }, []);

  if (!boot) {
    return <p className="text-white/50">Loading…</p>;
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-white">Settings</h1>
      <p className="mt-1 text-sm text-white/50">
        Callback URL and default chain apply to{" "}
        <span className="font-mono text-cyan-300/80">POST /api/v1/gateway/deposit-address</span>.
      </p>

      <Formik
        enableReinitialize
        initialValues={boot}
        validationSchema={merchantSettingsSchema}
        validateOnBlur
        validateOnChange={false}
        onSubmit={async (values, { setStatus, setSubmitting }) => {
          setStatus(undefined);
          try {
            await api("/api/v1/merchant/settings", {
              method: "PATCH",
              json: {
                callback_url: values.callback_url?.trim() || null,
                default_chains: values.default_chains,
              },
            });
            setStatus("ok");
          } catch (err) {
            setStatus(String(err));
          } finally {
            setSubmitting(false);
          }
        }}
      >
        {({ isSubmitting, status }) => (
          <Form className="glass mt-8 max-w-xl space-y-4 rounded-2xl p-6">
            <div>
              <label className="text-xs text-white/50" htmlFor="callback_url">
                Webhook URL (payment.success)
              </label>
              <Field
                id="callback_url"
                name="callback_url"
                type="url"
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
                placeholder="https://your-api.example/hooks/crypto"
              />
              <ErrorMessage
                name="callback_url"
                component="p"
                className="mt-1 text-xs text-rose-400"
              />
            </div>
            <div>
              <span className="text-xs text-white/50">Default chains for new deposit addresses</span>
              <p className="mt-1 text-xs text-white/35">
                First selected chain is used when <span className="font-mono">chain</span> is omitted on deposit-address.
              </p>
              <div className="mt-2">
                <ChainMultiSelectField name="default_chains" />
              </div>
              <ErrorMessage name="default_chains" component="p" className="mt-1 text-xs text-rose-400" />
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-lg bg-violet-500/90 px-4 py-2 text-sm font-medium text-slate-950 disabled:opacity-50"
            >
              Save
            </button>
            {status === "ok" ? (
              <p className="text-sm text-emerald-300/90">Saved.</p>
            ) : status ? (
              <p className="text-sm text-rose-400">{status}</p>
            ) : null}
          </Form>
        )}
      </Formik>
    </div>
  );
}
