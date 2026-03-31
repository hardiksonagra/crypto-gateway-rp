import { Formik, Form, Field, ErrorMessage } from "formik";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api";
import { useMerchantPortalEnvironment } from "../../hooks/useMerchantPortalEnvironment.js";
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
import { merchantUsersFilterSchema } from "../../admin/merchantSchemas";
import {
  UserAssignmentHistoryModal,
  UserHistoryCountButton,
  UserPayerDepositHistoryModal,
} from "../../components/UserHistoryModals.js";
import { formatLocalDate } from "../../lib/formatLocalDateTime.js";

const DEFAULT_PAGE_SIZE = DEFAULT_LIST_PAGE_SIZE;

export default function MerchantUsers() {
  const [page, setPage] = useState(1);
  const [assignmentUserId, setAssignmentUserId] = useState(null);
  const [depositUserId, setDepositUserId] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [applied, setApplied] = useState({
    q: "",
    pageSize: DEFAULT_PAGE_SIZE,
  });

  const {
    environment,
    portalEnvironmentKey,
    liveGatewayEnabled,
    sandboxGatewayEnabled,
    flagsLoading,
  } = useMerchantPortalEnvironment();

  const envQueryEnabled =
    !flagsLoading &&
    ((environment === "live" && liveGatewayEnabled) ||
      (environment === "sandbox" && sandboxGatewayEnabled));

  const res = useQuery({
    queryKey: ["m-users", page, applied.pageSize, applied.q, portalEnvironmentKey],
    queryFn: () => {
      const p = new URLSearchParams({
        page: String(page),
        pageSize: String(applied.pageSize),
      });
      if (applied.q.trim()) p.set("q", applied.q.trim());
      return api(`/api/v1/merchant/users?${p}`);
    },
    enabled: envQueryEnabled,
  });

  const total = res.data?.total ?? 0;
  const users = res.data?.users ?? [];
  const showEmpty = !res.isLoading && users.length === 0;

  const hasActiveFilters = Boolean(applied.q.trim());
  const hasNonDefaultPageSize = applied.pageSize !== DEFAULT_PAGE_SIZE;
  const hasFilterChips = hasActiveFilters || hasNonDefaultPageSize;
  const canReset = page > 1 || hasFilterChips;

  function resetAll() {
    setApplied({ q: "", pageSize: DEFAULT_PAGE_SIZE });
    setPage(1);
    setDrawerOpen(false);
  }

  function patchApplied(partial) {
    setApplied((a) => ({ ...a, ...partial }));
    setPage(1);
  }

  if (flagsLoading) {
    return (
      <BrandLoader
        variant="page"
        title=""
        subtitle="Loading users…"
        aria-label="Loading users"
      />
    );
  }

  if (!liveGatewayEnabled && !sandboxGatewayEnabled) {
    return (
      <div>
        <h1 className="font-display text-2xl font-semibold text-white">Users</h1>
        <p className="mt-4 text-sm text-rose-200/90">
          Neither live nor sandbox gateway is enabled for your account. Contact support.
        </p>
      </div>
    );
  }

  if (!envQueryEnabled) {
    return (
      <BrandLoader
        variant="page"
        title=""
        subtitle="Preparing users…"
        aria-label="Preparing users list"
      />
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-semibold text-white">Users</h1>
          <p className="mt-2 max-w-3xl text-xs leading-relaxed text-white/40">
            <span className="text-white/55">Active</span> = wallets currently reserved.{" "}
            <span className="text-white/55">Assign #</span> = gateway gave an address (click for time &amp; wallet).{" "}
            <span className="text-white/55">Tx #</span> = recorded deposits (click for amount per tx). New logging only
            after deploy.
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
              <span className="max-w-[min(280px,50vw)] truncate font-mono text-white/65" title={applied.q}>
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
            initialValues={{ q: applied.q }}
            validationSchema={merchantUsersFilterSchema}
            validateOnBlur
            validateOnChange={false}
            onSubmit={(vals, { setSubmitting }) => {
              setApplied((a) => ({ ...a, q: vals.q }));
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
                      <label className={listFilterLabelClass} htmlFor="m-users-q">
                        Search (external id or internal id)
                      </label>
                      <Field
                        id="m-users-q"
                        name="q"
                        className={listFilterInputClass}
                        placeholder="Type to filter…"
                      />
                      <ErrorMessage name="q" component="p" className="mt-1 text-xs text-rose-400" />
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 gap-3 border-t border-white/10 px-5 py-4">
                  <button type="submit" className={listFilterApplyButtonClass}>
                    Apply
                  </button>
                  <button
                    type="button"
                    onClick={() => resetForm({ values: { q: "" } })}
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
            <table className="data-table min-w-[640px]">
            <thead>
              <tr>
                <th>External id</th>
                <th>Active</th>
                <th>Assign #</th>
                <th>Tx #</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {res.isLoading ? (
                <tr>
                  <td colSpan={5} className="!py-8">
                    <BrandLoader variant="inline" title="" subtitle="Loading…" />
                  </td>
                </tr>
              ) : null}
              {showEmpty ? (
                <tr>
                  <td colSpan={5} className="!py-12 text-center text-sm text-white/45">
                    No record found.
                  </td>
                </tr>
              ) : null}
              {!res.isLoading &&
                users.map((u) => (
                  <tr key={u.id}>
                    <td className="font-mono text-xs text-white/75">{u.external_user_id}</td>
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
        panel="merchant"
        onClose={() => setAssignmentUserId(null)}
      />
      <UserPayerDepositHistoryModal
        open={depositUserId != null}
        userId={depositUserId}
        panel="merchant"
        onClose={() => setDepositUserId(null)}
      />
    </div>
  );
}
