import { Formik, Form, Field, ErrorMessage } from "formik";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api";
import { BrandLoader } from "../../components/BrandLoader.js";
import ConfirmModal from "../../components/ConfirmModal";
import {
  depositExplorerKeyCreateSchema,
  depositExplorerKeyEditSchema,
} from "../../admin/depositExplorerKeysSchemas";

const input =
  "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-white/20 focus:ring-1";
const label = "mb-1 block text-xs font-medium text-white/60";

/**
 * @typedef {{
 *   id: number,
 *   rail: string,
 *   name: string,
 *   api_key: string,
 *   api_key_hint: string | null,
 *   max_requests_per_day: number,
 *   max_requests_per_second: number,
 *   requests_today: number,
 *   usage_day_utc: string,
 *   sort_order: number,
 *   is_active: boolean,
 * }} ExplorerKeyRow
 */

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   keys_total: number,
 *   keys_active: number,
 * }} ExplorerRailTab
 */

export default function DepositExplorerKeys() {
  const queryClient = useQueryClient();
  const [railTab, setRailTab] = useState("");
  const [modal, setModal] = useState(
    /** @type {null | { mode: "create" } | { mode: "edit", row: ExplorerKeyRow }} */ (
      null
    ),
  );
  const [deleteTarget, setDeleteTarget] = useState(/** @type {ExplorerKeyRow | null} */ (null));
  const [formError, setFormError] = useState(/** @type {string | null} */ (null));

  const metaQuery = useQuery({
    queryKey: ["admin-deposit-explorer-key-rails"],
    queryFn: async () => {
      const j = await api("/api/v1/admin/deposit-scanner-explorer-key-rails");
      return /** @type {{ rails: ExplorerRailTab[] }} */ (j);
    },
  });

  const rails = metaQuery.data?.rails ?? [];

  useEffect(() => {
    if (!rails.length) return;
    if (!railTab || !rails.some((r) => r.id === railTab)) {
      setRailTab(rails[0].id);
    }
  }, [rails, railTab]);

  const listQuery = useQuery({
    queryKey: ["admin-deposit-explorer-keys", railTab],
    queryFn: async () => {
      const j = await api(
        `/api/v1/admin/deposit-scanner-explorer-keys?rail=${encodeURIComponent(railTab)}`,
      );
      return /** @type {{ items: ExplorerKeyRow[] }} */ (j);
    },
    enabled: Boolean(
      railTab && (metaQuery.data?.rails ?? []).some((r) => r.id === railTab),
    ),
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["admin-deposit-explorer-keys"] });
    queryClient.invalidateQueries({ queryKey: ["admin-deposit-explorer-key-rails"] });
  }, [queryClient]);

  const items = listQuery.data?.items ?? [];

  const currentRailLabel = useMemo(() => {
    const t = rails.find((r) => r.id === railTab);
    return t?.label ?? railTab;
  }, [rails, railTab]);

  const createInitial = useMemo(
    () => ({
      name: "",
      api_key: "",
      max_requests_per_day: 100000,
      max_requests_per_second: 4,
      sort_order: 0,
    }),
    [],
  );

  return (
    <div className="w-full max-w-6xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-white sm:text-2xl">
          Deposit explorer API keys
        </h1>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {metaQuery.isLoading ? (
          <div className="flex min-h-[2.5rem] items-center py-1">
            <BrandLoader />
          </div>
        ) : metaQuery.isError ? (
          <p className="text-sm text-rose-300">Could not load rails.</p>
        ) : (
          rails.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => {
                setRailTab(r.id);
                setModal(null);
              }}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                railTab === r.id
                  ? "border-indigo-400/50 bg-indigo-500/20 text-indigo-100"
                  : "border-white/10 bg-black/20 text-white/60 hover:text-white/85"
              }`}
            >
              <span>{r.label}</span>
              <span className="ml-1.5 tabular-nums text-[11px] font-normal text-white/40">
                ({r.keys_active}/{r.keys_total})
              </span>
            </button>
          ))
        )}
        <button
          type="button"
          onClick={() => {
            setFormError(null);
            setModal({ mode: "create" });
          }}
          className="ml-auto rounded-lg border border-emerald-400/30 bg-emerald-500/15 px-3 py-1.5 text-sm font-medium text-emerald-100 hover:bg-emerald-500/25"
        >
          Add key
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/20">
        {!railTab ? (
          metaQuery.isError ? (
            <p className="p-6 text-sm text-rose-300">
              Could not load rails; key list is unavailable until the server responds.
            </p>
          ) : (
            <div className="flex justify-center py-16">
              <BrandLoader />
            </div>
          )
        ) : listQuery.isLoading ? (
          <div className="flex justify-center py-16">
            <BrandLoader />
          </div>
        ) : listQuery.isError ? (
          <p className="p-6 text-sm text-rose-300">Failed to load keys.</p>
        ) : items.length === 0 ? (
          <p className="p-6 text-sm text-white/50">No keys for this rail yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-sm text-white/85">
              <thead className="border-b border-white/10 bg-black/30 text-[11px] uppercase tracking-wide text-white/45">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">API key</th>
                  <th className="px-4 py-3">Max / day</th>
                  <th className="px-4 py-3">Max / sec</th>
                  <th className="px-4 py-3">Today (UTC)</th>
                  <th className="px-4 py-3">Sort</th>
                  <th className="px-4 py-3">Active</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]"
                  >
                    <td className="px-4 py-3 font-medium text-white">{row.name}</td>
                    <td
                      className="max-w-[min(28rem,40vw)] px-4 py-3 font-mono text-[11px] leading-snug text-white/80 break-all"
                      title={row.api_key || undefined}
                    >
                      {row.api_key ? row.api_key : "—"}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{row.max_requests_per_day}</td>
                    <td className="px-4 py-3 tabular-nums">{row.max_requests_per_second}</td>
                    <td className="px-4 py-3 tabular-nums text-emerald-200/90">
                      {row.requests_today}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{row.sort_order}</td>
                    <td className="px-4 py-3">{row.is_active ? "yes" : "no"}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          setFormError(null);
                          setModal({ mode: "edit", row });
                        }}
                        className="mr-2 text-indigo-300 hover:underline"
                      >
                        Edit
                      </button>
                      {row.is_active ? (
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(row)}
                          className="text-rose-300 hover:underline"
                        >
                          Deactivate
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal?.mode === "create" ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-zinc-900 p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-white">Add explorer key</h2>
            <p className="mt-1 text-xs text-white/50">
              Rail: <span className="font-mono text-white/70">{currentRailLabel}</span>{" "}
              <span className="text-white/40">({railTab})</span> — switch with tabs above before saving.
            </p>
            <Formik
              initialValues={createInitial}
              validationSchema={depositExplorerKeyCreateSchema}
              enableReinitialize
              onSubmit={async (values, { setSubmitting, resetForm }) => {
                setFormError(null);
                try {
                  await api("/api/v1/admin/deposit-scanner-explorer-keys", {
                    method: "POST",
                    json: {
                      rail: railTab,
                      name: values.name.trim(),
                      api_key: values.api_key.trim(),
                      max_requests_per_day: Number(values.max_requests_per_day),
                      max_requests_per_second: Number(values.max_requests_per_second),
                      sort_order: Number(values.sort_order),
                    },
                  });
                  resetForm();
                  setModal(null);
                  invalidate();
                } catch (e) {
                  setFormError(e instanceof Error ? e.message : String(e));
                } finally {
                  setSubmitting(false);
                }
              }}
            >
              {({ isSubmitting }) => (
                <Form className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div className="lg:col-span-2">
                    <label className={label} htmlFor="ek-name">
                      Name
                    </label>
                    <Field id="ek-name" name="name" className={input} autoComplete="off" />
                    <ErrorMessage name="name" component="p" className="mt-1 text-xs text-rose-400" />
                  </div>
                  <div className="lg:col-span-2">
                    <label className={label} htmlFor="ek-key">
                      API key
                    </label>
                    <Field
                      id="ek-key"
                      name="api_key"
                      type="password"
                      className={input}
                      autoComplete="off"
                    />
                    <ErrorMessage
                      name="api_key"
                      component="p"
                      className="mt-1 text-xs text-rose-400"
                    />
                  </div>
                  <div>
                    <label className={label} htmlFor="ek-day">
                      Max requests / day (UTC)
                    </label>
                    <Field id="ek-day" name="max_requests_per_day" className={input} />
                    <ErrorMessage
                      name="max_requests_per_day"
                      component="p"
                      className="mt-1 text-xs text-rose-400"
                    />
                  </div>
                  <div>
                    <label className={label} htmlFor="ek-sec">
                      Max requests / second
                    </label>
                    <Field id="ek-sec" name="max_requests_per_second" className={input} />
                    <ErrorMessage
                      name="max_requests_per_second"
                      component="p"
                      className="mt-1 text-xs text-rose-400"
                    />
                  </div>
                  <div className="lg:col-span-2">
                    <label className={label} htmlFor="ek-sort">
                      Sort order (lower first)
                    </label>
                    <Field id="ek-sort" name="sort_order" className={input} />
                    <ErrorMessage
                      name="sort_order"
                      component="p"
                      className="mt-1 text-xs text-rose-400"
                    />
                  </div>
                  {formError ? (
                    <p className="lg:col-span-2 text-sm text-rose-300">{formError}</p>
                  ) : null}
                  <div className="flex flex-wrap gap-2 lg:col-span-2">
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setModal(null)}
                      className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/80 hover:bg-white/5"
                    >
                      Cancel
                    </button>
                  </div>
                </Form>
              )}
            </Formik>
          </div>
        </div>
      ) : null}

      {modal?.mode === "edit" && modal.row ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-zinc-900 p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-white">Edit key</h2>
            <Formik
              initialValues={{
                name: modal.row.name,
                api_key: modal.row.api_key ?? "",
                max_requests_per_day: modal.row.max_requests_per_day,
                max_requests_per_second: modal.row.max_requests_per_second,
                sort_order: modal.row.sort_order,
                is_active: modal.row.is_active,
              }}
              validationSchema={depositExplorerKeyEditSchema}
              enableReinitialize
              onSubmit={async (values, { setSubmitting }) => {
                setFormError(null);
                try {
                  const patch = {
                    name: values.name.trim(),
                    max_requests_per_day: Number(values.max_requests_per_day),
                    max_requests_per_second: Number(values.max_requests_per_second),
                    sort_order: Number(values.sort_order),
                    is_active: values.is_active,
                  };
                  const initialKey = String(modal.row.api_key ?? "").trim();
                  const nextKey = String(values.api_key ?? "").trim();
                  if (nextKey && nextKey !== initialKey) {
                    patch.api_key = nextKey;
                  }
                  await api(`/api/v1/admin/deposit-scanner-explorer-keys/${modal.row.id}`, {
                    method: "PATCH",
                    json: patch,
                  });
                  setModal(null);
                  invalidate();
                } catch (e) {
                  setFormError(e instanceof Error ? e.message : String(e));
                } finally {
                  setSubmitting(false);
                }
              }}
            >
              {({ isSubmitting, values }) => (
                <Form className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <p className="text-xs text-white/45 lg:col-span-2">
                    Rail <span className="font-mono text-white/70">{modal.row.rail}</span>
                  </p>
                  <div className="lg:col-span-2">
                    <label className={label} htmlFor="ek2-name">
                      Name
                    </label>
                    <Field id="ek2-name" name="name" className={input} />
                    <ErrorMessage name="name" component="p" className="mt-1 text-xs text-rose-400" />
                  </div>
                  <div className="lg:col-span-2">
                    <label className={label} htmlFor="ek2-key">
                      API key
                    </label>
                    <Field
                      id="ek2-key"
                      name="api_key"
                      type="text"
                      className={`${input} font-mono text-xs`}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <p className="mt-1 text-[11px] text-white/40">
                      Change this field only when rotating the key; other edits save without updating
                      the key.
                    </p>
                  </div>
                  <div>
                    <label className={label} htmlFor="ek2-day">
                      Max / day
                    </label>
                    <Field id="ek2-day" name="max_requests_per_day" className={input} />
                    <ErrorMessage
                      name="max_requests_per_day"
                      component="p"
                      className="mt-1 text-xs text-rose-400"
                    />
                  </div>
                  <div>
                    <label className={label} htmlFor="ek2-sec">
                      Max / sec
                    </label>
                    <Field id="ek2-sec" name="max_requests_per_second" className={input} />
                    <ErrorMessage
                      name="max_requests_per_second"
                      component="p"
                      className="mt-1 text-xs text-rose-400"
                    />
                  </div>
                  <div className="lg:col-span-2">
                    <label className={label} htmlFor="ek2-sort">
                      Sort order
                    </label>
                    <Field id="ek2-sort" name="sort_order" className={input} />
                    <ErrorMessage
                      name="sort_order"
                      component="p"
                      className="mt-1 text-xs text-rose-400"
                    />
                  </div>
                  <div className="lg:col-span-2 flex items-center gap-2">
                    <Field
                      id="ek2-active"
                      name="is_active"
                      type="checkbox"
                      className="h-4 w-4 rounded border-white/20 bg-black/40 text-indigo-500"
                    />
                    <label htmlFor="ek2-active" className="text-sm text-white/80">
                      Active (use in deposit scan pool)
                    </label>
                  </div>
                  {formError ? (
                    <p className="lg:col-span-2 text-sm text-rose-300">{formError}</p>
                  ) : null}
                  <div className="flex flex-wrap gap-2 lg:col-span-2">
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setModal(null)}
                      className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/80 hover:bg-white/5"
                    >
                      Cancel
                    </button>
                  </div>
                </Form>
              )}
            </Formik>
          </div>
        </div>
      ) : null}

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="Deactivate explorer key?"
        danger
        confirmLabel="Deactivate"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await api(`/api/v1/admin/deposit-scanner-explorer-keys/${deleteTarget.id}`, {
            method: "DELETE",
          });
          setDeleteTarget(null);
          invalidate();
        }}
      >
        {deleteTarget ? (
          <p className="text-sm text-white/75">
            {deleteTarget.name} will no longer be used for deposit scans. You can reactivate from
            Edit.
          </p>
        ) : null}
      </ConfirmModal>
    </div>
  );
}
