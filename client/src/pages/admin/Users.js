import { Formik, Form, Field, ErrorMessage } from "formik";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api";
import ListPaginationBar, { DEFAULT_LIST_PAGE_SIZE } from "../../components/ListPaginationBar";
import { BrandLoader } from "../../components/BrandLoader.js";
import {
  ListActiveFiltersChips,
  ListFilterDrawer,
  ListFilterToolbar,
  listFilterApplyButtonClass,
  listFilterChipCloseClass,
  listFilterInputClass,
  listFilterLabelClass,
  listFilterSecondaryButtonClass,
} from "../../components/ListFilterChrome";
import { adminUsersFilterSchema } from "../../admin/merchantSchemas";
import {
  UserAssignmentHistoryModal,
  UserHistoryCountButton,
  UserPayerDepositHistoryModal,
} from "../../components/UserHistoryModals.js";
import { formatLocalDate } from "../../lib/formatLocalDateTime.js";

const DEFAULT_PAGE_SIZE = DEFAULT_LIST_PAGE_SIZE;

export default function AdminUsers() {
  const [page, setPage] = useState(1);
  const [assignmentUserId, setAssignmentUserId] = useState(null);
  const [depositUserId, setDepositUserId] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [applied, setApplied] = useState({
    q: "",
    merchant_id: "",
    created_from: "",
    created_to: "",
    pageSize: DEFAULT_PAGE_SIZE,
  });

  const res = useQuery({
    queryKey: ["admin-users", page, applied.pageSize, applied.q, applied.merchant_id, applied.created_from, applied.created_to],
    queryFn: () => {
      const p = new URLSearchParams({ page: String(page), pageSize: String(applied.pageSize) });
      if (applied.q.trim()) p.set("q", applied.q.trim());
      if (applied.merchant_id.trim()) p.set("merchant_id", applied.merchant_id.trim());
      if (applied.created_from) p.set("created_from", applied.created_from);
      if (applied.created_to) p.set("created_to", applied.created_to);
      return api(`/api/v1/admin/users?${p}`);
    },
  });

  const total = res.data?.total ?? 0;
  const users = res.data?.users ?? [];
  const showEmpty = !res.isLoading && users.length === 0;

  const hasActiveFilters = Boolean(
    applied.q.trim() ||
      applied.merchant_id.trim() ||
      applied.created_from ||
      applied.created_to,
  );
  const hasNonDefaultPageSize = applied.pageSize !== DEFAULT_PAGE_SIZE;
  const hasFilterChips = hasActiveFilters || hasNonDefaultPageSize;
  const canReset = page > 1 || hasFilterChips;

  function resetAll() {
    setApplied({
      q: "",
      merchant_id: "",
      created_from: "",
      created_to: "",
      pageSize: DEFAULT_PAGE_SIZE,
    });
    setPage(1);
    setDrawerOpen(false);
  }

  function patchApplied(partial) {
    setApplied((a) => ({ ...a, ...partial }));
    setPage(1);
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-bold" style={{ color: "var(--text-1)" }}>Users</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-2)" }}>End-users across all merchants and environments.</p>
          <p className="mt-2 max-w-3xl text-xs leading-relaxed text-white/40">
            <span className="text-white/55">Active</span> = wallets currently reserved for this user.{" "}
            <span className="text-white/55">Assign #</span> = each time the gateway handed them an address (click for
            history). <span className="text-white/55">Tx #</span> = deposits we attributed to them (click for amounts).
            Assignment logging starts after the latest deploy; older API calls are not backfilled.
          </p>
        </div>
        <ListFilterToolbar
          onOpenDrawer={() => setDrawerOpen(true)}
          onReset={resetAll}
          canReset={canReset}
        />
      </div>

      {hasFilterChips ? (
        <ListActiveFiltersChips>
          {applied.q.trim() ? (
            <span className="filter-chip max-w-full">
              <span className="filter-chip-label">Search</span>
              <span className="max-w-[min(220px,45vw)] truncate font-mono text-white/65" title={applied.q}>
                {applied.q}
              </span>
              <button
                type="button"
                className={listFilterChipCloseClass}
                onClick={() => patchApplied({ q: "" })}
                aria-label="Remove search filter"
              >
                ×
              </button>
            </span>
          ) : null}
          {applied.merchant_id.trim() ? (
            <span className="filter-chip max-w-full">
              <span className="filter-chip-label">Merchant</span>
              <span className="max-w-[min(220px,45vw)] truncate font-mono" title={applied.merchant_id}>
                {applied.merchant_id}
              </span>
              <button
                type="button"
                className={listFilterChipCloseClass}
                onClick={() => patchApplied({ merchant_id: "" })}
                aria-label="Remove merchant filter"
              >
                ×
              </button>
            </span>
          ) : null}
          {applied.created_from ? (
            <span className="inline-flex items-center gap-1 rounded-xl border border-white/20 bg-white/[0.08] px-2.5 py-1.5 pl-3 text-xs text-white/85">
              <span className="text-[10px] font-semibold tracking-wide text-white/50 uppercase">From</span>
              <span className="font-mono">{applied.created_from}</span>
              <button
                type="button"
                className={listFilterChipCloseClass}
                onClick={() => patchApplied({ created_from: "" })}
                aria-label="Remove from date"
              >
                ×
              </button>
            </span>
          ) : null}
          {applied.created_to ? (
            <span className="inline-flex items-center gap-1 rounded-xl border border-white/20 bg-white/[0.08] px-2.5 py-1.5 pl-3 text-xs text-white/85">
              <span className="text-[10px] font-semibold tracking-wide text-white/50 uppercase">To</span>
              <span className="font-mono">{applied.created_to}</span>
              <button
                type="button"
                className={listFilterChipCloseClass}
                onClick={() => patchApplied({ created_to: "" })}
                aria-label="Remove to date"
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
                onClick={() => patchApplied({ pageSize: DEFAULT_PAGE_SIZE })}
                aria-label="Reset page size"
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
              q: applied.q,
              merchant_id: applied.merchant_id,
              created_from: applied.created_from,
              created_to: applied.created_to,
            }}
            validationSchema={adminUsersFilterSchema}
            validateOnBlur
            validateOnChange={false}
            onSubmit={(vals, { setSubmitting }) => {
              setApplied((a) => ({
                ...a,
                q: vals.q,
                merchant_id: vals.merchant_id,
                created_from: vals.created_from,
                created_to: vals.created_to,
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
                      <label className={listFilterLabelClass} htmlFor="adm-users-q">
                        Search (id / external_user_id)
                      </label>
                      <Field id="adm-users-q" name="q" className={listFilterInputClass} placeholder="Type to filter…" />
                      <ErrorMessage name="q" component="p" className="mt-1 text-xs text-rose-400" />
                    </div>
                    <div>
                      <label className={listFilterLabelClass} htmlFor="adm-users-merchant">
                        Merchant id
                      </label>
                      <Field
                        id="adm-users-merchant"
                        name="merchant_id"
                        className={listFilterInputClass}
                        placeholder="Filter by merchant id"
                      />
                      <ErrorMessage name="merchant_id" component="p" className="mt-1 text-xs text-rose-400" />
                    </div>
                    <div>
                      <label className={listFilterLabelClass} htmlFor="adm-users-from">
                        Created from
                      </label>
                      <Field id="adm-users-from" name="created_from" type="date" className={listFilterInputClass} />
                      <ErrorMessage name="created_from" component="p" className="mt-1 text-xs text-rose-400" />
                    </div>
                    <div>
                      <label className={listFilterLabelClass} htmlFor="adm-users-to">
                        Created to
                      </label>
                      <Field id="adm-users-to" name="created_to" type="date" className={listFilterInputClass} />
                      <ErrorMessage name="created_to" component="p" className="mt-1 text-xs text-rose-400" />
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
                      resetForm({ values: { q: "", merchant_id: "", created_from: "", created_to: "" } })
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

      <div className="mt-10 space-y-4">
        <div className="data-table-surface">
            <table className="data-table min-w-[720px]">
            <thead>
              <tr>
                <th>External id</th>
                <th>Merchant</th>
                <th>Active</th>
                <th>Assign #</th>
                <th>Tx #</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {res.isLoading ? (
                <tr>
                  <td colSpan={6} className="!py-8">
                    <BrandLoader variant="inline" title="" subtitle="Loading…" />
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
              {!res.isLoading &&
                users.map((u) => (
                  <tr key={u.id}>
                    <td className="font-mono text-xs text-white/75">{u.external_user_id}</td>
                    <td className="text-xs text-white/65">{u.merchant.email}</td>
                    <td className="font-mono text-xs text-white/70">{u.wallets_now_assigned ?? 0}</td>
                    <td>
                      <UserHistoryCountButton
                        count={u.wallet_assignment_event_count ?? 0}
                        disabled={false}
                        title={`${u.distinct_wallets_in_assignment_log ?? 0} distinct wallet addresses in log`}
                        onClick={() => setAssignmentUserId(u.id)}
                      />
                    </td>
                    <td>
                      <UserHistoryCountButton
                        count={u.payer_transaction_count ?? 0}
                        disabled={false}
                        title={`${u.payer_success_transaction_count ?? 0} successful`}
                        onClick={() => setDepositUserId(u.id)}
                      />
                    </td>
                    <td className="text-xs text-white/45">{formatLocalDate(u.created_at)}</td>
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

      <UserAssignmentHistoryModal
        open={assignmentUserId != null}
        userId={assignmentUserId}
        panel="admin"
        adminMerchantId={applied.merchant_id.trim() || undefined}
        onClose={() => setAssignmentUserId(null)}
      />
      <UserPayerDepositHistoryModal
        open={depositUserId != null}
        userId={depositUserId}
        panel="admin"
        adminMerchantId={applied.merchant_id.trim() || undefined}
        onClose={() => setDepositUserId(null)}
      />
    </div>
  );
}
