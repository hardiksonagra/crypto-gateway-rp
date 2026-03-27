import { useEffect, useState } from "react";
import { Formik, Form, Field, ErrorMessage } from "formik";
import { api } from "../../api";
import { merchantSettingsSchema } from "../../admin/merchantSchemas";
import ChainMultiSelectField from "../../components/ChainMultiSelectField";
import DepositRailsMultiSelectField from "../../components/DepositRailsMultiSelectField";
import {
  depositRailsForChains,
  railKeyFromParts,
} from "../../admin/depositRailOptions.js";

export default function MerchantSettings() {
  const [boot, setBoot] = useState(null);
  const [gatewayModes, setGatewayModes] = useState(null);

  useEffect(() => {
    api("/api/v1/auth/me").then((u) => {
      const chainList =
        Array.isArray(u.defaultChains) && u.defaultChains.length > 0
          ? u.defaultChains
          : ["TRON"];
      const inferredRails = depositRailsForChains(chainList).map((o) => o.key);
      setBoot({
        callback_url: u.callbackUrl ?? "",
        default_chains: chainList,
        supported_deposit_rails:
          Array.isArray(u.supportedDepositRails) &&
          u.supportedDepositRails.length > 0
            ? u.supportedDepositRails
            : inferredRails.length > 0
              ? inferredRails
              : [railKeyFromParts(u.defaultCurrency, u.defaultNetwork)],
      });
      setGatewayModes({
        live: u.liveGatewayEnabled !== false,
        sandbox: u.sandboxGatewayEnabled !== false,
      });
    });
  }, []);

  if (!boot) {
    return <p className="text-white/50">Loading…</p>;
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-white">
        Gateway &amp; webhooks
      </h1>

      {gatewayModes ? (
        <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/70">
          <p className="text-[10px] font-semibold tracking-wide text-white/40 uppercase">Gateway modes</p>
          <p className="mt-2">
            <span className="text-white/45">Live</span> —{" "}
            {gatewayModes.live ? (
              <span className="text-emerald-300/90">enabled</span>
            ) : (
              <span className="text-rose-200/90">disabled</span>
            )}
            {" · "}
            <span className="text-white/45">Sandbox</span> —{" "}
            {gatewayModes.sandbox ? (
              <span className="text-emerald-300/90">enabled</span>
            ) : (
              <span className="text-rose-200/90">disabled</span>
            )}
          </p>
          <p className="mt-2 text-xs text-white/45">
            Admins change these on Edit merchant. Withdrawals require live gateway. Sandbox data is
            separate in the portal (Dashboard / Users / Transactions).
          </p>
        </div>
      ) : null}

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
                supported_deposit_rails: values.supported_deposit_rails,
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
          <Form className="glass mt-8 w-full grid grid-cols-1 gap-6 rounded-2xl p-6 lg:grid-cols-2 lg:p-8">
            <div className="lg:col-span-2">
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
            <div className="lg:col-span-2">
              <span className="text-xs text-white/50">Supported chains</span>
              <p className="mt-1 text-xs text-white/35">
                Deposit rails are only allowed if their chain is selected.
                Integrators pass <span className="font-mono">currency</span> +{" "}
                <span className="font-mono">network</span> per request.
              </p>
              <div className="mt-2">
                <ChainMultiSelectField name="default_chains" />
              </div>
              <ErrorMessage
                name="default_chains"
                component="p"
                className="mt-1 text-xs text-rose-400"
              />
            </div>
            <div className="lg:col-span-2">
              <span className="text-xs text-white/50">
                Supported currency / network
              </span>
              <p className="mt-1 text-xs text-white/35">
                Only these rails can be used on deposit-address (within the
                chains above).
              </p>
              <div className="mt-2">
                <DepositRailsMultiSelectField name="supported_deposit_rails" />
              </div>
              <p className="mt-1 text-xs text-white/35">
                First selected rail is the default when the client omits
                currency and network.
              </p>
              <ErrorMessage
                name="supported_deposit_rails"
                component="p"
                className="mt-1 text-xs text-rose-400"
              />
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="btn-primary rounded-lg px-4 py-2 text-sm lg:col-span-2"
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
