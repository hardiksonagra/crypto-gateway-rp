import { Formik, Form, Field, ErrorMessage } from "formik";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import * as yup from "yup";
import { api } from "../../api";
import ConfirmModal from "../../components/ConfirmModal";
import { BrandLoader } from "../../components/BrandLoader.js";

const createSchema = yup.object({
  merchant_id: yup.mixed().test("merchant", "Select a merchant", (v) => {
    const n = parseInt(String(v ?? ""), 10);
    return Number.isInteger(n) && n >= 1;
  }),
  tron_address: yup
    .string()
    .trim()
    .required("TRON address is required")
    .matches(/^T[1-9A-HJ-NP-Za-km-z]{33}$/, "Enter a valid TRON address (T…)"),
  min_amount_human: yup
    .string()
    .trim()
    .required("Min amount is required")
    .test("min-dec", "Use a non-negative number (e.g. 2000)", (v) => {
      if (v == null || v === "") return false;
      const n = Number(v);
      return Number.isFinite(n) && n >= 0;
    }),
});

const editSchema = yup.object({
  tron_address: yup
    .string()
    .trim()
    .required("TRON address is required")
    .matches(/^T[1-9A-HJ-NP-Za-km-z]{33}$/, "Enter a valid TRON address (T…)"),
  min_amount_human: yup
    .string()
    .trim()
    .required("Min amount is required")
    .test("min-dec", "Use a non-negative number", (v) => {
      if (v == null || v === "") return false;
      const n = Number(v);
      return Number.isFinite(n) && n >= 0;
    }),
});

/** @param {string} status */
function statusClass(status) {
  switch (status) {
    case "completed":
      return "text-emerald-300/90";
    case "failed":
      return "text-rose-300/90";
    case "skipped":
      return "text-amber-200/80";
    case "transferring":
    case "funding_trx":
      return "text-sky-300/90";
    default:
      return "text-white/55";
  }
}

/**
 * Create or edit swap config in a modal.
 *
 * @param {{
 *   open: boolean,
 *   mode: "create" | "edit",
 *   editRow: object | null,
 *   merchantOptions: { id: number, email: string, display_name?: string | null }[],
 *   onClose: () => void,
 *   onSaved: () => void,
 * }} props
 */
function ConfigFormModal({ open, mode, editRow, merchantOptions, onClose, onSaved }) {
  const createMut = useMutation({
    mutationFn: (body) =>
      api("/api/v1/rp/swap-configs", { method: "POST", json: body }),
  });
  const patchMut = useMutation({
    mutationFn: ({ id, body }) =>
      api(`/api/v1/rp/swap-configs/${id}`, { method: "PATCH", json: body }),
  });

  if (!open) return null;

  const isEdit = mode === "edit" && editRow;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rp-swap-config-form-title"
    >
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-white/15 bg-[#12141c] shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
          <h2 id="rp-swap-config-form-title" className="text-lg font-semibold text-white">
            {isEdit ? "Edit swap config" : "Create swap config"}
          </h2>
          <button
            type="button"
            className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:bg-white/5"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <Formik
          enableReinitialize
          initialValues={
            isEdit
              ? {
                  merchant_id: String(editRow.merchant_id),
                  tron_address: editRow.tron_address ?? "",
                  min_amount_human: editRow.min_amount_human ?? "2000",
                }
              : {
                  merchant_id: "",
                  tron_address: "",
                  min_amount_human: "2000",
                }
          }
          validationSchema={isEdit ? editSchema : createSchema}
          validateOnBlur
          validateOnChange={false}
          onSubmit={async (values, { setStatus, setSubmitting }) => {
            setStatus(undefined);
            try {
              if (isEdit) {
                await patchMut.mutateAsync({
                  id: editRow.id,
                  body: {
                    tron_address: String(values.tron_address).trim(),
                    min_amount_human: String(values.min_amount_human).trim(),
                  },
                });
              } else {
                await createMut.mutateAsync({
                  merchant_id: Number(values.merchant_id),
                  tron_address: String(values.tron_address).trim(),
                  min_amount_human: String(values.min_amount_human).trim(),
                });
              }
              onSaved();
              onClose();
            } catch (e) {
              setStatus(String(e?.message ?? e));
            } finally {
              setSubmitting(false);
            }
          }}
        >
          {({ isSubmitting, status }) => (
            <Form className="grid grid-cols-1 gap-4 px-5 py-4">
              {isEdit ? (
                <div>
                  <p className="text-xs text-white/45">Merchant</p>
                  <p className="mt-1 text-sm text-white/85">
                    {editRow.merchant_display_name || "—"}
                  </p>
                  <p className="font-mono text-xs text-white/45">
                    {editRow.merchant_email} · #{editRow.merchant_id}
                  </p>
                </div>
              ) : (
                <div>
                  <label className="text-xs text-white/50" htmlFor="modal_merchant_id">
                    Merchant
                  </label>
                  <Field
                    as="select"
                    id="modal_merchant_id"
                    name="merchant_id"
                    className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
                  >
                    <option value="">Select merchant…</option>
                    {merchantOptions.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.display_name ? `${m.display_name} · ` : ""}
                        {m.email} (#{m.id})
                      </option>
                    ))}
                  </Field>
                  <ErrorMessage
                    name="merchant_id"
                    component="p"
                    className="mt-1 text-xs text-rose-400"
                  />
                  {merchantOptions.length === 0 ? (
                    <p className="mt-1 text-xs text-white/40">
                      No merchants left without a swap config (or none assigned to you).
                    </p>
                  ) : null}
                </div>
              )}

              <div>
                <label className="text-xs text-white/50" htmlFor="modal_min_amount">
                  Min amount (USDT)
                </label>
                <Field
                  id="modal_min_amount"
                  name="min_amount_human"
                  type="text"
                  inputMode="decimal"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
                  placeholder="2000"
                />
                <ErrorMessage
                  name="min_amount_human"
                  component="p"
                  className="mt-1 text-xs text-rose-400"
                />
              </div>

              <div>
                <label className="text-xs text-white/50" htmlFor="modal_tron_address">
                  Main wallet TRON address
                </label>
                <Field
                  id="modal_tron_address"
                  name="tron_address"
                  type="text"
                  autoComplete="off"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm"
                  placeholder="T…"
                />
                <p className="mt-1 text-xs text-white/40">
                  Prefer a gateway USDT·TRC20 deposit wallet for this merchant so TRX fee top-ups can
                  be signed.
                </p>
                <ErrorMessage
                  name="tron_address"
                  component="p"
                  className="mt-1 text-xs text-rose-400"
                />
              </div>

              {status ? <p className="text-sm text-rose-400">{status}</p> : null}

              <div className="flex flex-wrap justify-end gap-3 border-t border-white/10 pt-4">
                <button
                  type="button"
                  className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/70 hover:bg-white/5"
                  onClick={onClose}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    isSubmitting || (!isEdit && merchantOptions.length === 0)
                  }
                  className="btn-primary rounded-lg px-4 py-2 text-sm"
                >
                  {isSubmitting ? "Saving…" : isEdit ? "Save changes" : "Create record"}
                </button>
              </div>
            </Form>
          )}
        </Formik>
      </div>
    </div>,
    document.body,
  );
}

/**
 * @param {{
 *   open: boolean,
 *   config: { id: number, merchant_display_name?: string | null, merchant_email?: string | null, merchant_id: number, tron_address: string, min_amount_human: string } | null,
 *   onClose: () => void,
 * }} props
 */
function SwapRunModal({ open, config, onClose }) {
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [job, setJob] = useState(null);
  const [runError, setRunError] = useState(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!open || !config) {
      setPreview(null);
      setPreviewError(null);
      setJob(null);
      setRunError(null);
      return;
    }
    let cancelled = false;
    setLoadingPreview(true);
    setPreviewError(null);
    setJob(null);
    setRunError(null);
    api(`/api/v1/rp/swap-configs/${config.id}/preview`)
      .then((p) => {
        if (!cancelled) setPreview(p);
      })
      .catch((e) => {
        if (!cancelled) setPreviewError(String(e?.message ?? e));
      })
      .finally(() => {
        if (!cancelled) setLoadingPreview(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, config]);

  useEffect(() => {
    if (!job?.running) return undefined;
    const t = window.setInterval(() => {
      api("/api/v1/rp/swap-runs/current")
        .then((j) => setJob(j))
        .catch(() => {});
    }, 1500);
    return () => window.clearInterval(t);
  }, [job?.running]);

  if (!open || !config) return null;

  const wallets = job?.wallets ?? preview?.wallets ?? [];
  const logs = job?.logs ?? [];
  const running = Boolean(job?.running);
  const canSubmit =
    !loadingPreview &&
    !previewError &&
    preview &&
    preview.wallet_count > 0 &&
    !running &&
    !starting;

  async function handleSubmit() {
    setStarting(true);
    setRunError(null);
    try {
      const j = await api(`/api/v1/rp/swap-configs/${config.id}/run`, {
        method: "POST",
        json: {},
      });
      setJob(j);
    } catch (e) {
      setRunError(String(e?.message ?? e));
    } finally {
      setStarting(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rp-swap-run-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#12141c] shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div>
            <h2 id="rp-swap-run-title" className="text-lg font-semibold text-white">
              Swap to main wallet
            </h2>
            <p className="mt-1 text-xs text-white/50">
              {config.merchant_display_name || config.merchant_email} · #{config.merchant_id}
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:bg-white/5"
            onClick={onClose}
            disabled={running}
          >
            Close
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/[0.06] px-4 py-3 text-sm text-white/70">
            <p>
              <span className="text-white/45">Main wallet · </span>
              <span className="break-all font-mono text-emerald-100/90">
                {config.tron_address}
              </span>
            </p>
            <p className="mt-2 text-xs text-white/50">
              USDT moves here. If a deposit wallet needs TRX for fees, TRX is topped up{" "}
              <strong className="text-white/70">from this same main wallet</strong>, then USDT is
              transferred. Min threshold:{" "}
              <span className="font-mono text-white/80">{config.min_amount_human}</span> USDT
              (balance must be greater than min).
            </p>
          </div>

          {loadingPreview ? (
            <BrandLoader
              variant="section"
              title=""
              subtitle="Scanning wallets…"
              aria-label="Loading swap preview"
            />
          ) : null}
          {previewError ? (
            <p className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              {previewError}
            </p>
          ) : null}
          {runError ? (
            <p className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              {runError}
            </p>
          ) : null}

          {preview && !loadingPreview ? (
            <p className="text-sm text-white/60">
              <strong className="text-white/85">{preview.wallet_count}</strong> wallet(s) · total{" "}
              <strong className="font-mono text-white/85">{preview.total_usdt_decimal}</strong> USDT
              {job?.running ? (
                <span className="ml-2 text-sky-300/90">
                  · running {job.processed}/{job.total}
                </span>
              ) : null}
              {job && !job.running && job.finished_at ? (
                <span className="ml-2 text-emerald-300/80">· finished</span>
              ) : null}
            </p>
          ) : null}

          <div className="data-table-surface">
            <table className="data-table text-xs">
              <thead>
                <tr>
                  <th>Wallet</th>
                  <th>USDT</th>
                  <th>Status</th>
                  <th>Detail / tx</th>
                </tr>
              </thead>
              <tbody>
                {wallets.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-white/45">
                      {preview && !loadingPreview
                        ? "No wallets above the minimum (excluding main wallet)."
                        : "—"}
                    </td>
                  </tr>
                ) : (
                  wallets.map((w) => (
                    <tr key={w.wallet_id}>
                      <td className="break-all font-mono text-white/80">{w.address}</td>
                      <td className="font-mono">{w.usdt_decimal}</td>
                      <td className={statusClass(w.status)}>{w.status}</td>
                      <td className="max-w-xs break-all text-white/50">
                        {w.message || "—"}
                        {w.tx_hash ? (
                          <div className="mt-0.5 font-mono text-[10px] text-white/40">
                            {w.tx_hash}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-white/40">
              Live log
            </p>
            <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-[11px] leading-relaxed text-white/55">
              {logs.length === 0 ? (
                <p className="text-white/35">Logs appear here when you submit.</p>
              ) : (
                logs.map((l, i) => (
                  <div
                    key={`${l.at}-${i}`}
                    className={
                      l.level === "error"
                        ? "text-rose-300/90"
                        : l.level === "warn"
                          ? "text-amber-200/80"
                          : ""
                    }
                  >
                    <span className="text-white/30">{new Date(l.at).toLocaleTimeString()}</span>{" "}
                    {l.message}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-white/10 px-5 py-4">
          <button
            type="button"
            className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/70 hover:bg-white/5"
            onClick={onClose}
            disabled={running}
          >
            {job?.finished_at ? "Done" : "Cancel"}
          </button>
          <button
            type="button"
            className="btn-primary rounded-lg px-4 py-2 text-sm disabled:opacity-40"
            disabled={!canSubmit || starting}
            onClick={handleSubmit}
          >
            {starting || running ? "Running…" : "Submit swap"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default function RpSwap() {
  const qc = useQueryClient();
  const [deleteId, setDeleteId] = useState(null);
  const [formModal, setFormModal] = useState(
    /** @type {null | { mode: "create" } | { mode: "edit", row: object }} */ (null),
  );
  const [swapConfig, setSwapConfig] = useState(null);

  const configsQ = useQuery({
    queryKey: ["rp", "swap-configs"],
    queryFn: () => api("/api/v1/rp/swap-configs"),
  });

  const merchantsQ = useQuery({
    queryKey: ["rp", "merchants", "swap-picker"],
    queryFn: () => api("/api/v1/rp/merchants?page=1&page_size=200&is_active=true"),
  });

  const items = configsQ.data?.items ?? [];
  const configuredIds = useMemo(
    () => new Set(items.map((r) => r.merchant_id)),
    [items],
  );

  const merchantOptions = useMemo(() => {
    const rows = merchantsQ.data?.merchants ?? [];
    return rows.filter((m) => !configuredIds.has(m.id) && !m.deleted_at);
  }, [merchantsQ.data, configuredIds]);

  const deleteMut = useMutation({
    mutationFn: (id) => api(`/api/v1/rp/swap-configs/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setDeleteId(null);
      qc.invalidateQueries({ queryKey: ["rp", "swap-configs"] });
    },
  });

  if (configsQ.isLoading || merchantsQ.isLoading) {
    return (
      <BrandLoader
        variant="section"
        title=""
        subtitle="Loading swap configs…"
        aria-label="Loading swap configs"
      />
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-white">Swap</h1>
          <p className="mt-2 max-w-3xl text-sm text-white/55">
            One record per merchant: main TRON wallet + min USDT. Use{" "}
            <strong className="text-white/75">Swap</strong> to consolidate deposit wallets here.
            Live TRON payouts send only from this main wallet (not the platform hot wallet) — without
            a config they fail asking RP to set Swap first. Keep a little TRX on the main wallet for
            fees (or a TRX funder key / spare USDT for SunSwap).
          </p>
        </div>
        <button
          type="button"
          className="btn-primary shrink-0 rounded-lg px-4 py-2 text-sm"
          onClick={() => setFormModal({ mode: "create" })}
        >
          Create record
        </button>
      </div>

      <div className="mt-8">
        <h2 className="text-sm font-semibold text-white/80">Swap configs</h2>
        <div className="data-table-surface mt-3">
          <table className="data-table text-sm">
            <thead>
              <tr>
                <th>Merchant</th>
                <th>TRON address</th>
                <th>Min (USDT)</th>
                <th>Created</th>
                <th className="w-52">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-white/45">
                    No swap records yet. Use <strong className="text-white/70">Create record</strong>.
                  </td>
                </tr>
              ) : (
                items.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div className="font-medium text-white/90">
                        {row.merchant_display_name || "—"}
                      </div>
                      <div className="font-mono text-xs text-white/45">
                        {row.merchant_email} · #{row.merchant_id}
                      </div>
                    </td>
                    <td className="break-all font-mono text-xs text-white/80">
                      {row.tron_address}
                    </td>
                    <td>{row.min_amount_human}</td>
                    <td className="whitespace-nowrap text-xs text-white/50">
                      {new Date(row.created_at).toLocaleString()}
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="rounded-md border border-emerald-400/35 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-100/90 hover:bg-emerald-500/20"
                          onClick={() => setSwapConfig(row)}
                        >
                          Swap
                        </button>
                        <button
                          type="button"
                          className="rounded-md border border-white/15 px-2 py-1 text-xs text-white/80 hover:bg-white/5"
                          onClick={() => setFormModal({ mode: "edit", row })}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="rounded-md border border-rose-400/30 px-2 py-1 text-xs text-rose-200/90 hover:bg-rose-500/10"
                          onClick={() => setDeleteId(row.id)}
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ConfigFormModal
        open={formModal != null}
        mode={formModal?.mode === "edit" ? "edit" : "create"}
        editRow={formModal?.mode === "edit" ? formModal.row : null}
        merchantOptions={merchantOptions}
        onClose={() => setFormModal(null)}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["rp", "swap-configs"] });
        }}
      />

      <SwapRunModal
        open={swapConfig != null}
        config={swapConfig}
        onClose={() => setSwapConfig(null)}
      />

      <ConfirmModal
        open={deleteId != null}
        title="Remove swap config?"
        confirmLabel="Remove"
        danger
        isLoading={deleteMut.isPending}
        onCancel={() => setDeleteId(null)}
        onConfirm={() => {
          if (deleteId != null) deleteMut.mutate(deleteId);
        }}
      >
        <p className="text-sm text-white/60">
          This merchant can receive a new swap record after removal. On-chain sweep is not run by this
          action.
        </p>
      </ConfirmModal>
    </div>
  );
}
