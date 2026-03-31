import { Formik, Form, Field, ErrorMessage } from "formik";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../../api";
import { merchantEditSchema } from "../../admin/merchantSchemas";
import ChainMultiSelectField from "../../components/ChainMultiSelectField";
import DepositRailsMultiSelectField from "../../components/DepositRailsMultiSelectField";
import { depositRailsForChains, railKeyFromParts } from "../../admin/depositRailOptions.js";
import { BrandLoader } from "../../components/BrandLoader.js";
import { useBreadcrumbExtras } from "../../contexts/BreadcrumbExtrasContext.js";

const input =
  "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-white/20 focus:ring-1";
const label = "mb-1 block text-xs font-medium text-white/60";

export default function MerchantEdit() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [newKeysModal, setNewKeysModal] = useState(null);
  const { setMerchantCrumb } = useBreadcrumbExtras();

  const q = useQuery({
    queryKey: ["admin-merchant", id],
    enabled: Boolean(id),
    queryFn: () => api(`/api/v1/admin/merchants/${id}`),
  });

  useEffect(() => {
    if (!id) return;
    const m = q.data;
    setMerchantCrumb({
      id,
      label:
        m?.display_name || m?.email ? String(m.display_name || m.email) : "Merchant",
    });
    return () => setMerchantCrumb(null);
  }, [id, q.data, setMerchantCrumb]);

  if (!id) {
    return <p className="text-white/50">Missing id</p>;
  }

  if (q.isLoading) {
    return (
      <BrandLoader
        variant="page"
        title=""
        subtitle="Loading merchant…"
        aria-label="Loading merchant for edit"
      />
    );
  }

  if (q.isError || !q.data) {
    return (
      <div>
        <Link to="/control/merchants" className="text-sm text-white/60 hover:text-white">
          ← Back
        </Link>
        <p className="mt-4 text-rose-400">Merchant not found.</p>
      </div>
    );
  }

  const m = q.data;

  if (m.deleted_at) {
    return (
      <div>
        <Link to="/control/merchants" className="text-sm text-white/50 hover:text-white">
          ← Merchants
        </Link>
        <p className="mt-4 text-rose-200/90">
          This merchant is soft-deleted and cannot be edited. Open details for a
          read-only view.
        </p>
        <Link
          to={`/control/merchants/${id}`}
          className="mt-4 inline-block text-sm text-sky-300/90 hover:text-sky-200"
        >
          View merchant →
        </Link>
      </div>
    );
  }

  const chainList =
    Array.isArray(m.default_chains) && m.default_chains.length > 0
      ? m.default_chains
      : ["TRON"];
  const inferredRails = depositRailsForChains(chainList).map((o) => o.key);

  const initial = {
    display_name: m.display_name ?? "",
    default_chains: chainList,
    supported_deposit_rails:
      Array.isArray(m.supported_deposit_rails) && m.supported_deposit_rails.length > 0
        ? m.supported_deposit_rails
        : inferredRails.length > 0
          ? inferredRails
          : [railKeyFromParts(m.default_currency, m.default_network)],
    callback_url: m.callback_url ?? "",
    mdr_percent: m.mdr_percent ?? 0,
    settlement_rate_percent: m.settlement_rate_percent ?? 0,
    min_settlement_amount: m.min_settlement_amount ?? "0",
    settlement_period_days: m.settlement_period_days ?? 0,
    password: "",
    regenerate_api_key: false,
    live_gateway_enabled: m.live_gateway_enabled !== false,
    sandbox_gateway_enabled: m.sandbox_gateway_enabled !== false,
  };

  return (
    <div className="w-full max-w-none">
      <div className="mb-6">
        <Link
          to="/control/merchants"
          className="text-sm text-white/50 hover:text-white"
        >
          ← Merchants
        </Link>
      </div>
      <h1 className="font-display text-2xl font-semibold text-white">Edit merchant</h1>
      <p className="mt-1 font-mono text-sm text-white/45">{m.email}</p>
      <p className="text-xs text-white/40">
        Users — live: {m.end_users_live ?? 0}, sandbox: {m.end_users_sandbox ?? 0} · Gateway key
        hint: …{m.api_key_hint ?? "—"}
      </p>

      <div className="glass mt-8 w-full rounded-2xl p-6 lg:p-8">
        <Formik
          key={m.id}
          initialValues={initial}
          validationSchema={merchantEditSchema}
          enableReinitialize
          validateOnBlur
          validateOnChange={false}
          onSubmit={async (values, { setStatus, setSubmitting }) => {
            setStatus(undefined);
            try {
              const r = await api(`/api/v1/admin/merchants/${id}`, {
                method: "PATCH",
                json: {
                  display_name:
                    values.display_name === ""
                      ? null
                      : (values.display_name?.trim() ?? null),
                  default_chains: values.default_chains,
                  supported_deposit_rails: values.supported_deposit_rails,
                  callback_url: values.callback_url?.trim() || null,
                  password: values.password?.trim() || undefined,
                  regenerate_api_key: values.regenerate_api_key,
                  regenerate_sandbox_api_key: values.regenerate_api_key,
                  live_gateway_enabled: values.live_gateway_enabled,
                  sandbox_gateway_enabled: values.sandbox_gateway_enabled,
                  mdr_percent: values.mdr_percent,
                  settlement_rate_percent: values.settlement_rate_percent,
                  min_settlement_amount: values.min_settlement_amount?.trim() || "0",
                  settlement_period_days: values.settlement_period_days,
                },
              });
              if (r.api_key || r.sandbox_api_key) {
                setNewKeysModal({
                  ...(r.api_key ? { api_key: r.api_key } : {}),
                  ...(r.sandbox_api_key ? { sandbox_api_key: r.sandbox_api_key } : {}),
                });
              }
              void qc.invalidateQueries({ queryKey: ["admin-merchants"] });
              void qc.invalidateQueries({ queryKey: ["admin-merchant", id] });
              if (!r.api_key && !r.sandbox_api_key) setStatus("Saved.");
            } catch (e) {
              setStatus(String(e));
            } finally {
              setSubmitting(false);
            }
          }}
        >
          {({ isSubmitting, status, values }) => (
            <Form className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="lg:col-span-2">
                <span className={label}>Email</span>
                <input
                  className={`${input} cursor-not-allowed opacity-70`}
                  readOnly
                  value={m.email}
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
                  When <span className="font-mono">currency</span> /{" "}
                  <span className="font-mono">network</span> are omitted on deposit-address, the{" "}
                  <strong className="text-white/50">first</strong> rail above is used.
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
              <div>
                <label className={label} htmlFor="mdr_percent">
                  MDR (merchant transaction rate) %
                </label>
                <Field
                  id="mdr_percent"
                  name="mdr_percent"
                  type="number"
                  step="0.01"
                  min={0}
                  max={100}
                  className={input}
                />
                <ErrorMessage
                  name="mdr_percent"
                  component="p"
                  className="mt-1 text-xs text-rose-400"
                />
              </div>
              <div>
                <label className={label} htmlFor="settlement_rate_percent">
                  Settlement rate %
                </label>
                <Field
                  id="settlement_rate_percent"
                  name="settlement_rate_percent"
                  type="number"
                  step="0.01"
                  min={0}
                  max={100}
                  className={input}
                />
                <ErrorMessage
                  name="settlement_rate_percent"
                  component="p"
                  className="mt-1 text-xs text-rose-400"
                />
              </div>
              <div className="lg:col-span-2">
                <label className={label} htmlFor="min_settlement_amount">
                  Minimum settlement (token units, 0 = no minimum)
                </label>
                <Field
                  id="min_settlement_amount"
                  name="min_settlement_amount"
                  className={`${input} font-mono`}
                  autoComplete="off"
                />
                <ErrorMessage
                  name="min_settlement_amount"
                  component="p"
                  className="mt-1 text-xs text-rose-400"
                />
                <p className="mt-1 text-[10px] text-white/35">
                  Token amount (e.g. 3000), not smallest-unit integer; each chain/token uses its decimals when
                  settling.
                </p>
              </div>
              <div>
                <label className={label} htmlFor="settlement_period_days">
                  Settlement period (days)
                </label>
                <Field
                  id="settlement_period_days"
                  name="settlement_period_days"
                  type="number"
                  min={0}
                  max={3650}
                  step={1}
                  className={input}
                />
                <ErrorMessage
                  name="settlement_period_days"
                  component="p"
                  className="mt-1 text-xs text-rose-400"
                />
                <p className="mt-1 text-[10px] text-white/35">
                  0 = no hold. N &gt; 0 reserves deposits from the last N days from settlement.
                </p>
              </div>
              <div>
                <label className={label} htmlFor="password">
                  New password (optional)
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
              <div className="flex items-end pb-1 lg:col-span-2">
                <label className={`${label} flex items-center gap-2`}>
                  <Field
                    type="checkbox"
                    name="regenerate_api_key"
                    className="rounded border-white/20"
                  />
                  Regenerate gateway API key (live + sandbox use the same secret; old key stops working)
                </label>
              </div>
              <div className="flex items-end pb-1">
                <label className={`${label} flex items-center gap-2`}>
                  <Field type="checkbox" name="live_gateway_enabled" className="rounded border-white/20" />
                  Live gateway enabled (API + portal live data + settlements)
                </label>
              </div>
              <div className="flex items-end pb-1">
                <label className={`${label} flex items-center gap-2`}>
                  <Field
                    type="checkbox"
                    name="sandbox_gateway_enabled"
                    className="rounded border-white/20"
                  />
                  Sandbox gateway enabled (sandbox key + isolated test users / txs)
                </label>
              </div>
              {values.regenerate_api_key ? (
                <p className="text-xs text-amber-200/90 lg:col-span-2">
                  You will receive the new key once after save.
                </p>
              ) : null}
              {status ? (
                <p
                  className={
                    status.startsWith("Saved")
                      ? "text-sm text-emerald-400 lg:col-span-2"
                      : "text-sm text-rose-400 lg:col-span-2"
                  }
                >
                  {status}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-3 pt-2 lg:col-span-2">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="btn-primary rounded-lg px-4 py-2 text-sm"
                >
                  {isSubmitting ? "Saving…" : "Save changes"}
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

      {newKeysModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="glass w-full max-w-lg rounded-2xl p-6">
            <h3 className="text-lg font-semibold text-white">New credentials</h3>
            <p className="mt-2 text-sm text-amber-200/90">Copy now — not shown again.</p>
            {newKeysModal.api_key || newKeysModal.sandbox_api_key ? (
              <div className="mt-4">
                <p className="text-[10px] font-semibold tracking-wide text-white/40 uppercase">
                  Gateway API key (live + sandbox)
                </p>
                <p className="mt-1 break-all font-mono text-xs text-white/55">
                  {newKeysModal.api_key ?? newKeysModal.sandbox_api_key}
                </p>
              </div>
            ) : null}
            <button
              type="button"
              className="mt-6 rounded-lg bg-white/10 px-4 py-2 text-sm"
              onClick={() => {
                setNewKeysModal(null);
                nav("/control/merchants");
              }}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
