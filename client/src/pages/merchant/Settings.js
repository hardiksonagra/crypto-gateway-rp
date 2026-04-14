import { useEffect, useMemo, useState } from "react";
import { Formik, Form, Field, ErrorMessage } from "formik";
import { api } from "../../api";
import { buildMerchantSettingsSchema } from "../../admin/merchantSchemas";
import ChainMultiSelectField from "../../components/ChainMultiSelectField";
import DepositRailsMultiSelectField from "../../components/DepositRailsMultiSelectField";
import { BrandLoader } from "../../components/BrandLoader.js";
import {
  depositRailsForChains,
  MERCHANT_PRODUCT_CHAIN_CODES,
  railKeyFromParts,
} from "../../admin/depositRailOptions.js";

/**
 * @param {object} u `/api/v1/auth/me` merchant JSON
 */
function buildGatewaySettingsBoot(u) {
  const platform =
    Array.isArray(u.platform_enabled_chains) && u.platform_enabled_chains.length > 0
      ? u.platform_enabled_chains
      : [...MERCHANT_PRODUCT_CHAIN_CODES];

  let chainList =
    Array.isArray(u.defaultChains) && u.defaultChains.length > 0 ? u.defaultChains : ["TRON"];
  chainList = chainList.filter((c) => platform.includes(c));
  if (chainList.length === 0) {
    chainList = platform.slice(0, 1);
  }

  const railOptions = depositRailsForChains(chainList, platform, true);
  const allowedRailKeys = new Set(railOptions.map((o) => o.key));
  const inferredRails = railOptions.map((o) => o.key);

  let rails =
    Array.isArray(u.supportedDepositRails) && u.supportedDepositRails.length > 0
      ? u.supportedDepositRails
      : inferredRails.length > 0
        ? inferredRails
        : [railKeyFromParts(u.defaultCurrency, u.defaultNetwork)];
  rails = rails.filter((k) => allowedRailKeys.has(k));
  if (rails.length === 0 && inferredRails.length > 0) {
    rails = [inferredRails[0]];
  }

  return {
    platform_enabled_chains: platform,
    callback_url: u.callbackUrl ?? "",
    default_chains: chainList,
    supported_deposit_rails: rails,
  };
}

export default function MerchantSettings() {
  const [boot, setBoot] = useState(null);
  const [gatewayModes, setGatewayModes] = useState(null);

  useEffect(() => {
    api("/api/v1/auth/me").then((u) => {
      setBoot(buildGatewaySettingsBoot(u));
      setGatewayModes({
        live: u.liveGatewayEnabled !== false,
        sandbox: u.sandboxGatewayEnabled !== false,
      });
    });
  }, []);

  const validationSchema = useMemo(
    () => buildMerchantSettingsSchema(boot?.platform_enabled_chains, true),
    [boot],
  );

  if (!boot) {
    return (
      <BrandLoader
        variant="section"
        title=""
        subtitle="Loading settings…"
        aria-label="Loading gateway settings"
      />
    );
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
            Admins change these on Edit merchant. Live gateway controls production API and portal data. Sandbox data is
            separate in the portal (Dashboard / Users / Transactions).
          </p>
        </div>
      ) : null}

      <Formik
        enableReinitialize
        initialValues={boot}
        validationSchema={validationSchema}
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
              <p className="mt-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white/75">
                <span className="font-semibold text-white/90">Active chain list</span> (set in Admin → Supported
                chains):{" "}
                <span className="font-mono text-emerald-200/95">
                  {boot.platform_enabled_chains?.length
                    ? boot.platform_enabled_chains.join(", ")
                    : "—"}
                </span>
              </p>
              <p className="mt-2 text-xs text-white/35">
                You can only turn on chains from that list below. Deposit rails must match a selected chain.
                Integrators pass <span className="font-mono">currency</span> +{" "}
                <span className="font-mono">network</span> per request.
              </p>
              <div className="mt-2">
                <ChainMultiSelectField
                  name="default_chains"
                  allowedChainValues={boot.platform_enabled_chains}
                />
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
                <DepositRailsMultiSelectField
                  name="supported_deposit_rails"
                  platformEnabledChains={boot.platform_enabled_chains}
                  useFullProductCatalog
                />
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
