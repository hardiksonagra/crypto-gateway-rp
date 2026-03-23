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

/** Hidden state — password-style mask. */
const API_KEY_MASK = "***** ***** ***** *****";

function EyeIcon({ className }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className={className}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
      />
    </svg>
  );
}

function EyeSlashIcon({ className }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className={className}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"
      />
    </svg>
  );
}

export default function MerchantSettings() {
  const [boot, setBoot] = useState(null);
  const [apiKeyInfo, setApiKeyInfo] = useState(null);
  const [showApiKey, setShowApiKey] = useState(false);

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
      const secret =
        typeof u.apiKey === "string" && u.apiKey.trim()
          ? u.apiKey.trim()
          : null;
      const hint =
        typeof u.apiKeyHint === "string" && u.apiKeyHint.trim()
          ? u.apiKeyHint.trim()
          : null;
      setApiKeyInfo({ secret, hint });
    });
  }, []);

  if (!boot) {
    return <p className="text-white/50">Loading…</p>;
  }

  const keyRow = apiKeyInfo ?? { secret: null, hint: null };
  const apiKeyDisplayed = showApiKey
    ? (keyRow.secret ?? (keyRow.hint ? `****************${keyRow.hint}` : "—"))
    : API_KEY_MASK;

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-white">
        Gateway &amp; webhooks
      </h1>
      <p className="mt-1 text-sm text-white/50">
        Callback URL, supported chains, and deposit rails for{" "}
        <span className="font-mono text-white/55">
          POST /api/v1/gateway/deposit-address
        </span>
        .
      </p>

      <div className="glass mt-8 w-full rounded-2xl p-6 lg:p-8">
        <label
          className="text-xs text-white/50"
          htmlFor="merchant-api-key-display"
        >
          Merchant API key
        </label>
        <p className="mt-1 text-xs text-white/35">
          For server-side gateway calls only. Also shown on the Doc page.
          Regenerate in the admin portal if it leaks.
        </p>
        <div className="mt-2 flex items-stretch gap-2">
          <div
            id="merchant-api-key-display"
            className="min-h-[42px] flex-1 select-all rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-white/70 break-all content-center"
          >
            {apiKeyDisplayed}
          </div>
          <button
            type="button"
            onClick={() => setShowApiKey((v) => !v)}
            className="flex w-11 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-black/30 text-white/55 transition hover:border-white/20 hover:bg-white/5 hover:text-white"
            aria-label={showApiKey ? "Hide API key" : "Show API key"}
            title={showApiKey ? "Hide" : "Show"}
          >
            {showApiKey ? (
              <EyeSlashIcon className="h-5 w-5" />
            ) : (
              <EyeIcon className="h-5 w-5" />
            )}
          </button>
        </div>
        {showApiKey && !keyRow.secret && keyRow.hint ? (
          <p className="mt-2 text-xs text-amber-200/80">
            Full key is not stored for this screen yet. Value ends with your
            hint; ask an admin to regenerate once to save the encrypted key, or
            use the secret from when the key was issued.
          </p>
        ) : null}
        {showApiKey && !keyRow.secret && !keyRow.hint ? (
          <p className="mt-2 text-xs text-amber-200/80">
            No API key on file. Ask an admin to create a merchant API key.
          </p>
        ) : null}
      </div>

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
