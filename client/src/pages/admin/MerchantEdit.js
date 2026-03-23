import { Formik, Form, Field, ErrorMessage } from "formik";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api";
import { merchantEditSchema } from "../../admin/merchantSchemas";
import ChainMultiSelectField from "../../components/ChainMultiSelectField";
import DepositRailsMultiSelectField from "../../components/DepositRailsMultiSelectField";
import { depositRailsForChains, railKeyFromParts } from "../../admin/depositRailOptions.js";

const input =
  "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-cyan-500/30 focus:ring-1";
const label = "mb-1 block text-xs font-medium text-white/60";

export default function MerchantEdit() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [newKeyModal, setNewKeyModal] = useState(null);

  const q = useQuery({
    queryKey: ["admin-merchant", id],
    enabled: Boolean(id),
    queryFn: () => api(`/api/v1/admin/merchants/${id}`),
  });

  if (!id) {
    return <p className="text-white/50">Missing id</p>;
  }

  if (q.isLoading) {
    return <p className="text-white/50">Loading…</p>;
  }

  if (q.isError || !q.data) {
    return (
      <div>
        <Link to="/admin/merchants" className="text-sm text-cyan-400">
          ← Back
        </Link>
        <p className="mt-4 text-rose-400">Merchant not found.</p>
      </div>
    );
  }

  const m = q.data;

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
    password: "",
    regenerate_api_key: false,
  };

  return (
    <div className="w-full max-w-none">
      <div className="mb-6">
        <Link
          to="/admin/merchants"
          className="text-sm text-white/50 hover:text-cyan-400"
        >
          ← Merchants
        </Link>
      </div>
      <h1 className="text-2xl font-semibold text-white">Edit merchant</h1>
      <p className="mt-1 font-mono text-sm text-white/45">{m.email}</p>
      <p className="text-xs text-white/40">
        Users: {m.end_users_count} · API key hint: …{m.api_key_hint ?? "—"}
      </p>

      <div className="glass glow-border mt-8 w-full rounded-2xl p-6 lg:p-8">
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
                },
              });
              if (r.api_key) setNewKeyModal(r.api_key);
              void qc.invalidateQueries({ queryKey: ["admin-merchants"] });
              void qc.invalidateQueries({ queryKey: ["admin-merchant", id] });
              if (!r.api_key) setStatus("Saved.");
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
              <div className="flex items-end pb-1">
                <label className={`${label} flex items-center gap-2`}>
                  <Field
                    type="checkbox"
                    name="regenerate_api_key"
                    className="rounded border-white/20"
                  />
                  Regenerate API key (old key stops working)
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
                  className="rounded-lg bg-cyan-500/90 px-4 py-2 text-sm font-medium text-slate-950 disabled:opacity-50"
                >
                  {isSubmitting ? "Saving…" : "Save changes"}
                </button>
                <Link
                  to="/admin/merchants"
                  className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/70"
                >
                  Cancel
                </Link>
              </div>
            </Form>
          )}
        </Formik>
      </div>

      {newKeyModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="glass w-full max-w-lg rounded-2xl p-6">
            <h3 className="text-lg font-semibold text-white">New API key</h3>
            <p className="mt-3 break-all font-mono text-xs text-cyan-300">
              {newKeyModal}
            </p>
            <button
              type="button"
              className="mt-6 rounded-lg bg-white/10 px-4 py-2 text-sm"
              onClick={() => {
                setNewKeyModal(null);
                nav("/admin/merchants");
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
