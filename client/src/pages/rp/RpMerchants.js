import { Formik, Form, Field, ErrorMessage } from "formik";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, getToken, setImpersonationRpToken, setToken } from "../../api";
import ListPaginationBar, { DEFAULT_LIST_PAGE_SIZE } from "../../components/ListPaginationBar";
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
import { StatusBadge } from "../../components/StatusBadge.js";
import { BrandLoader } from "../../components/BrandLoader.js";

const DEFAULT_PAGE_SIZE = DEFAULT_LIST_PAGE_SIZE;

function DotsVerticalIcon({ className }) {
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
        d="M12 6.75a.75.75 0 0 1 0-1.5.75.75 0 0 1 0 1.5ZM12 12.75a.75.75 0 0 1 0-1.5.75.75 0 0 1 0 1.5ZM12 18.75a.75.75 0 0 1 0-1.5.75.75 0 0 1 0 1.5Z"
      />
    </svg>
  );
}

function MenuEyeIcon({ className }) {
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
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function MenuPencilIcon({ className }) {
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

function MenuLoginAsIcon({ className }) {
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
        d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75"
      />
    </svg>
  );
}

function MenuTrashIcon({ className }) {
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

const menuIconClass = "h-4 w-4 shrink-0 text-white/50";

const merchantActionsMenuItemClass =
  "menu-item flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-medium transition-colors focus:outline-none";

export default function RpMerchants() {
  const qc = useQueryClient();
  const nav = useNavigate();

  const toggleActiveMut = useMutation({
    mutationFn: async ({ id, is_active }) => {
      await api(`/api/v1/rp/merchants/${id}`, {
        method: "PATCH",
        json: { is_active },
      });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["rp-merchants"] });
      void qc.invalidateQueries({ queryKey: ["rp-merchants-for-settlements"] });
    },
  });
  const [page, setPage] = useState(1);
  const [applied, setApplied] = useState({
    search: "",
    active: "",
    list_scope: "",
    pageSize: DEFAULT_PAGE_SIZE,
  });

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [deleteModal, setDeleteModal] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [openActionsId, setOpenActionsId] = useState(null);
  const [impersonateError, setImpersonateError] = useState("");
  const [impersonatingId, setImpersonatingId] = useState(null);
  const [menuPlacement, setMenuPlacement] = useState({ top: 0, right: 0 });

  useLayoutEffect(() => {
    if (!openActionsId) return;
    function updatePlacement() {
      const el = document.querySelector(`[data-rp-merchant-actions-anchor="${openActionsId}"]`);
      if (!el) return;
      const r = el.getBoundingClientRect();
      setMenuPlacement({ top: r.bottom + 6, right: window.innerWidth - r.right });
    }
    updatePlacement();
    window.addEventListener("resize", updatePlacement);
    window.addEventListener("scroll", updatePlacement, true);
    return () => {
      window.removeEventListener("resize", updatePlacement);
      window.removeEventListener("scroll", updatePlacement, true);
    };
  }, [openActionsId]);

  useEffect(() => {
    if (!openActionsId) return;
    function onDocMouseDown(e) {
      if (!(e.target instanceof Element)) return;
      if (e.target.closest("[data-rp-merchant-row-actions]")) return;
      if (e.target.closest("[data-rp-merchant-actions-menu]")) return;
      setOpenActionsId(null);
    }
    function onKey(e) {
      if (e.key === "Escape") setOpenActionsId(null);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [openActionsId]);

  async function loginAsMerchant(id) {
    setImpersonateError("");
    setOpenActionsId(null);
    setImpersonatingId(id);
    try {
      const rpTok = getToken();
      if (!rpTok) throw new Error("Not signed in");
      const r = await api(`/api/v1/rp/merchants/${id}/impersonate`, { method: "POST" });
      setImpersonationRpToken(rpTok);
      setToken(r.token);
      nav("/", { replace: true });
    } catch (e) {
      setImpersonateError(String(e));
    } finally {
      setImpersonatingId(null);
    }
  }

  const q = useQuery({
    queryKey: [
      "rp-merchants",
      page,
      applied.search,
      applied.active,
      applied.list_scope,
      applied.pageSize,
    ],
    queryFn: () => {
      const p = new URLSearchParams({
        page: String(page),
        pageSize: String(applied.pageSize),
      });
      if (applied.search.trim()) p.set("search", applied.search.trim());
      if (applied.active === "true") p.set("is_active", "true");
      if (applied.active === "false") p.set("is_active", "false");
      if (applied.list_scope === "all") p.set("list_scope", "all");
      if (applied.list_scope === "deleted") p.set("list_scope", "deleted");
      return api(`/api/v1/rp/merchants?${p}`);
    },
  });

  const total = q.data?.total ?? 0;
  const merchants = q.data?.merchants ?? [];
  const actionMenuMerchant = merchants.find((row) => row.id === openActionsId) ?? null;
  const showEmpty = !q.isLoading && merchants.length === 0;

  function resetAll() {
    setApplied({
      search: "",
      active: "",
      list_scope: "",
      pageSize: DEFAULT_PAGE_SIZE,
    });
    setPage(1);
    setDrawerOpen(false);
  }

  async function confirmMerchantDelete() {
    if (!deleteModal) return;
    setDeleteError("");
    setDeleteLoading(true);
    try {
      await api(`/api/v1/rp/merchants/${deleteModal.id}`, {
        method: "DELETE",
      });
      void qc.invalidateQueries({ queryKey: ["rp-merchants"] });
      void qc.invalidateQueries({ queryKey: ["rp-merchants-for-settlements"] });
      void qc.invalidateQueries({ queryKey: ["rp-dash"] });
      setDeleteModal(null);
    } catch (e) {
      setDeleteError(String(e));
    } finally {
      setDeleteLoading(false);
    }
  }

  const hasActiveFilters = Boolean(
    applied.search.trim() ||
      applied.active === "true" ||
      applied.active === "false" ||
      applied.list_scope === "all" ||
      applied.list_scope === "deleted",
  );
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

  function removeListScopeFilter() {
    setApplied((a) => ({ ...a, list_scope: "" }));
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
          <h1 className="font-display text-2xl font-bold" style={{ color: "var(--text-1)" }}>Merchants</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-2)" }}>Manage merchants, API keys, and gateway configuration.</p>
          {impersonateError ? (
            <p className="mt-3 text-sm text-rose-400">{impersonateError}</p>
          ) : null}
        </div>
        <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2">
          <Link
            to="/rp/merchants/new"
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
          {applied.list_scope === "all" ? (
            <span className="filter-chip">
              <span className="filter-chip-label">List</span>
              <span className="text-white/70">Including deleted</span>
              <button
                type="button"
                className={listFilterChipCloseClass}
                onClick={removeListScopeFilter}
                aria-label="Remove list filter"
              >
                ×
              </button>
            </span>
          ) : null}
          {applied.list_scope === "deleted" ? (
            <span className="filter-chip">
              <span className="filter-chip-label">List</span>
              <span className="text-white/70">Deleted only</span>
              <button
                type="button"
                className={listFilterChipCloseClass}
                onClick={removeListScopeFilter}
                aria-label="Remove list filter"
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
            initialValues={{
              search: applied.search,
              active: applied.active,
              list_scope: applied.list_scope,
            }}
            validationSchema={merchantFilterSchema}
            validateOnBlur
            validateOnChange={false}
            onSubmit={(vals, { setSubmitting }) => {
              setApplied((a) => ({
                ...a,
                search: vals.search,
                active: vals.active,
                list_scope: vals.list_scope,
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
                        htmlFor="rp-flt-search"
                      >
                        Search (email / display name)
                      </label>
                      <Field
                        id="rp-flt-search"
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
                        htmlFor="rp-flt-status"
                      >
                        Status
                      </label>
                      <Field
                        id="rp-flt-status"
                        name="active"
                        as="select"
                        className={listFilterInputClass}
                      >
                        <option value="">All (active + inactive)</option>
                        <option value="true">Active only</option>
                        <option value="false">Inactive only</option>
                      </Field>
                      <ErrorMessage
                        name="active"
                        component="p"
                        className="mt-1 text-xs text-rose-400"
                      />
                    </div>
                    <div>
                      <label
                        className={listFilterLabelClass}
                        htmlFor="rp-flt-list-scope"
                      >
                        Soft delete (<span className="font-mono">deleted_at</span>)
                      </label>
                      <Field
                        id="rp-flt-list-scope"
                        name="list_scope"
                        as="select"
                        className={listFilterInputClass}
                      >
                        <option value="">Hide deleted (default)</option>
                        <option value="all">Include deleted rows</option>
                        <option value="deleted">Deleted only</option>
                      </Field>
                      <ErrorMessage
                        name="list_scope"
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
                      resetForm({
                        values: { search: "", active: "", list_scope: "" },
                      })
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
          This will <strong className="text-white/85">soft-delete</strong>{" "}
          <span className="font-mono text-white/70">
            {deleteModal?.email}
          </span>
          : <span className="font-mono text-white/60">deleted_at</span> is set,
          the merchant cannot log in or use the gateway, and the row disappears
          from the default list. Inactive (<span className="font-mono">is_active</span>)
          is separate — use the Active toggle for that.
        </p>
        {deleteError ? (
          <p className="mt-3 text-sm text-rose-400">{deleteError}</p>
        ) : null}
      </ConfirmModal>

      <div className="mt-10 space-y-4">
        <div className="data-table-surface">
          <table className="data-table min-w-[880px]">
            <thead>
              <tr>
                <th className="whitespace-nowrap text-xs">Merchant ID</th>
                <th>Email</th>
                <th>Chains</th>
                <th>Rails</th>
                <th className="text-xs">Users (live)</th>
                <th className="text-xs">Users (sandbox)</th>
                <th>Active</th>
                <th className="w-[1%] whitespace-nowrap text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {q.isLoading ? (
                <tr>
                  <td colSpan={8} className="!py-8">
                    <BrandLoader variant="inline" title="" subtitle="Loading…" />
                  </td>
                </tr>
              ) : null}
              {showEmpty ? (
                <tr>
                  <td colSpan={8} className="!py-12 text-center text-sm text-white/45">
                    No record found.
                  </td>
                </tr>
              ) : null}
              {!q.isLoading &&
                merchants.map((m) => {
                  const isDeleted = Boolean(m.deleted_at);
                  return (
                  <tr key={m.id}>
                    <td className="max-w-[min(200px,28vw)] font-mono text-[10px] leading-snug text-white/60">
                      <span className="break-all" title={m.id}>
                        {m.id}
                      </span>
                    </td>
                    <td className="font-mono text-xs text-white/80">
                      <span className="block">{m.email}</span>
                      {isDeleted ? (
                        <span className="mt-0.5 inline-block rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-rose-200/90">
                          Deleted
                        </span>
                      ) : null}
                    </td>
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
                    <td className="font-mono text-xs">{m.end_users_live ?? 0}</td>
                    <td className="font-mono text-xs">{m.end_users_sandbox ?? 0}</td>
                    <td>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={m.is_active}
                        aria-label={
                          isDeleted
                            ? "Soft-deleted — cannot change"
                            : m.is_active
                              ? "Active — click to deactivate"
                              : "Inactive — click to activate"
                        }
                        disabled={toggleActiveMut.isPending || isDeleted}
                        onClick={() => {
                          if (toggleActiveMut.isPending || isDeleted) return;
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
                      <StatusBadge status={isDeleted ? "deleted" : m.is_active ? "active" : "inactive"} />
                    </td>
                    <td className="whitespace-nowrap text-right">
                      <div className="relative inline-block text-left" data-rp-merchant-row-actions>
                        <button
                          type="button"
                          data-rp-merchant-actions-anchor={m.id}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/12 bg-white/5 text-white/70 transition hover:border-white/20 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                          aria-haspopup="menu"
                          aria-expanded={openActionsId === m.id}
                          aria-label={`Actions for ${m.email}`}
                          onClick={() => setOpenActionsId((cur) => (cur === m.id ? null : m.id))}
                        >
                          <DotsVerticalIcon className="h-5 w-5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
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

      {actionMenuMerchant
        ? createPortal(
            <div
              data-rp-merchant-actions-menu
              className="menu-shell fixed z-[70] min-w-[13.5rem] rounded-xl py-1 shadow-xl shadow-black/50"
              style={{ top: menuPlacement.top, right: menuPlacement.right, background: "var(--menu-bg)", border: "1px solid var(--menu-border)" }}
              role="menu"
              aria-label="Merchant actions"
            >
              <Link
                to={`/rp/merchants/${actionMenuMerchant.id}`}
                role="menuitem"
                className={merchantActionsMenuItemClass}
                onClick={() => setOpenActionsId(null)}
              >
                <MenuEyeIcon className={menuIconClass} />
                View details
              </Link>
              {actionMenuMerchant.deleted_at ? (
                <span
                  role="menuitem"
                  className={`${merchantActionsMenuItemClass} cursor-not-allowed opacity-40`}
                  title="Soft-deleted merchant cannot be edited"
                >
                  <MenuPencilIcon className={menuIconClass} />
                  Edit
                </span>
              ) : (
                <Link
                  to={`/rp/merchants/${actionMenuMerchant.id}/edit`}
                  role="menuitem"
                  className={merchantActionsMenuItemClass}
                  onClick={() => setOpenActionsId(null)}
                >
                  <MenuPencilIcon className={menuIconClass} />
                  Edit
                </Link>
              )}
              <button
                type="button"
                role="menuitem"
                disabled={
                  Boolean(actionMenuMerchant.deleted_at) ||
                  !actionMenuMerchant.is_active ||
                  impersonatingId === actionMenuMerchant.id
                }
                title={
                  actionMenuMerchant.deleted_at
                    ? "Soft-deleted merchant"
                    : !actionMenuMerchant.is_active
                      ? "Activate the merchant first"
                      : undefined
                }
                className={`${merchantActionsMenuItemClass} disabled:cursor-not-allowed disabled:opacity-40`}
                onClick={() => void loginAsMerchant(actionMenuMerchant.id)}
              >
                <MenuLoginAsIcon className={menuIconClass} />
                {impersonatingId === actionMenuMerchant.id ? "Opening…" : "Log in as merchant"}
              </button>
              <div className="mt-1 border-t border-white/10 pt-1">
                <button
                  type="button"
                  role="menuitem"
                  disabled={Boolean(actionMenuMerchant.deleted_at)}
                  title={
                    actionMenuMerchant.deleted_at
                      ? "Already soft-deleted"
                      : undefined
                  }
                  className={`${merchantActionsMenuItemClass} text-rose-200 hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-40`}
                  onClick={() => {
                    if (actionMenuMerchant.deleted_at) return;
                    setOpenActionsId(null);
                    setDeleteError("");
                    setDeleteModal({
                      id: actionMenuMerchant.id,
                      email: actionMenuMerchant.email,
                    });
                  }}
                >
                  <MenuTrashIcon className={`${menuIconClass} text-rose-300/80`} />
                  Delete (soft)
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
