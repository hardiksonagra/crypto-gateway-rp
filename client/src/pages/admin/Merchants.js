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

function PencilIcon({ className }) {
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
        d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"
      />
    </svg>
  );
}

function TrashIcon({ className }) {
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
        d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
      />
    </svg>
  );
}

export default function AdminMerchants() {
  const qc = useQueryClient();

  const toggleActiveMut = useMutation({
    mutationFn: async ({ id, is_active }) => {
      await api(`/api/v1/admin/merchants/${id}`, {
        method: "PATCH",
        json: { is_active },
      });
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
    queryKey: [
      "admin-merchants",
      page,
      applied.search,
      applied.active,
      applied.pageSize,
    ],
    queryFn: () => {
      const p = new URLSearchParams({
        page: String(page),
        pageSize: String(applied.pageSize),
      });
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
      await api(`/api/v1/admin/merchants/${deleteModal.id}`, {
        method: "DELETE",
      });
      void qc.invalidateQueries({ queryKey: ["admin-merchants"] });
      setDeleteModal(null);
    } catch (e) {
      setDeleteError(String(e));
    } finally {
      setDeleteLoading(false);
    }
  }

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
          <h1 className="font-display text-2xl font-semibold text-white">Merchants</h1>
          <p className="mt-1 text-sm text-white/50">
            List, create, edit, delete (deactivates — soft delete).
          </p>
        </div>
        <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2">
          <Link
            to="/admin/merchants/new"
            className="btn-primary rounded-xl px-4 py-2.5 text-sm"
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
            <span className="filter-chip max-w-full">
              <span className="filter-chip-label">Search</span>
              <span
                className="max-w-[min(280px,50vw)] truncate font-mono text-white/65"
                title={applied.search}
              >
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
            <span className="filter-chip">
              <span className="filter-chip-label">Status</span>
              <span className="text-white/70">Active only</span>
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
            <span className="filter-chip">
              <span className="filter-chip-label">Status</span>
              <span className="text-white/70">Inactive only</span>
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
            <span className="filter-chip">
              <span className="filter-chip-label">Page size</span>
              <span className="font-mono text-white/65">{applied.pageSize}</span>
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
              setApplied((a) => ({
                ...a,
                search: vals.search,
                active: vals.active,
              }));
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
                      <label
                        className={listFilterLabelClass}
                        htmlFor="flt-search"
                      >
                        Search (email / display name)
                      </label>
                      <Field
                        id="flt-search"
                        name="search"
                        className={listFilterInputClass}
                        placeholder="Type to filter…"
                      />
                      <ErrorMessage
                        name="search"
                        component="p"
                        className="mt-1 text-xs text-rose-400"
                      />
                    </div>
                    <div>
                      <label
                        className={listFilterLabelClass}
                        htmlFor="flt-status"
                      >
                        Status
                      </label>
                      <Field
                        id="flt-status"
                        name="active"
                        as="select"
                        className={listFilterInputClass}
                      >
                        <option value="">All</option>
                        <option value="true">Active</option>
                        <option value="false">Inactive</option>
                      </Field>
                      <ErrorMessage
                        name="active"
                        component="p"
                        className="mt-1 text-xs text-rose-400"
                      />
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 gap-3 border-t border-white/10 px-5 py-4">
                  <button type="submit" className={listFilterApplyButtonClass}>
                    Apply
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      resetForm({ values: { search: "", active: "" } })
                    }
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
          <span className="font-mono text-white/70">
            {deleteModal?.email}
          </span>
          . The account is not removed from the database; you can turn it active
          again with the Active switch in this list.
        </p>
        {deleteError ? (
          <p className="mt-3 text-sm text-rose-400">{deleteError}</p>
        ) : null}
      </ConfirmModal>

      <div className="mt-10 space-y-4">
        <div className="data-table-surface">
          <table className="data-table min-w-[720px]">
            <thead>
              <tr>
                <th>Email</th>
                <th>Chains</th>
                <th>Rails</th>
                <th>Users</th>
                <th>Active</th>
                <th className="w-[1%] whitespace-nowrap text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {q.isLoading ? (
                <tr>
                  <td colSpan={6} className="!py-12 text-center text-sm text-white/40">
                    Loading…
                  </td>
                </tr>
              ) : null}
              {showEmpty ? (
                <tr>
                  <td colSpan={6} className="!py-12 text-center text-sm text-white/45">
                    No record found.
                  </td>
                </tr>
              ) : null}
              {!q.isLoading &&
                merchants.map((m) => (
                  <tr key={m.id}>
                    <td className="font-mono text-xs text-white/80">{m.email}</td>
                    <td className="max-w-[200px] text-xs text-white/55">
                      {(m.default_chains ?? []).length
                        ? m.default_chains.join(", ")
                        : "—"}
                    </td>
                    <td className="max-w-[240px] font-mono text-[11px] leading-snug text-white/50">
                      {m.supported_deposit_rails?.length
                        ? m.supported_deposit_rails
                            .map((k) => k.split("|").join(" · "))
                            .join(", ")
                        : m.default_currency && m.default_network
                          ? `${m.default_currency} · ${m.default_network} (all on chains)`
                          : "—"}
                    </td>
                    <td>{m.end_users_count}</td>
                    <td>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={m.is_active}
                        aria-label={
                          m.is_active
                            ? "Active — click to deactivate"
                            : "Inactive — click to activate"
                        }
                        disabled={toggleActiveMut.isPending}
                        onClick={() => {
                          if (toggleActiveMut.isPending) return;
                          toggleActiveMut.mutate({
                            id: m.id,
                            is_active: !m.is_active,
                          });
                        }}
                        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/25 disabled:opacity-50 ${
                          m.is_active ? "bg-emerald-600/90" : "bg-white/20"
                        }`}
                      >
                        <span
                          className={`pointer-events-none absolute top-0.5 left-0.5 block h-6 w-6 rounded-full bg-white shadow transition-transform ${
                            m.is_active ? "translate-x-5" : "translate-x-0"
                          }`}
                        />
                      </button>
                      <span className="ml-2 text-xs text-white/45">
                        {m.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap">
                      <div className="flex shrink-0 flex-nowrap items-center justify-end gap-1.5">
                        <Link
                          to={`/admin/merchants/${m.id}/edit`}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-white/12 bg-white/5 px-2.5 py-1.5 text-xs font-medium text-white/75 transition-colors hover:border-white/20 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                        >
                          <PencilIcon className="h-3.5 w-3.5 shrink-0 opacity-90" />
                          Edit
                        </Link>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-white/12 bg-white/[0.06] px-2.5 py-1.5 text-xs font-medium text-white/60 shadow-sm backdrop-blur-sm transition-colors hover:border-rose-400/40 hover:bg-rose-500/12 hover:text-rose-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/35"
                          onClick={() => {
                            setDeleteError("");
                            setDeleteModal({ id: m.id, email: m.email });
                          }}
                        >
                          <TrashIcon className="h-3.5 w-3.5 shrink-0 opacity-90" />
                          Delete
                        </button>
                      </div>
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
