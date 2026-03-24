/**
 * In-app reference for integrators: `/api/v1/gateway/*` and webhooks.
 * Kept in sync with server gateway-routes, callback-service, and unified gateway key behaviour.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import {
  depositRailsForChains,
  railKeyFromParts,
  splitRailKey,
} from "../../admin/depositRailOptions.js";

const API_EXAMPLE_BASE =
  String(import.meta.env.VITE_API_ORIGIN ?? "").replace(/\/$/, "") ||
  "(your API origin)";

/** When set, simulate-deposit copy buttons use this origin (dedicated sandbox stack). */
const SANDBOX_DOC_BASE = String(
  import.meta.env.VITE_GATEWAY_DOCS_SANDBOX_ORIGIN ?? "",
).replace(/\/$/, "");

/** Shared style for copy actions in this page */
const COPY_BTN_CLASS =
  "shrink-0 rounded-md border border-white/15 bg-white/5 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-white/70 transition hover:bg-white/10 hover:text-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/25";

/**
 * Path like `/api/v1/gateway/foo` → full URL when `VITE_API_ORIGIN` is set, else path only.
 * @param {string} path
 * @returns {string}
 */
function gatewayEndpointClipboardText(path) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const base = String(API_EXAMPLE_BASE ?? "").trim();
  if (!base || base === "(your API origin)") return normalized;
  return `${base.replace(/\/$/, "")}${normalized}`;
}

/**
 * Full URL for docs copy — optional separate sandbox API host for this path only.
 * @param {string} path
 * @returns {string}
 */
function gatewaySandboxDocClipboardText(path) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (SANDBOX_DOC_BASE) return `${SANDBOX_DOC_BASE}${normalized}`;
  return gatewayEndpointClipboardText(path);
}

/**
 * @param {{ textToCopy: string, children: import("react").ReactNode }} props
 */
function InlineCopyButton({ textToCopy }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={COPY_BTN_CLASS}
      aria-label={copied ? "Copied" : "Copy endpoint URL"}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/**
 * Endpoint title row: method + path/URL with copy (clipboard gets full gateway URL when origin is configured).
 * @param {{ textToCopy: string, children: import("react").ReactNode, breakAll?: boolean }} props
 */
function EndpointRow({ textToCopy, children, breakAll }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <p
        className={`min-w-0 flex-1 font-mono text-sm text-white/60 ${breakAll ? "break-all" : ""}`}
      >
        {children}
      </p>
      <InlineCopyButton textToCopy={textToCopy} />
    </div>
  );
}

/**
 * Same rail keys as the Gateway & webhooks form (`Settings.js`).
 * @param {object} u - `/api/v1/auth/me` JSON
 * @returns {string[]}
 */
function effectiveMerchantRailKeys(u) {
  const chainList =
    Array.isArray(u.defaultChains) && u.defaultChains.length > 0
      ? u.defaultChains
      : ["TRON"];
  const inferredRails = depositRailsForChains(chainList).map((o) => o.key);
  if (
    Array.isArray(u.supportedDepositRails) &&
    u.supportedDepositRails.length > 0
  ) {
    return u.supportedDepositRails;
  }
  if (inferredRails.length > 0) return inferredRails;
  return [railKeyFromParts(u.defaultCurrency, u.defaultNetwork)];
}

/**
 * @param {string} key
 * @returns {{ currency: string, network: string }}
 */
function rowForRailKey(key) {
  return splitRailKey(key);
}

/** Mask length in doc examples (prefix before `api_key_hint`). */
const DOC_API_KEY_MASK_PREFIX = "****************";

/**
 * Doc examples: masked prefix + `api_key_hint` (e.g. `****************2f8e36`). Live calls need the full secret.
 * @param {string | null | undefined} hint - from `auth/me` `apiKeyHint`
 * @returns {string} JSON fragment for embedding in example body
 */
function gatewayApiKeyJsonLiteral(hint) {
  const t = typeof hint === "string" ? hint.trim() : "";
  if (t) return JSON.stringify(`${DOC_API_KEY_MASK_PREFIX}${t}`);
  return JSON.stringify("<merchant_api_key>");
}

/**
 * Code block with copy-to-clipboard (copies rendered text, including interpolated examples).
 * @param {{ children: import("react").ReactNode, breakAll?: boolean }} props
 */
function Pre({ children, breakAll }) {
  const preRef = useRef(null);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const el = preRef.current;
    if (!el) return;
    const text = el.textContent ?? "";
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore — permission or unsupported */
    }
  };

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-white/10 bg-black/40">
      <div className="flex items-center justify-end border-b border-white/10 bg-black/30 px-2 py-1.5">
        <button
          type="button"
          onClick={handleCopy}
          className={COPY_BTN_CLASS}
          aria-label={copied ? "Copied" : "Copy code to clipboard"}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre
        ref={preRef}
        className={`overflow-x-auto p-4 text-xs leading-relaxed text-zinc-200/90 ${breakAll ? "break-all whitespace-pre-wrap" : ""}`}
      >
        {children}
      </pre>
    </div>
  );
}

export default function GatewayApiDocs() {
  const [railRows, setRailRows] = useState(null);
  const [apiKeyHint, setApiKeyHint] = useState(null);
  const [hasSandboxApiKey, setHasSandboxApiKey] = useState(false);
  /** Saved webhook URL from portal (`callbackUrl`); null if unset or not loaded yet */
  const [merchantCallbackUrl, setMerchantCallbackUrl] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api("/api/v1/auth/me")
      .then((u) => {
        if (cancelled) return;
        const keys = effectiveMerchantRailKeys(u);
        setRailRows(keys.map(rowForRailKey));
        const h = u.apiKeyHint;
        setApiKeyHint(typeof h === "string" && h.trim() ? h.trim() : null);
        setHasSandboxApiKey(Boolean(u.hasSandboxApiKey));
        const cb = u.callbackUrl;
        setMerchantCallbackUrl(
          typeof cb === "string" && cb.trim() ? cb.trim() : null,
        );
      })
      .catch(() => {
        if (!cancelled) {
          setRailRows([]);
          setApiKeyHint(null);
          setHasSandboxApiKey(false);
          setMerchantCallbackUrl(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const webhookPostUrl =
    typeof merchantCallbackUrl === "string" && merchantCallbackUrl.trim()
      ? merchantCallbackUrl.trim()
      : "{your_callback_url}";

  return (
    <div className="w-full space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold text-white">Gateway API docs</h1>
        <p className="mt-2 text-xs text-white/40">
          Example base URL for this environment:{" "}
          <span className="font-mono text-white/60">{API_EXAMPLE_BASE}</span>
          {SANDBOX_DOC_BASE ? (
            <>
              {" "}
              · Sandbox doc URL (simulate-deposit copies):{" "}
              <span className="font-mono text-white/60">{SANDBOX_DOC_BASE}</span>
            </>
          ) : null}
        </p>
        <p className="mt-3 text-sm text-white/55">
          POST bodies use <span className="font-mono">Content-Type: application/json</span> and{" "}
          <span className="font-mono">api_key</span>. If you use one secret for both live and sandbox,
          the gateway picks <span className="font-mono">live</span> vs{" "}
          <span className="font-mono">sandbox</span> from your portal environment (Settings); you can
          still send optional <span className="font-mono">gateway_environment</span> to override.
          Your merchant secret is only on the{" "}
          <Link
            to="/m/api-key"
            className="text-sky-300/90 underline decoration-white/20 underline-offset-2 hover:decoration-sky-300/60"
          >
            API key
          </Link>{" "}
          page — not repeated here.
        </p>
      </div>

      <section className="glass w-full rounded-2xl p-6 lg:p-8">
        <h2 className="text-lg font-semibold text-white">Supported Currency</h2>
        <div className="mt-4">
          {railRows === null ? (
            <p className="text-sm text-white/45">Loading…</p>
          ) : railRows.length === 0 ? (
            <p className="text-sm text-white/45">No pairs to show.</p>
          ) : (
            <div className="data-table-surface">
              <table className="data-table font-mono text-xs">
                <thead>
                  <tr>
                    <th>currency</th>
                    <th>network</th>
                  </tr>
                </thead>
                <tbody>
                  {railRows.map((row) => (
                    <tr key={`${row.currency}|${row.network}`}>
                      <td>{row.currency}</td>
                      <td>{row.network}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="glass w-full rounded-2xl p-6 lg:p-8">
        <h2 className="text-lg font-semibold text-white">
          List supported currency options
        </h2>
        <EndpointRow
          textToCopy={gatewayEndpointClipboardText(
            "/api/v1/gateway/supported-currency",
          )}
        >
          <span className="text-white/55">POST</span>{" "}
          /api/v1/gateway/supported-currency
        </EndpointRow>
        <p className="mt-3 text-sm text-white/55">
          Returns every <span className="font-mono">currency</span> +{" "}
          <span className="font-mono">network</span> pair your merchant can use
          on the gateway, in order (same rules as the table above — use it to
          build checkout dropdowns on your backend).
        </p>
        <p className="mt-3 text-xs font-medium text-white/45">Body</p>
        <ul className="mt-1 list-inside list-disc text-sm text-white/55">
          <li>
            <span className="font-mono text-white/60">api_key</span>{" "}
            (required)
          </li>
          <li>
            <span className="font-mono text-white/60">gateway_environment</span>{" "}
            (optional) — override; otherwise matches portal Live/Sandbox
          </li>
        </ul>
        <Pre>{`POST /api/v1/gateway/supported-currency
Content-Type: application/json

{
  "api_key": ${gatewayApiKeyJsonLiteral(apiKeyHint)}
}`}</Pre>
        <p className="mt-4 text-xs font-medium text-white/45">200 response</p>
        <Pre>{`{
  "pairs": [
    { "currency": "USDT", "network": "TRC20", "chain": "TRON" }
  ],
  "default_currency": "USDT",
  "default_network": "TRC20"
}`}</Pre>
        <p className="mt-4 text-xs text-white/45">
          <span className="font-mono">401 invalid_api_key</span> if the key is
          invalid or the merchant account is inactive.
        </p>
      </section>

      <section className="glass w-full rounded-2xl p-6 lg:p-8">
        <h2 className="text-lg font-semibold text-white">
          Get or create deposit address
        </h2>
        <EndpointRow
          textToCopy={gatewayEndpointClipboardText(
            "/api/v1/gateway/deposit-address",
          )}
        >
          <span className="text-white/55">POST</span>{" "}
          /api/v1/gateway/deposit-address
        </EndpointRow>
        <p className="mt-3 text-sm text-white/55">
          Get or create a deposit wallet for an end user. Same merchant +{" "}
          <span className="font-mono">external_user_id</span> + same{" "}
          <span className="font-mono">currency</span>/
          <span className="font-mono">network</span> returns the same address.
        </p>
        <p className="mt-3 text-xs font-medium text-white/45">Body</p>
        <ul className="mt-1 list-inside list-disc text-sm text-white/55">
          <li>
            <span className="font-mono text-white/60">api_key</span>{" "}
            (required)
          </li>
          <li>
            <span className="font-mono text-white/60">gateway_environment</span>{" "}
            (optional) — override; otherwise matches portal Live/Sandbox
          </li>
          <li>
            <span className="font-mono text-white/60">
              external_user_id
            </span>{" "}
            (required) — your user id
          </li>
          <li>
            <span className="font-mono text-white/60">currency</span>,{" "}
            <span className="font-mono text-white/60">network</span>{" "}
            (optional — default pair if omitted)
          </li>
        </ul>
        <Pre>{`POST /api/v1/gateway/deposit-address
Content-Type: application/json

{
  "api_key": ${gatewayApiKeyJsonLiteral(apiKeyHint)},
  "external_user_id": "user-123",
  "currency": "USDT",
  "network": "TRC20"
}`}</Pre>
        <p className="mt-4 text-xs font-medium text-white/45">200 response</p>
        <Pre>{`{
  "address": "T… or 0x…",
  "chain": "TRON",
  "currency": "USDT",
  "network": "TRC20",
  "wallet_id": "…",
  "user_id": "…",
  "merchant_id": "…",
  "created_new_user": false
}`}</Pre>
        <p className="mt-4 text-xs text-white/45">
          Errors: <span className="font-mono">400</span> missing fields or{" "}
          <span className="font-mono">unsupported_currency_network</span>;{" "}
          <span className="font-mono">401 invalid_api_key</span>;{" "}
          <span className="font-mono">403 rail_not_enabled_for_merchant</span>;{" "}
          <span className="font-mono">
            500 merchant_default_pair_misconfigured
          </span>{" "}
          if defaults are missing.
        </p>
      </section>

      <section className="glass w-full rounded-2xl p-6 lg:p-8">
        <h2 className="text-lg font-semibold text-white">
          Sandbox: simulate deposit (merchant testing)
        </h2>
        <p className="mt-2 text-sm text-white/55">
          Creates a synthetic <span className="font-mono">success</span>{" "}
          transaction and sends the same{" "}
          <span className="font-mono">payment.success</span> webhook as a real
          confirmed deposit — so your backend can test parsing and idempotency
          without sending crypto. Use the same <span className="font-mono">api_key</span>{" "}
          as other gateway calls; this route always targets sandbox data. First
          get a sandbox <span className="font-mono">wallet_id</span> from{" "}
          <span className="font-mono">deposit-address</span> (portal set to Sandbox, or optional{" "}
          <span className="font-mono">gateway_environment: "sandbox"</span> if portal is Live).
        </p>
        {!hasSandboxApiKey && railRows !== null ? (
          <p className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-100/90">
            No gateway API key on file yet. Ask your admin to create the merchant
            or regenerate the gateway API key once.
          </p>
        ) : null}
        <EndpointRow
          textToCopy={gatewaySandboxDocClipboardText(
            "/api/v1/gateway/sandbox/simulate-deposit",
          )}
        >
          <span className="text-white/55">POST</span>{" "}
          /api/v1/gateway/sandbox/simulate-deposit
        </EndpointRow>
        <p className="mt-3 text-xs font-medium text-white/45">Body</p>
        <ul className="mt-1 list-inside list-disc text-sm text-white/55">
          <li>
            <span className="font-mono text-white/60">api_key</span> — same
            merchant secret as live
          </li>
          <li>
            <span className="font-mono text-white/60">wallet_id</span> — from{" "}
            <span className="font-mono">deposit-address</span> for a sandbox user (portal Sandbox or
            body override)
          </li>
          <li>
            <span className="font-mono text-white/60">amount</span> — optional,
            string of integer smallest units; omit for one whole unit (e.g.{" "}
            <span className="font-mono">1000000</span> for 1 USDT)
          </li>
        </ul>
        <Pre>{`POST /api/v1/gateway/sandbox/simulate-deposit
Content-Type: application/json

{
  "api_key": ${gatewayApiKeyJsonLiteral(apiKeyHint)},
  "wallet_id": "<from_deposit_address_response>",
  "amount": "1000000"
}`}</Pre>
        <p className="mt-4 text-xs font-medium text-white/45">200 response</p>
        <Pre>{`{
  "transaction_id": "…",
  "tx_hash": "sandbox_…",
  "amount": "1000000",
  "token_symbol": "USDT",
  "wallet_id": "…"
}`}</Pre>
        <p className="mt-4 text-xs text-white/45">
          <span className="font-mono">403 sandbox_api_key_required</span> only if
          your account still has a separate live-only secret (legacy);{" "}
          <span className="font-mono">404 wallet_not_found</span> if the wallet is
          not yours or not in sandbox.
        </p>
      </section>

      <section className="glass w-full rounded-2xl p-6 lg:p-8">
        <h2 className="text-lg font-semibold text-white">
          List transactions by deposit address
        </h2>
        <EndpointRow
          textToCopy={gatewayEndpointClipboardText(
            "/api/v1/gateway/transactions",
          )}
        >
          <span className="text-sky-300/90">GET</span>{" "}
          /api/v1/gateway/transactions
        </EndpointRow>
        <p className="mt-3 text-sm text-white/55">
          Query by deposit address. Optional{" "}
          <span className="font-mono">currency</span> and{" "}
          <span className="font-mono">network</span> query params filter only
          when both are provided. Returns up to 200 rows, newest first. Amounts
          are in smallest units — use{" "}
          <span className="font-mono">token_decimals</span> for display.
        </p>
        <Pre>{`GET /api/v1/gateway/transactions?address=TExampleAddress…
GET /api/v1/gateway/transactions?address=0x…&currency=USDT&network=ERC20`}</Pre>
        <p className="mt-4 text-xs font-medium text-white/45">
          200 response (shape)
        </p>
        <Pre>{`{
  "transactions": [
    {
      "id": "…",
      "tx_hash": "…",
      "from_address": "…",
      "to_address": "…",
      "amount": "…",
      "token_symbol": "…",
      "token_decimals": 6,
      "chain": "TRON",
      "currency": "USDT",
      "network": "TRC20",
      "status": "success",
      "confirmations": 20,
      "block_number": "…",
      "created_at": "…",
      "updated_at": "…"
    }
  ]
}`}</Pre>
      </section>

      <section className="glass w-full rounded-2xl p-6 lg:p-8">
        <h2 className="text-lg font-semibold text-white">
          Payment success webhook
        </h2>
        <EndpointRow textToCopy={webhookPostUrl} breakAll>
          <span className="text-amber-300/90">POST</span>{" "}
          <span
            className={merchantCallbackUrl ? "text-white/80" : "text-white/45"}
          >
            {webhookPostUrl}
          </span>
        </EndpointRow>
        <p className="mt-1 font-mono text-xs text-white/45">
          X-Webhook-Event: payment.success
        </p>
        <p className="mt-3 text-sm text-white/55">
          When a deposit reaches success, the gateway POSTs once (retries until
          2xx) to the webhook URL from{" "}
          <span className="font-mono text-white/60">
            Gateway &amp; webhooks
          </span>{" "}
          (same URL as above when configured). Payloads are not signed by
          default — protect your endpoint (secret in URL, mTLS, or IP
          allowlist). Treat delivery as at-least-once; dedupe with{" "}
          <span className="font-mono">tx_hash</span> + chain + wallet + token. The
          body includes <span className="font-mono">gateway_environment</span>{" "}
          (<span className="font-mono">live</span> or{" "}
          <span className="font-mono">sandbox</span>) so you can ignore or branch
          on test traffic.
        </p>
        {!merchantCallbackUrl && railRows !== null ? (
          <p className="mt-2 text-xs text-amber-200/80">
            No webhook URL saved yet. Set{" "}
            <span className="font-mono">Webhook URL</span> on the Gateway &amp;
            webhooks page — the sample below uses a placeholder until then.
          </p>
        ) : null}
        <Pre breakAll={Boolean(merchantCallbackUrl)}>{`POST ${webhookPostUrl}
Content-Type: application/json
X-Webhook-Event: payment.success

{
  "transaction_id": "…",
  "wallet_id": "…",
  "tx_hash": "…",
  "amount": "…",
  "status": "success",
  "chain": "TRON",
  "currency": "USDT",
  "network": "TRC20",
  "token_symbol": "USDT",
  "wallet_address": "…",
  "confirmations": 20,
  "external_user_id": "user-123",
  "merchant_id": "…",
  "gateway_environment": "live"
}`}</Pre>
      </section>
    </div>
  );
}
