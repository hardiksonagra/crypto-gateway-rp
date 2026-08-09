import { useEffect, useMemo, useRef, useState } from "react";
import { Formik, Form, Field, ErrorMessage, useFormikContext } from "formik";
import { api } from "../../api";
import { buildMerchantGatewayAndAutoSwapSchema } from "../../admin/merchantSchemas";
import ChainMultiSelectField from "../../components/ChainMultiSelectField";
import DepositRailsMultiSelectField from "../../components/DepositRailsMultiSelectField";
import { BrandLoader } from "../../components/BrandLoader.js";
import {
  ALL_DEPOSIT_RAIL_OPTIONS,
  MERCHANT_PAYOUT_RAIL_KEYS,
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

/**
 * @param {string[]} supportedRails
 * @param {unknown} autoSettings `auto_swap_settings` from auth/me
 */
function buildAutoSwapDestRowsFromAuth(supportedRails, autoSettings) {
  const stored =
    autoSettings && typeof autoSettings === "object" && !Array.isArray(autoSettings)
      ? autoSettings
      : {};
  const dest = Array.isArray(stored.destinations) ? stored.destinations : [];
  /** @type {Map<string, string>} */
  const map = new Map();
  for (const d of dest) {
    if (!d || typeof d !== "object") continue;
    const rk = typeof d.rail_key === "string" ? d.rail_key.trim() : "";
    if (!rk) continue;
    const addr =
      d.treasury_address != null
        ? String(d.treasury_address)
        : d.address != null
          ? String(d.address)
          : "";
    map.set(rk, addr);
  }
  return supportedRails.map((rk) => ({
    rail_key: rk,
    treasury_address: map.get(rk) ?? "",
  }));
}

/**
 * Min thresholds (auto-swap only): from `min_amounts_by_rail` or legacy per-destination min.
 *
 * @param {string[]} supportedRails
 * @param {unknown} autoSettings
 */
function buildAutoSwapMinRowsFromAuth(supportedRails, autoSettings) {
  const stored =
    autoSettings && typeof autoSettings === "object" && !Array.isArray(autoSettings)
      ? autoSettings
      : {};
  const fromMap =
    stored.min_amounts_by_rail &&
    typeof stored.min_amounts_by_rail === "object" &&
    stored.min_amounts_by_rail !== null
      ? /** @type {Record<string, unknown>} */ (stored.min_amounts_by_rail)
      : {};
  const dest = Array.isArray(stored.destinations) ? stored.destinations : [];
  /** @type {Map<string, string>} */
  const legacyMin = new Map();
  for (const d of dest) {
    if (!d || typeof d !== "object") continue;
    const rk = typeof d.rail_key === "string" ? d.rail_key.trim() : "";
    if (!rk) continue;
    const m = d.min_amount_decimal ?? d.min_amount;
    if (m != null && String(m).trim() !== "") legacyMin.set(rk, String(m).trim());
  }
  return supportedRails.map((rk) => {
    const k = fromMap[rk];
    const fromTop =
      k != null && String(k).trim() !== "" ? String(k).trim() : legacyMin.get(rk) ?? "";
    return {
      rail_key: rk,
      min_amount_decimal: fromTop,
    };
  });
}

/**
 * @param {object} u `/api/v1/auth/me` merchant JSON
 */
function buildMerchantSettingsInitial(u) {
  const g = buildGatewaySettingsBoot(u);
  const prp =
    u.payout_rails_policy && typeof u.payout_rails_policy === "object" && !Array.isArray(u.payout_rails_policy)
      ? u.payout_rails_policy
      : {};
  const legacyMin = String(u.payout_min_amount_human ?? "0").trim() || "0";
  const legacyMax = String(u.payout_max_amount_human ?? "0").trim() || "0";
  const pt =
    u.payout_treasury_addresses &&
    typeof u.payout_treasury_addresses === "object" &&
    !Array.isArray(u.payout_treasury_addresses)
      ? u.payout_treasury_addresses
      : {};
  const payout_rails_policy_rows = MERCHANT_PAYOUT_RAIL_KEYS.map((rk) => {
    const row = prp[rk] && typeof prp[rk] === "object" ? prp[rk] : {};
    const minH = row.min_human != null ? String(row.min_human).trim() : "";
    const maxH = row.max_human != null ? String(row.max_human).trim() : "";
    const tre =
      row.treasury_address != null
        ? String(row.treasury_address).trim()
        : rk === "USDT|TRC20"
          ? String(pt.TRON ?? "").trim()
          : String(pt.ETH ?? "").trim();
    return {
      rail_key: rk,
      min_human: minH !== "" ? minH : legacyMin,
      max_human: maxH !== "" ? maxH : legacyMax,
      treasury_address: tre,
    };
  });
  return {
    ...g,
    payout_rails_policy_rows,
    auto_swap_enabled: Boolean(u.auto_swap_enabled),
    auto_swap_dest_rows: buildAutoSwapDestRowsFromAuth(g.supported_deposit_rails, u.auto_swap_settings),
    auto_swap_min_rows: buildAutoSwapMinRowsFromAuth(g.supported_deposit_rails, u.auto_swap_settings),
    trx_fee_topup_source_address:
      typeof u.auto_swap_trx_fee_source_address === "string"
        ? u.auto_swap_trx_fee_source_address
        : "",
    trx_sweep_funder_has_merchant_key: Boolean(u.trx_sweep_funder_has_merchant_key),
    trx_sweep_funder_private_key: "",
    trx_sweep_funder_clear: false,
  };
}

function railLabel(railKey) {
  const hit = ALL_DEPOSIT_RAIL_OPTIONS.find((o) => o.key === railKey);
  return hit ? hit.label : railKey.split("|").join(" · ");
}

/** Keeps destination + min rows aligned with selected deposit rails. */
function AutoSwapRailsSync() {
  const { values, setFieldValue } = useFormikContext();
  const destRef = useRef(values.auto_swap_dest_rows);
  const minRef = useRef(values.auto_swap_min_rows);
  destRef.current = values.auto_swap_dest_rows;
  minRef.current = values.auto_swap_min_rows;
  const rails = values.supported_deposit_rails || [];
  const railsKey = rails.join("\u0001");
  useEffect(() => {
    const r = railsKey.length ? railsKey.split("\u0001") : [];
    const prevD = destRef.current || [];
    const prevM = minRef.current || [];
    const mapD = new Map(prevD.map((x) => [x.rail_key, x]));
    const mapM = new Map(prevM.map((x) => [x.rail_key, x]));
    const nextD = r.map((rk) => {
      const cur = mapD.get(rk);
      return cur ?? { rail_key: rk, treasury_address: "" };
    });
    const nextM = r.map((rk) => {
      const cur = mapM.get(rk);
      return cur ?? { rail_key: rk, min_amount_decimal: "" };
    });
    const sameD =
      nextD.length === prevD.length &&
      nextD.every((row, i) => JSON.stringify(row) === JSON.stringify(prevD[i]));
    const sameM =
      nextM.length === prevM.length &&
      nextM.every((row, i) => JSON.stringify(row) === JSON.stringify(prevM[i]));
    if (!sameD) setFieldValue("auto_swap_dest_rows", nextD, false);
    if (!sameM) setFieldValue("auto_swap_min_rows", nextM, false);
  }, [railsKey, setFieldValue]);
  return null;
}

export default function MerchantSettings() {
  const [boot, setBoot] = useState(null);
  const [gatewayModes, setGatewayModes] = useState(null);

  useEffect(() => {
    api("/api/v1/auth/me").then((u) => {
      setBoot(buildMerchantSettingsInitial(u));
      setGatewayModes({
        live: u.liveGatewayEnabled !== false,
        sandbox: u.sandboxGatewayEnabled !== false,
      });
    });
  }, []);

  const validationSchema = useMemo(
    () => buildMerchantGatewayAndAutoSwapSchema(boot?.platform_enabled_chains, true),
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
            const destinations = (values.auto_swap_dest_rows || []).map((row) => ({
              rail_key: row.rail_key,
              treasury_address: String(row.treasury_address ?? "").trim(),
            }));
            /** @type {Record<string, string>} */
            const min_amounts_by_rail = {};
            for (const row of values.auto_swap_min_rows || []) {
              const m = String(row.min_amount_decimal ?? "").trim();
              if (m !== "") min_amounts_by_rail[row.rail_key] = m;
            }
            /** @type {Record<string, unknown>} */
            const patch = {
              callback_url: values.callback_url?.trim() || null,
              default_chains: values.default_chains,
              supported_deposit_rails: values.supported_deposit_rails,
              auto_swap_enabled: Boolean(values.auto_swap_enabled),
              auto_swap_settings: {
                version: 2,
                destinations,
                min_amounts_by_rail,
              },
            };
            if (values.trx_sweep_funder_clear) {
              patch.trx_sweep_funder_private_key = null;
            } else if (String(values.trx_sweep_funder_private_key ?? "").trim()) {
              patch.trx_sweep_funder_private_key = String(values.trx_sweep_funder_private_key).trim();
            }
            /** @type {Record<string, { min_human: string, max_human: string, treasury_address: string }>} */
            const payout_rails_policy = {};
            for (const row of values.payout_rails_policy_rows || []) {
              if (!row || typeof row !== "object" || !row.rail_key) continue;
              payout_rails_policy[row.rail_key] = {
                min_human: String(row.min_human ?? "").trim(),
                max_human: String(row.max_human ?? "").trim(),
                treasury_address: String(row.treasury_address ?? "").trim(),
              };
            }
            patch.payout_rails_policy = payout_rails_policy;
            await api("/api/v1/merchant/settings", {
              method: "PATCH",
              json: patch,
            });
            const fresh = await api("/api/v1/auth/me");
            setBoot(buildMerchantSettingsInitial(fresh));
            setStatus("ok");
          } catch (err) {
            setStatus(String(err));
          } finally {
            setSubmitting(false);
          }
        }}
      >
        {({ isSubmitting, status, values }) => (
          <Form className="glass mt-8 w-full grid grid-cols-1 gap-6 rounded-2xl p-6 lg:grid-cols-2 lg:p-8">
            <AutoSwapRailsSync />
            <div className="lg:col-span-2">
              <label className="text-xs text-white/50" htmlFor="callback_url">
                Webhook URL · deposits only (
                <span className="font-mono text-white/65">X-Webhook-Event: payment</span>
                ; branch on JSON <span className="font-mono text-white/65">status</span>). Payout status:{" "}
                <span className="font-mono text-white/65">GET …/gateway/payout</span> with{" "}
                <span className="font-mono text-white/65">client_reference_id</span>.
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

            <div className="lg:col-span-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-5">
              <h2 className="text-sm font-semibold text-white/90">Payout defaults (per currency / network)</h2>
              <p className="mt-2 text-xs leading-relaxed text-white/50">
                Optional per-request gross limits (USDT) for portal and gateway payout APIs,{" "}
                <strong className="text-white/70">per rail</strong>. Use{" "}
                <span className="font-mono text-white/70">0</span> for minimum to rely on settlement rules only;{" "}
                <span className="font-mono text-white/70">0</span> for maximum means no cap. Within limits, payouts
                send <strong className="text-white/70">automatically</strong>: treasury address is the from-wallet
                (platform hot wallet address, or one of your gateway USDT deposit wallets). Leave treasury empty to
                use the platform hot wallet (
                <span className="font-mono text-white/65">PAYOUT_HOT_PRIVATE_KEY_*</span>
                ). For <strong className="text-white/70">USDT·TRC20</strong>, if you have no TRX funder key below,
                this treasury also funds TRX fees (sends TRX to deposit wallets, or buys TRX with USDT on the treasury
                itself via SunSwap when the treasury is the payout from-wallet — leave a small TRX dust for the first
                swap).
              </p>
              <div className="mt-5 space-y-5">
                {(values.payout_rails_policy_rows || []).map((row, idx) => (
                  <div
                    key={row.rail_key}
                    className="grid grid-cols-1 gap-4 rounded-lg border border-white/10 bg-black/20 p-4 lg:grid-cols-2"
                  >
                    <div className="lg:col-span-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-200/90">
                        {railLabel(row.rail_key)}
                      </p>
                      <p className="font-mono text-[10px] text-white/35">{row.rail_key}</p>
                    </div>
                    <div>
                      <label className="text-xs text-white/50" htmlFor={`payout-min-${row.rail_key}`}>
                        Minimum gross payout (USDT)
                      </label>
                      <Field
                        id={`payout-min-${row.rail_key}`}
                        name={`payout_rails_policy_rows.${idx}.min_human`}
                        type="text"
                        className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
                        placeholder="0"
                      />
                      <ErrorMessage
                        name={`payout_rails_policy_rows.${idx}.min_human`}
                        component="p"
                        className="mt-1 text-xs text-rose-400"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-white/50" htmlFor={`payout-max-${row.rail_key}`}>
                        Maximum gross payout (USDT)
                      </label>
                      <Field
                        id={`payout-max-${row.rail_key}`}
                        name={`payout_rails_policy_rows.${idx}.max_human`}
                        type="text"
                        className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
                        placeholder="0"
                      />
                      <ErrorMessage
                        name={`payout_rails_policy_rows.${idx}.max_human`}
                        component="p"
                        className="mt-1 text-xs text-rose-400"
                      />
                    </div>
                    <div className="lg:col-span-2">
                      <label className="text-xs text-white/50" htmlFor={`payout-treasury-${row.rail_key}`}>
                        Payout treasury address (optional)
                      </label>
                      <Field
                        id={`payout-treasury-${row.rail_key}`}
                        name={`payout_rails_policy_rows.${idx}.treasury_address`}
                        type="text"
                        className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm"
                        placeholder={row.rail_key.includes("TRC20") ? "T…" : "0x…"}
                      />
                      <ErrorMessage
                        name={`payout_rails_policy_rows.${idx}.treasury_address`}
                        component="p"
                        className="mt-1 text-xs text-rose-400"
                      />
                    </div>
                  </div>
                ))}
              </div>
              <ErrorMessage
                name="payout_rails_policy_rows"
                component="p"
                className="mt-3 text-xs text-rose-400"
              />
            </div>

            <div className="lg:col-span-2 rounded-xl border border-indigo-400/20 bg-indigo-500/[0.07] px-4 py-5">
              <h2 className="text-sm font-semibold text-white/90">Treasury &amp; automatic swap</h2>
              <p className="mt-2 text-sm leading-relaxed text-white/60">
                Your deposit wallets are derived from the <strong className="text-white/80">12-word phrase</strong> you
                gave at onboarding. Turn on <strong className="text-white/80">automatic swap</strong> to sweep deposit
                wallets on a schedule; set optional <strong className="text-white/80">minimum balances</strong> next to
                that switch (only when swap is on). Below, enter <strong className="text-white/80">per currency/network</strong>{" "}
                treasury addresses — those lines are only <strong className="text-white/80">where</strong> each rail&apos;s
                funds should land; they do not include a minimum.
              </p>

              <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-5">
                <div>
                  <p className="text-xs font-medium text-white/50">Automatic swap</p>
                  <p className="mt-1 max-w-xl text-xs text-white/40">
                    Off: treasury addresses below are optional reference only. On: every active deposit rail needs a
                    valid swap destination. The TRON USDT cron moves funds when each deposit wallet&apos;s balance is{" "}
                    <strong className="text-white/55">greater than</strong> your minimum for that rail (if set).
                  </p>
                </div>
                <Field name="auto_swap_enabled">
                  {({ field, form }) => (
                    <button
                      type="button"
                      role="switch"
                      aria-checked={field.value}
                      aria-label={field.value ? "Auto-swap enabled" : "Auto-swap disabled"}
                      onClick={() => form.setFieldValue("auto_swap_enabled", !field.value)}
                      className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300/40 ${
                        field.value ? "bg-emerald-600/90" : "bg-white/20"
                      }`}
                    >
                      <span
                        className={`pointer-events-none absolute top-0.5 left-0.5 block h-7 w-7 rounded-full bg-white shadow transition-transform ${
                          field.value ? "translate-x-6" : "translate-x-0"
                        }`}
                      />
                    </button>
                  )}
                </Field>
              </div>

              {values.auto_swap_enabled ? (
                <div className="mt-5 space-y-4 rounded-lg border border-white/10 bg-black/25 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-white/45">
                    Minimum balance before auto-sweep (optional)
                  </p>
                  <p className="text-xs text-white/40">
                    Shown only while automatic swap is on. The job runs when the deposit wallet holds{" "}
                    <strong className="text-white/60">more than</strong> this amount (per rail). Leave blank to sweep any
                    positive USDT once fees allow (TRON USDT cron today).
                  </p>
                  {(values.auto_swap_min_rows || []).map((row, idx) => (
                    <div key={row.rail_key} className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-200/90">
                          {railLabel(row.rail_key)}
                        </p>
                        <p className="font-mono text-[10px] text-white/35">{row.rail_key}</p>
                      </div>
                      <div>
                        <label className="text-xs text-white/50" htmlFor={`swap-min-${row.rail_key}`}>
                          Min. (USDT decimal for this rail)
                        </label>
                        <Field
                          id={`swap-min-${row.rail_key}`}
                          name={`auto_swap_min_rows.${idx}.min_amount_decimal`}
                          type="text"
                          inputMode="decimal"
                          className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
                          placeholder="e.g. 10 — blank = any positive balance"
                        />
                        <ErrorMessage
                          name={`auto_swap_min_rows.${idx}.min_amount_decimal`}
                          component="p"
                          className="mt-1 text-xs text-rose-400"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {(values.supported_deposit_rails || []).some((rk) =>
                String(rk).toUpperCase().includes("TRC20"),
              ) ? (
                <div className="mt-5 space-y-3 rounded-lg border border-amber-400/25 bg-amber-500/[0.06] px-4 py-3 lg:col-span-2">
                  <p className="text-xs font-medium text-amber-100/90">TRX for TRON fees (auto top-up)</p>
                  <p className="text-xs leading-relaxed text-white/55">
                    When a payout, scheduled swap, or Send USDT needs more{" "}
                    <strong className="text-white/75">TRX</strong> for fees: if you save a TRON private key below, native
                    TRX is sent from that funder wallet first. If this key is empty, the gateway falls back to your{" "}
                    <strong className="text-white/75">USDT·TRC20 payout treasury</strong> (Payout defaults above) — TRX
                    send from that treasury, or SunSwap USDT→TRX on the treasury when it is the from-wallet. The platform
                    does not supply merchant TRX from server environment keys.
                  </p>
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wide text-white/40">Effective TRX sender</p>
                    <p className="mt-1 break-all font-mono text-xs text-white/85">
                      {boot.trx_fee_topup_source_address?.trim() ? (
                        <>
                          <span className="text-emerald-200/90">TRX funder · </span>
                          {boot.trx_fee_topup_source_address.trim()}
                        </>
                      ) : (
                        <span className="text-white/45">
                          — No funder key — fee top-up will use USDT·TRC20 payout treasury when set (see Payout defaults).
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="border-t border-amber-400/20 pt-3">
                    <label className="text-xs text-white/50" htmlFor="trx_sweep_funder_private_key">
                      Your TRON private key (64 hex, optional)
                    </label>
                    <Field
                      id="trx_sweep_funder_private_key"
                      name="trx_sweep_funder_private_key"
                      type="password"
                      autoComplete="off"
                      className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-white/90"
                      placeholder={
                        boot.trx_sweep_funder_has_merchant_key
                          ? "Leave blank to keep saved key · paste new hex to replace"
                          : "Paste 64-character hex (optional 0x)"
                      }
                    />
                    <ErrorMessage
                      name="trx_sweep_funder_private_key"
                      component="p"
                      className="mt-1 text-xs text-rose-400"
                    />
                    {boot.trx_sweep_funder_has_merchant_key ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Field name="trx_sweep_funder_clear">
                          {({ field, form }) => (
                            <label className="flex cursor-pointer items-center gap-2 text-xs text-white/55">
                              <input
                                type="checkbox"
                                checked={Boolean(field.value)}
                                onChange={(e) => form.setFieldValue("trx_sweep_funder_clear", e.target.checked)}
                                className="rounded border-white/20 bg-black/40"
                              />
                              Remove saved TRX funder key
                            </label>
                          )}
                        </Field>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div className="mt-5 space-y-5 border-t border-white/10 pt-5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-white/40">
                  Swap destination by currency / network (treasury address only)
                </p>
                <p className="text-xs text-white/35">
                  Use one row per rail you accept. These addresses define <strong className="text-white/55">where</strong>{" "}
                  consolidated funds should be sent for each currency/network — no minimum is configured here.
                </p>
                {(values.auto_swap_dest_rows || []).map((row, idx) => (
                  <div
                    key={row.rail_key}
                    className="grid grid-cols-1 gap-3 rounded-lg border border-white/10 bg-black/20 p-4"
                  >
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-200/90">
                        {railLabel(row.rail_key)}
                      </p>
                      <p className="mt-1 font-mono text-[10px] text-white/35">{row.rail_key}</p>
                    </div>
                    <div>
                      <label className="text-xs text-white/50" htmlFor={`treasury-${row.rail_key}`}>
                        Treasury / swap destination address
                      </label>
                      <Field
                        id={`treasury-${row.rail_key}`}
                        name={`auto_swap_dest_rows.${idx}.treasury_address`}
                        type="text"
                        autoComplete="off"
                        className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-white/90"
                        placeholder={row.rail_key.includes("TRC20") ? "T…" : "0x…"}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <ErrorMessage
                name="auto_swap_dest_rows"
                component="p"
                className="mt-3 text-xs text-rose-400"
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
