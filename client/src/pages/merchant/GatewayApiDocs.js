/**
 * In-app reference for integrators: `/api/v1/gateway/*` and webhooks.
 * Kept in sync with server gateway-routes, callback-service, payment-session,
 * optional fixed `amount` / underpaid flow, and unified gateway key behaviour.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import {
  ALL_DEPOSIT_RAIL_OPTIONS,
  depositRailsForChains,
  railKeyFromParts,
  splitRailKey,
} from "../../admin/depositRailOptions.js";
import { GATEWAY_X_TOKEN_SNIPPETS } from "./gatewayXTokenCodeSnippets.js";
import { BrandLoader } from "../../components/BrandLoader.js";

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
 * Rail keys for the Supported Currency table — same as
 * `GET /api/v1/gateway/supported-currency` `pairs` (server applies
 * `GATEWAY_TRON_USDT_ONLY` and chain flags).
 * @param {object} u - `/api/v1/auth/me` JSON
 * @returns {string[]}
 */
function railKeysForGatewayDocsTable(u) {
  if (Array.isArray(u.gateway_supported_rail_keys)) {
    return u.gateway_supported_rail_keys;
  }
  return effectiveMerchantRailKeys(u);
}

/**
 * Same rail keys as the Gateway & webhooks form (`Settings.js`).
 * @param {object} u - `/api/v1/auth/me` JSON
 * @returns {string[]}
 */
function effectiveMerchantRailKeys(u) {
  const platform =
    Array.isArray(u.platform_enabled_chains) && u.platform_enabled_chains.length > 0
      ? u.platform_enabled_chains
      : null;
  let chainList =
    Array.isArray(u.defaultChains) && u.defaultChains.length > 0
      ? u.defaultChains
      : ["TRON"];
  if (platform) {
    chainList = chainList.filter((c) => platform.includes(c));
    if (chainList.length === 0 && platform.length) {
      chainList = [platform[0]];
    }
  }
  const inferredRails = depositRailsForChains(chainList, platform ?? undefined).map((o) => o.key);
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
 * @returns {{ currency: string, network: string, chain: string }}
 */
function rowForRailKey(key) {
  const { currency, network } = splitRailKey(key);
  const opt = ALL_DEPOSIT_RAIL_OPTIONS.find((o) => o.key === key);
  return {
    currency,
    network,
    chain: opt?.chain ?? "—",
  };
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

/** @param {number | null} id */
function merchantIdForDocs(id) {
  return typeof id === "number" && Number.isFinite(id) && id >= 1
    ? String(id)
    : "<merchant_id_from_GET_/api/v1/auth/me>";
}

/**
 * X-Token reference code with language dropdown (same algorithm as `server/src/lib/gateway-x-token.js`).
 */
function XTokenMultiLangCodeBlock() {
  const [lang, setLang] = useState("nodejs");
  const snippet =
    GATEWAY_X_TOKEN_SNIPPETS.find((s) => s.id === lang) ??
    GATEWAY_X_TOKEN_SNIPPETS[0];
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(snippet.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-white/10 bg-black/40">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-black/30 px-2 py-1.5">
        <label className="flex min-w-0 items-center gap-2 text-[10px] font-medium uppercase tracking-wide text-white/55">
          <span className="shrink-0">Language</span>
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            className="max-w-[min(100%,16rem)] rounded-md border border-white/15 bg-black/60 py-1 pl-2 pr-8 text-xs font-normal normal-case tracking-normal text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/25"
            aria-label="X-Token code sample language"
          >
            {GATEWAY_X_TOKEN_SNIPPETS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={handleCopy}
          className={COPY_BTN_CLASS}
          aria-label={copied ? "Copied" : "Copy code to clipboard"}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all p-4 text-xs leading-relaxed text-zinc-200/90">
        {snippet.code}
      </pre>
    </div>
  );
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
  const [gatewayTronOnlyDoc, setGatewayTronOnlyDoc] = useState(false);
  const [apiKeyHint, setApiKeyHint] = useState(null);
  const [merchantNumericId, setMerchantNumericId] = useState(null);
  const [hasSandboxApiKey, setHasSandboxApiKey] = useState(false);
  /** Saved webhook URL from portal (`callbackUrl`); null if unset or not loaded yet */
  const [merchantCallbackUrl, setMerchantCallbackUrl] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api("/api/v1/auth/me")
      .then((u) => {
        if (cancelled) return;
        setGatewayTronOnlyDoc(Boolean(u.gateway_tron_usdt_only));
        setRailRows(railKeysForGatewayDocsTable(u).map(rowForRailKey));
        const h = u.apiKeyHint;
        setApiKeyHint(typeof h === "string" && h.trim() ? h.trim() : null);
        setMerchantNumericId(
          typeof u.id === "number" && Number.isFinite(u.id) ? u.id : null,
        );
        setHasSandboxApiKey(Boolean(u.hasSandboxApiKey));
        const cb = u.callbackUrl;
        setMerchantCallbackUrl(
          typeof cb === "string" && cb.trim() ? cb.trim() : null,
        );
      })
      .catch(() => {
        if (!cancelled) {
          setRailRows([]);
          setGatewayTronOnlyDoc(false);
          setApiKeyHint(null);
          setMerchantNumericId(null);
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
        <h1 className="font-display text-2xl font-semibold text-white">
          Gateway API docs
        </h1>
        <p className="mt-2 text-xs text-white/40">
          Example base URL for this environment:{" "}
          <span className="font-mono text-white/60">{API_EXAMPLE_BASE}</span>
          {SANDBOX_DOC_BASE ? (
            <>
              {" "}
              · Sandbox doc URL (simulate-deposit copies):{" "}
              <span className="font-mono text-white/60">
                {SANDBOX_DOC_BASE}
              </span>
            </>
          ) : null}
        </p>
        <p className="mt-2 text-sm text-white/55">
          Live vs sandbox follows your merchant portal profile (Settings). You
          do <span className="font-medium text-white/70">not</span> need{" "}
          <span className="font-mono">gateway_environment</span> unless you
          override (one shared key, other env than Settings). Your gateway
          secret is only on the{" "}
          <Link
            to="/api-key"
            className="text-sky-300/90 underline decoration-white/20 underline-offset-2 hover:decoration-sky-300/60"
          >
            API key
          </Link>{" "}
          page.
        </p>
        <p className="mt-3 text-xs font-medium text-white/45">
          Build <span className="font-mono">X-Token</span> (choose language)
        </p>
        <p className="mt-2 text-xs text-white/45">
          <span className="font-medium text-white/55">PHP:</span> use{" "}
          <span className="font-mono">JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES</span>{" "}
          on every <span className="font-mono">json_encode</span> in your canonical serializer and when
          encoding the POST body — otherwise strings with URLs (e.g.{" "}
          <span className="font-mono">redirect_url</span>) will not match the server’s canonical JSON.
        </p>
        <XTokenMultiLangCodeBlock />
      </div>

      <section className="glass w-full rounded-2xl p-6 lg:p-8">
        <h2 className="text-lg font-semibold text-white">Supported Currency</h2>
        <div className="mt-4">
          {railRows === null ? (
            <BrandLoader
              title="Gateway rails"
              subtitle="Pulling your supported pairs…"
              aria-label="Loading supported currency rails"
            />
          ) : railRows.length === 0 ? (
            <p className="text-sm text-white/45">No pairs to show.</p>
          ) : (
            <div className="data-table-surface">
              <table className="data-table font-mono text-xs">
                <thead>
                  <tr>
                    <th>currency</th>
                    <th>network</th>
                    <th>chain</th>
                  </tr>
                </thead>
                <tbody>
                  {railRows.map((row) => (
                    <tr key={`${row.currency}|${row.network}`}>
                      <td>{row.currency}</td>
                      <td>{row.network}</td>
                      <td>{row.chain}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {gatewayTronOnlyDoc ? (
            <p className="mt-3 text-xs leading-relaxed text-amber-200/80">
              This server is in{" "}
              <span className="font-mono text-amber-100/90">
                GATEWAY_TRON_USDT_ONLY
              </span>{" "}
              mode: only <span className="font-mono">USDT</span> on{" "}
              <span className="font-mono">TRC20</span> is returned by{" "}
              <span className="font-mono">
                GET /api/v1/gateway/supported-currency
              </span>
              . You may still see more rails in Settings; they stay saved but are
              inactive until an admin sets{" "}
              <span className="font-mono">GATEWAY_TRON_USDT_ONLY=false</span>{" "}
              (or <span className="font-mono">0</span>) in env or System settings
              and restarts the API.
            </p>
          ) : null}
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
          <span className="text-sky-300/90">GET</span>{" "}
          /api/v1/gateway/supported-currency
        </EndpointRow>
        <p className="mt-3 text-sm text-white/55">
          Returns every <span className="font-mono">currency</span> +{" "}
          <span className="font-mono">network</span> +{" "}
          <span className="font-mono">chain</span> row your merchant can use on
          the gateway, in order (same columns as the table above — use it to
          build checkout dropdowns on your backend). The boolean{" "}
          <span className="font-mono">gateway_tron_usdt_only</span> mirrors
          server config: when <span className="font-mono">true</span>, only
          USDT·TRC20 is allowed and <span className="font-mono">pairs</span>{" "}
          stays a single entry until multi-rail mode is enabled (env{" "}
          <span className="font-mono">GATEWAY_TRON_USDT_ONLY=false</span> or
          System settings).
        </p>
        <p className="mt-3 text-xs font-medium text-white/45">
          GET + headers (no JSON body)
        </p>
        <ul className="mt-1 list-inside list-disc text-sm text-white/55">
          <li>
            <span className="font-mono text-white/60">X-Merchant-Id</span> —
            numeric id from{" "}
            <span className="font-mono">GET /api/v1/auth/me</span>
          </li>
          <li>
            <span className="font-mono text-white/60">X-Token</span> —{" "}
            <span className="font-mono">buildXToken</span> on the canonical JSON
            of exactly{" "}
            <span className="font-mono">
              {'{"api_key":"<your_full_gateway_secret>"}'}
            </span>{" "}
            (same AES-GCM + SHA-256 key rules as above). The secret appears only
            inside the ciphertext.
          </li>
          <li>
            <span className="font-medium text-white/70">Environment:</span>{" "}
            defaults to your portal <span className="font-mono">Live</span>/
            <span className="font-mono">Sandbox</span> (Settings). No query
            param required. Optional:{" "}
            <span className="font-mono text-white/60">
              ?gateway_environment=live
            </span>{" "}
            or <span className="font-mono">sandbox</span> only to override when
            using one shared key.
          </li>
        </ul>
        <Pre>{`GET /api/v1/gateway/supported-currency
X-Merchant-Id: ${merchantIdForDocs(merchantNumericId)}
X-Token: <base64 from buildXToken on canonical JSON of:
  {"api_key":${gatewayApiKeyJsonLiteral(apiKeyHint)}}
  (use your real full secret in code, not the masked doc example)>`}</Pre>
        <p className="mt-4 text-xs font-medium text-white/45">200 response</p>
        <Pre>{`{
  "pairs": [
    { "currency": "USDT", "network": "TRC20", "chain": "TRON" }
  ],
  "default_currency": "USDT",
  "default_network": "TRC20",
  "gateway_environment": "live",
  "gateway_tron_usdt_only": true
}`}</Pre>
        <p className="mt-4 text-xs text-white/45">
          <span className="font-mono">401 invalid_x_token</span> if auth fails.
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
          Each call can mint a new <span className="font-mono">payment_link</span>{" "}
          (new checkout session); optional <span className="font-mono">amount</span>{" "}
          applies only to that session.
        </p>
        <p className="mt-3 text-xs font-medium text-white/45">
          Headers (recommended — no secret in JSON)
        </p>
        <ul className="mt-1 list-inside list-disc text-sm text-white/55">
          <li>
            <span className="font-mono text-white/60">X-Merchant-Id</span>,{" "}
            <span className="font-mono text-white/60">X-Token</span> — encrypt
            canonical JSON of this POST body{" "}
            <span className="font-medium text-white/70">without</span>{" "}
            <span className="font-mono">api_key</span>
          </li>
        </ul>
        <p className="mt-3 text-xs font-medium text-white/45">Body</p>
        <ul className="mt-1 list-inside list-disc text-sm text-white/55">
          <li>
            <span className="font-mono text-white/60">gateway_environment</span>{" "}
            (optional) — omit to use portal Live/Sandbox (Settings); add only to
            override with a unified key
          </li>
          <li>
            <span className="font-mono text-white/60">external_user_id</span>{" "}
            (required) — your user id
          </li>
          <li>
            <span className="font-mono text-white/60">currency</span>,{" "}
            <span className="font-mono text-white/60">network</span> (optional —
            default pair if omitted)
          </li>
          <li>
            <span className="font-mono text-white/60">transaction_id</span>{" "}
            (optional) — your order / checkout id (max 256 chars); echoed on
            deposit rows and webhooks as{" "}
            <span className="font-mono">merchant_transaction_id</span>
          </li>
          <li>
            <span className="font-mono text-white/60">redirect_url</span>{" "}
            (optional) — absolute <span className="font-mono">http(s)</span>{" "}
            URL; hosted checkout redirects here when a deposit reaches full{" "}
            <span className="font-mono">success</span> (or when the deposit scan
            countdown ends if configured)
          </li>
          <li>
            <span className="font-mono text-white/60">amount</span> (optional) —
            fixed total for this checkout: either a <strong>decimal</strong>{" "}
            token string (e.g. <span className="font-mono">&quot;10.50&quot;</span>
            ) or <strong>digits-only whole token units</strong> (e.g.{" "}
            <span className="font-mono">&quot;11&quot;</span> = 11 USDT). Omitted
            = pay any amount. Supported when the gateway knows decimals for the
            rail (today: <span className="font-mono">USDT</span> on{" "}
            <span className="font-mono">TRC20</span>,{" "}
            <span className="font-mono">ERC20</span>,{" "}
            <span className="font-mono">BEP20</span>).
          </li>
          <li>
            Do not send <span className="font-mono">api_key</span> when using
            headers
          </li>
        </ul>
        <Pre>{`POST /api/v1/gateway/deposit-address
Content-Type: application/json
X-Merchant-Id: ${merchantIdForDocs(merchantNumericId)}
X-Token: <base64 from buildXToken on canonical JSON of body>

{
  "external_user_id": "user-123",
  "currency": "USDT",
  "network": "TRC20",
  "transaction_id": "order-789",
  "amount": "10.50",
  "redirect_url": "https://yoursite.com/payment/return"
}`}</Pre>
        <p className="mt-4 text-xs font-medium text-white/45">200 response</p>
        <Pre>{`{
  "address": "T… or 0x…",
  "chain": "TRON",
  "currency": "USDT",
  "network": "TRC20",
  "wallet_id": 1,
  "user_id": 1,
  "merchant_id": 1,
  "created_new_user": false,
  "gateway_environment": "live",
  "payment_link": "https://…/pay/<token>",
  "deposit_scan_expires_at": "…",
  "deposit_scan_ttl_minutes": 120,
  "reservation_expires_at": "…",
  "redirect_url": "https://yoursite.com/payment/return",
  "expected_amount_atomic": "10500000",
  "expected_amount_decimal": "10.5"
}`}</Pre>
        <p className="mt-2 text-xs text-white/45">
          <span className="font-mono">expected_amount_*</span> appears only when
          you sent a valid <span className="font-mono">amount</span>. A
          placeholder <span className="font-mono">transactions</span> row with{" "}
          <span className="font-mono">status: &quot;created&quot;</span> is also
          written (removed when the first on-chain deposit row exists for that
          checkout session).
        </p>
        <p className="mt-4 text-xs text-white/45">
          Errors: <span className="font-mono">400</span> missing fields,{" "}
          <span className="font-mono">unsupported_currency_network</span>,{" "}
          <span className="font-mono">invalid_redirect_url</span>,{" "}
          <span className="font-mono">transaction_id_too_long</span>, or{" "}
          <span className="font-mono">amount_*</span> (
          <span className="font-mono">amount_invalid</span>,{" "}
          <span className="font-mono">amount_not_supported_for_rail</span>, etc.);{" "}
          <span className="font-mono">401 invalid_x_token</span>;{" "}
          <span className="font-mono">403 rail_not_enabled_for_merchant</span>;{" "}
          <span className="font-mono">409 callback_pending</span> when a prior{" "}
          <span className="font-mono">payment</span> webhook is still retrying;{" "}
          <span className="font-mono">
            500 merchant_default_pair_misconfigured
          </span>{" "}
          if defaults are missing.
        </p>
      </section>

      <section className="glass w-full rounded-2xl p-6 lg:p-8">
        <h2 className="text-lg font-semibold text-white">
          Hosted checkout: payment session
        </h2>
        <p className="mt-3 text-sm text-white/55">
          The <span className="font-mono">payment_link</span> from{" "}
          <span className="font-mono">deposit-address</span> loads the public
          checkout page. Your app can mirror it with these unauthenticated reads
          (token is signed and scoped to one wallet/session).
        </p>
        <EndpointRow
          textToCopy={gatewayEndpointClipboardText(
            "/api/v1/gateway/payment-session/{token}",
          )}
          breakAll
        >
          <span className="text-sky-300/90">GET</span>{" "}
          /api/v1/gateway/payment-session/{"{"}token{"}"}
        </EndpointRow>
        <p className="mt-2 text-xs text-white/45">
          Returns <span className="font-mono">address</span>,{" "}
          <span className="font-mono">chain</span>,{" "}
          <span className="font-mono">currency</span>,{" "}
          <span className="font-mono">network</span>, scan/hold TTL fields,{" "}
          <span className="font-mono">redirect_url</span>. If this session used
          optional <span className="font-mono">amount</span>, also{" "}
          <span className="font-mono">expected_amount_atomic</span> and{" "}
          <span className="font-mono">expected_amount_decimal</span>.
        </p>
        <EndpointRow
          textToCopy={gatewayEndpointClipboardText(
            "/api/v1/gateway/payment-session/{token}/poll",
          )}
          breakAll
        >
          <span className="text-sky-300/90">GET</span>{" "}
          /api/v1/gateway/payment-session/{"{"}token{"}"}/poll
        </EndpointRow>
        <p className="mt-2 text-xs font-medium text-white/45">200 response</p>
        <Pre>{`{
  "has_successful_deposit": false,
  "has_underpaid_deposit": true
}`}</Pre>
        <p className="mt-2 text-xs text-white/45">
          Poll every few seconds: when the combined on-chain total for this
          checkout session reaches the optional expected amount,{" "}
          <span className="font-mono">has_successful_deposit</span> becomes true
          (same condition as a callback with{" "}
          <span className="font-mono">status: success</span>). If a deposit is
          seen but the session total is still short,{" "}
          <span className="font-mono">has_underpaid_deposit</span> is true (same
          idea as <span className="font-mono">status: underpaid</span> on the
          webhook). No{" "}
          <span className="font-mono">X-Token</span> on these GETs.
        </p>
      </section>

      <section className="glass w-full rounded-2xl p-6 lg:p-8">
        <h2 className="text-lg font-semibold text-white">
          Sandbox: simulate deposit (merchant testing)
        </h2>
        <p className="mt-2 text-sm text-white/55">
          Creates a synthetic <span className="font-mono">success</span>{" "}
          transaction and sends the same{" "}
          <span className="font-mono">payment</span> webhook (
          <span className="font-mono">status: success</span>) as a real
          confirmed deposit — so your backend can test parsing and idempotency
          without sending crypto. Use the same{" "}
          <span className="font-mono">X-Token</span> +{" "}
          <span className="font-mono">X-Merchant-Id</span> auth as other calls;
          this route always targets sandbox data. First get a sandbox{" "}
          <span className="font-mono">wallet_id</span> from{" "}
          <span className="font-mono">deposit-address</span> (portal set to
          Sandbox, or optional{" "}
          <span className="font-mono">gateway_environment: "sandbox"</span> if
          portal is Live).
        </p>
        {!hasSandboxApiKey && railRows !== null ? (
          <p className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-100/90">
            No gateway API key on file yet. Ask your admin to create the
            merchant or regenerate the gateway API key once.
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
        <p className="mt-3 text-xs font-medium text-white/45">
          Headers (recommended)
        </p>
        <ul className="mt-1 list-inside list-disc text-sm text-white/55">
          <li>
            <span className="font-mono text-white/60">X-Merchant-Id</span>,{" "}
            <span className="font-mono text-white/60">X-Token</span> — encrypt
            the canonical JSON of the body (no{" "}
            <span className="font-mono">api_key</span>)
          </li>
        </ul>
        <p className="mt-3 text-xs font-medium text-white/45">Body</p>
        <ul className="mt-1 list-inside list-disc text-sm text-white/55">
          <li>
            <span className="font-mono text-white/60">wallet_id</span> — from{" "}
            <span className="font-mono">deposit-address</span> for a sandbox
            user (portal Sandbox or body override)
          </li>
          <li>
            <span className="font-mono text-white/60">amount</span> — optional,
            string of integer smallest units; omit for one whole unit (e.g.{" "}
            <span className="font-mono">1000000</span> for 1 USDT)
          </li>
        </ul>
        <Pre>{`POST /api/v1/gateway/sandbox/simulate-deposit
Content-Type: application/json
X-Merchant-Id: ${merchantIdForDocs(merchantNumericId)}
X-Token: <base64 from buildXToken on canonical JSON of body>

{
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
          <span className="font-mono">403 sandbox_api_key_required</span> only
          if your account still has a separate live-only secret (legacy);{" "}
          <span className="font-mono">404 wallet_not_found</span> if the wallet
          is not yours or not in sandbox.
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
          are in smallest units; each row also includes{" "}
          <span className="font-mono">amount_decimal</span> for display (same
          value as dividing <span className="font-mono">amount</span> by{" "}
          <span className="font-mono">10^token_decimals</span>).
        </p>
        <Pre>{`GET /api/v1/gateway/transactions?address=TExampleAddress…
GET /api/v1/gateway/transactions?address=TExampleAddress…&currency=USDT&network=TRC20`}</Pre>
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
      "amount": "1000000",
      "amount_decimal": "1",
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
        <p className="mt-2 text-xs text-white/45">
          <span className="font-mono">status</span> may be{" "}
          <span className="font-mono">pending</span>,{" "}
          <span className="font-mono">success</span>,{" "}
          <span className="font-mono">failed</span>, or{" "}
          <span className="font-mono">underpaid</span> (fixed-amount sessions
          until the session total is met).
        </p>
      </section>

      <section className="glass w-full rounded-2xl p-6 lg:p-8">
        <h2 className="text-lg font-semibold text-white">Payment webhook</h2>
        <EndpointRow textToCopy={webhookPostUrl} breakAll>
          <span className="text-amber-300/90">POST</span>{" "}
          <span
            className={merchantCallbackUrl ? "text-white/80" : "text-white/45"}
          >
            {webhookPostUrl}
          </span>
        </EndpointRow>
        <p className="mt-1 font-mono text-xs text-white/45">
          X-Webhook-Event: payment
        </p>
        <p className="mt-3 text-sm text-white/55">
          Every automatic delivery and portal “resend” uses the same header.{" "}
          <strong>Branch on JSON</strong>{" "}
          <span className="font-mono">status</span>:{" "}
          <span className="font-mono">success</span> when the row is fully paid
          (and for fixed-amount checkouts when the session total is met),{" "}
          <span className="font-mono">underpaid</span> when a credit exists but
          the session total is still short (optional{" "}
          <span className="font-mono">amount</span> on{" "}
          <span className="font-mono">deposit-address</span> only). Retries until{" "}
          <span className="font-mono">2xx</span>. Dedupe with{" "}
          <span className="font-mono">tx_hash</span> + chain +{" "}
          <span className="font-mono">wallet_id</span>. If you passed{" "}
          <span className="font-mono">transaction_id</span> on{" "}
          <span className="font-mono">deposit-address</span>, the body includes{" "}
          <span className="font-mono">merchant_transaction_id</span>. Payloads are
          not signed by default.
        </p>
        {!merchantCallbackUrl && railRows !== null ? (
          <p className="mt-2 text-xs text-amber-200/80">
            No webhook URL saved yet. Set{" "}
            <span className="font-mono">Webhook URL</span> on the Gateway &amp;
            webhooks page — the sample below uses a placeholder until then.
          </p>
        ) : null}
        <p className="mt-4 text-xs font-medium text-white/45">
          Example — <span className="font-mono">status: success</span>
        </p>
        <Pre breakAll={Boolean(merchantCallbackUrl)}>{`POST ${webhookPostUrl}
Content-Type: application/json
X-Webhook-Event: payment

{
  "transaction_id": 42,
  "merchant_transaction_id": "order-789",
  "wallet_id": 1,
  "tx_hash": "…",
  "amount": "1000000",
  "token_decimals": 6,
  "amount_decimal": "1",
  "status": "success",
  "chain": "TRON",
  "currency": "USDT",
  "network": "TRC20",
  "token_symbol": "USDT",
  "wallet_address": "…",
  "confirmations": 20,
  "external_user_id": "user-123",
  "merchant_id": 1,
  "gateway_environment": "live"
}`}</Pre>
        <p className="mt-4 text-xs font-medium text-white/45">
          Example — <span className="font-mono">status: underpaid</span> (extra
          expected/received fields)
        </p>
        <Pre breakAll={Boolean(merchantCallbackUrl)}>{`POST ${webhookPostUrl}
Content-Type: application/json
X-Webhook-Event: payment

{
  "transaction_id": 42,
  "merchant_transaction_id": "order-789",
  "wallet_id": 1,
  "tx_hash": "…",
  "amount": "5000000",
  "token_decimals": 6,
  "amount_decimal": "5",
  "status": "underpaid",
  "expected_amount_atomic": "10500000",
  "expected_amount_decimal": "10.5",
  "received_amount_atomic": "5000000",
  "received_amount_decimal": "5",
  "chain": "TRON",
  "currency": "USDT",
  "network": "TRC20",
  "token_symbol": "USDT",
  "wallet_address": "…",
  "confirmations": 20,
  "external_user_id": "user-123",
  "merchant_id": 1,
  "gateway_environment": "live"
}`}</Pre>
        <p className="mt-3 text-xs text-white/45">
          When the session later reaches the full expected amount, you get another
          POST with <span className="font-mono">status: success</span>. A webhook
          stuck without <span className="font-mono">2xx</span> can block new{" "}
          <span className="font-mono">deposit-address</span> calls with{" "}
          <span className="font-mono">409 callback_pending</span>.
        </p>
      </section>
    </div>
  );
}
