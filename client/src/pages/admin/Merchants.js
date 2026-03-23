import { Formik, Form, Field, ErrorMessage } from "formik";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import ListPaginationBar, {
  DEFAULT_LIST_PAGE_SIZE,
  LIST_PAGE_SIZE_OPTIONS,
} from "../../components/ListPaginationBar";
import {
  ListActiveFiltersChips,
  ListFilterDrawer,
  ListFilterToolbar,
  listFilterApplyButtonClass,
  listFilterInputClass,
  listFilterLabelClass,
  listFilterSecondaryButtonClass,
  listFilterChipCloseClass,
} from "../../components/ListFilterChrome";
import { merchantFilterSchema } from "../../admin/merchantSchemas";
import ConfirmModal from "../../components/ConfirmModal";

const DEFAULT_PAGE_SIZE = DEFAULT_LIST_PAGE_SIZE;

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export default function AdminMerchants() {
  const qc = useQueryClient();

  const toggleActiveMut = useMutation({
    mutationFn: async ({ id, is_active }) => {
      await api(`/api/v1/admin/merchants/${id}`, { method: "PATCH", json: { is_active } });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["admin-merchants"] });
    },
  });
  const [page, setPage] = useState(1);
  const [applied, setApplied] = useState({
    search: "",
    active: "",
    pageSize: DEFAULT_PAGE_SIZE,
  });

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [deleteModal, setDeleteModal] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const q = useQuery({
    queryKey: ["admin-merchants", page, applied.search, applied.active, applied.pageSize],
    queryFn: () => {
      const p = new URLSearchParams({ page: String(page), pageSize: String(applied.pageSize) });
      if (applied.search.trim()) p.set("search", applied.search.trim());
      if (applied.active) p.set("is_active", applied.active);
      return api(`/api/v1/admin/merchants?${p}`);
    },
  });

  const total = q.data?.total ?? 0;
  const merchants = q.data?.merchants ?? [];
  const showEmpty = !q.isLoading && merchants.length === 0;

  function resetAll() {
    setApplied({ search: "", active: "", pageSize: DEFAULT_PAGE_SIZE });
    setPage(1);
    setDrawerOpen(false);
  }

  async function confirmMerchantDelete() {
    if (!deleteModal) return;
    setDeleteError("");
    setDeleteLoading(true);
    try {
      await api(`/api/v1/admin/merchants/${deleteModal.id}`, { method: "DELETE" });
      void qc.invalidateQueries({ queryKey: ["admin-merchants"] });
      setDeleteModal(null);
    } catch (e) {
      setDeleteError(String(e));
    } finally {
      setDeleteLoading(false);
    }
  }

  const [copiedId, setCopiedId] = useState(null);

  const hasActiveFilters = Boolean(applied.search.trim() || applied.active);
  const hasNonDefaultPageSize = applied.pageSize !== DEFAULT_PAGE_SIZE;
  const hasFilterChips = hasActiveFilters || hasNonDefaultPageSize;

  const canReset = page > 1 || hasFilterChips;

  function removeSearchFilter() {
    setApplied((a) => ({ ...a, search: "" }));
    setPage(1);
  }

  function removeStatusFilter() {
    setApplied((a) => ({ ...a, active: "" }));
    setPage(1);
  }

  function removePageSizeFilter() {
    setApplied((a) => ({ ...a, pageSize: DEFAULT_PAGE_SIZE }));
    setPage(1);
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold text-white">Merchants</h1>
          <p className="mt-1 text-sm text-white/50">List, create, edit, delete (deactivates — soft delete).</p>
        </div>
        <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2">
          <Link
            to="/admin/merchants/new"
            className="rounded-xl bg-gradient-to-r from-cyan-500 to-violet-500 px-4 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-cyan-500/15"
          >
            + Create merchant
          </Link>
          <ListFilterToolbar
            onOpenDrawer={() => setDrawerOpen(true)}
            onReset={resetAll}
            canReset={canReset}
          />
        </div>
      </div>

      {hasFilterChips ? (
        <ListActiveFiltersChips>
          {applied.search.trim() ? (
            <span className="inline-flex max-w-full items-center gap-1 rounded-xl border border-cyan-400/25 bg-cyan-500/[0.12] px-2.5 py-1.5 pl-3 text-xs text-cyan-50 shadow-sm backdrop-blur-sm">
              <span className="text-[10px] font-semibold tracking-wide text-cyan-300/80 uppercase">Search</span>
              <span className="max-w-[min(280px,50vw)] truncate font-mono text-cyan-100/95" title={applied.search}>
                {applied.search}
              </span>
              <button
                type="button"
                className={listFilterChipCloseClass}
                onClick={removeSearchFilter}
                aria-label="Remove search filter"
              >
                ×
              </button>
            </span>
          ) : null}
          {applied.active === "true" ? (
            <span className="inline-flex items-center gap-1 rounded-xl border border-emerald-400/25 bg-emerald-500/[0.12] px-2.5 py-1.5 pl-3 text-xs text-emerald-50">
              <span className="text-[10px] font-semibold tracking-wide text-emerald-300/80 uppercase">Status</span>
              <span>Active only</span>
              <button
                type="button"
                className={listFilterChipCloseClass}
                onClick={removeStatusFilter}
                aria-label="Remove status filter"
              >
                ×
              </button>
            </span>
          ) : null}
          {applied.active === "false" ? (
            <span className="inline-flex items-center gap-1 rounded-xl border border-amber-400/25 bg-amber-500/[0.12] px-2.5 py-1.5 pl-3 text-xs text-amber-50">
              <span className="text-[10px] font-semibold tracking-wide text-amber-300/80 uppercase">Status</span>
              <span>Inactive only</span>
              <button
                type="button"
                className={listFilterChipCloseClass}
                onClick={removeStatusFilter}
                aria-label="Remove status filter"
              >
                ×
              </button>
            </span>
          ) : null}
          {hasNonDefaultPageSize ? (
            <span className="inline-flex items-center gap-1 rounded-xl border border-violet-400/25 bg-violet-500/[0.12] px-2.5 py-1.5 pl-3 text-xs text-violet-50">
              <span className="text-[10px] font-semibold tracking-wide text-violet-300/80 uppercase">Page size</span>
              <span className="font-mono">{applied.pageSize}</span>
              <button
                type="button"
                className={listFilterChipCloseClass}
                onClick={removePageSizeFilter}
                aria-label="Reset page size to default"
              >
                ×
              </button>
            </span>
          ) : null}
        </ListActiveFiltersChips>
      ) : null}

      <ListFilterDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        {drawerOpen ? (
          <Formik
            enableReinitialize
            initialValues={{ search: applied.search, active: applied.active }}
            validationSchema={merchantFilterSchema}
            validateOnBlur
            validateOnChange={false}
            onSubmit={(vals, { setSubmitting }) => {
              setApplied((a) => ({ ...a, search: vals.search, active: vals.active }));
              setPage(1);
              setDrawerOpen(false);
              setSubmitting(false);
            }}
          >
            {({ resetForm }) => (
              <Form className="flex min-h-0 flex-1 flex-col">
                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                  <div className="space-y-5">
                    <div>
                      <label className={listFilterLabelClass} htmlFor="flt-search">
                        Search (email / display name)
                      </label>
                      <Field
                        id="flt-search"
                        name="search"
                        className={listFilterInputClass}
                        placeholder="Type to filter…"
                      />
                      <ErrorMessage name="search" component="p" className="mt-1 text-xs text-rose-400" />
                    </div>
                    <div>
                      <label className={listFilterLabelClass} htmlFor="flt-status">
                        Status
                      </label>
                      <Field id="flt-status" name="active" as="select" className={listFilterInputClass}>
                        <option value="">All</option>
                        <option value="true">Active</option>
                        <option value="false">Inactive</option>
                      </Field>
                      <ErrorMessage name="active" component="p" className="mt-1 text-xs text-rose-400" />
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 gap-3 border-t border-white/10 px-5 py-4">
                  <button type="submit" className={listFilterApplyButtonClass}>
                    Apply
                  </button>
                  <button
                    type="button"
                    onClick={() => resetForm({ values: { search: "", active: "" } })}
                    className={listFilterSecondaryButtonClass}
                  >
                    Reset
                  </button>
                </div>
              </Form>
            )}
          </Formik>
        ) : (
          <div className="min-h-0 flex-1" />
        )}
      </ListFilterDrawer>

      <ConfirmModal
        open={Boolean(deleteModal)}
        title="Delete merchant?"
        danger
        confirmLabel="Delete"
        cancelLabel="Cancel"
        isLoading={deleteLoading}
        onCancel={() => {
          if (!deleteLoading) {
            setDeleteError("");
            setDeleteModal(null);
          }
        }}
        onConfirm={confirmMerchantDelete}
      >
        <p>
          This will <strong className="text-white/85">deactivate</strong>{" "}
          <span className="font-mono text-cyan-200/90">{deleteModal?.email}</span>. The account is not removed from the
          database; you can turn it active again with the Active switch in this list.
        </p>
        {deleteError ? <p className="mt-3 text-sm text-rose-400">{deleteError}</p> : null}
      </ConfirmModal>

      <div className="mt-10 space-y-4">
        <div className="glass overflow-hidden rounded-2xl">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-white/10 bg-white/5 text-xs text-white/50 uppercase">
              <tr>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Chains</th>
                <th className="px-4 py-3">Users</th>
                <th className="px-4 py-3">API key</th>
                <th className="px-4 py-3">Active</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {q.isLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-white/45">
                    Loading…
                  </td>
                </tr>
              ) : null}
              {showEmpty ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-white/50">
                    No record found.
                  </td>
                </tr>
              ) : null}
              {!q.isLoading &&
                merchants.map((m) => (
                <tr key={m.id} className="text-white/85">
                  <td className="px-4 py-3 font-mono text-xs">{m.email}</td>
                  <td className="max-w-[200px] px-4 py-3 text-xs text-white/75">
                    {(m.default_chains ?? []).length ? m.default_chains.join(", ") : "—"}
                  </td>
                  <td className="px-4 py-3">{m.end_users_count}</td>
                  <td className="px-4 py-3">
                    <div className="flex max-w-[min(100%,16rem)] flex-col gap-1">
                      <span className="break-all font-mono text-[10px] leading-snug text-white/55">
                        {m.api_key_hash ?? "—"}
                      </span>
                      <button
                        type="button"
                        disabled={!m.api_key_hash}
                        className="w-fit rounded border border-white/15 px-2 py-0.5 text-[11px] text-cyan-300 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-35"
                        onClick={async () => {
                          if (!m.api_key_hash) return;
                          const ok = await copyText(m.api_key_hash);
                          if (ok) {
                            setCopiedId(m.id);
                            window.setTimeout(() => setCopiedId((id) => (id === m.id ? null : id)), 2000);
                          }
                        }}
                      >
                        {copiedId === m.id ? "Copied" : "Copy"}
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={m.is_active}
                      aria-label={m.is_active ? "Active — click to deactivate" : "Inactive — click to activate"}
                      disabled={toggleActiveMut.isPending}
                      onClick={() => {
                        if (toggleActiveMut.isPending) return;
                        toggleActiveMut.mutate({ id: m.id, is_active: !m.is_active });
                      }}
                      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50 disabled:opacity-50 ${
                        m.is_active ? "bg-emerald-600/90" : "bg-white/20"
                      }`}
                    >
                      <span
                        className={`pointer-events-none absolute top-0.5 left-0.5 block h-6 w-6 rounded-full bg-white shadow transition-transform ${
                          m.is_active ? "translate-x-5" : "translate-x-0"
                        }`}
                      />
                    </button>
                    <span className="ml-2 text-xs text-white/45">{m.is_active ? "Active" : "Inactive"}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      to={`/admin/merchants/${m.id}/edit`}
                      className="mr-3 text-xs text-cyan-400 hover:underline"
                    >
                      Edit
                    </Link>
                    <button
                      type="button"
                      className="text-xs text-white/45 hover:text-rose-400 hover:underline"
                      onClick={() => {
                        setDeleteError("");
                        setDeleteModal({ id: m.id, email: m.email });
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
                ))}
            </tbody>
          </table>
        </div>

        <ListPaginationBar
          page={page}
          setPage={setPage}
          total={total}
          pageSize={applied.pageSize}
          setPageSize={(n) => setApplied((a) => ({ ...a, pageSize: n }))}
        />
      </div>
    </div>
  );
}
