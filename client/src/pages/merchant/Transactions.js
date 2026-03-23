import { Formik, Form, Field, ErrorMessage } from "formik";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api";
import ListPaginationBar, { DEFAULT_LIST_PAGE_SIZE } from "../../components/ListPaginationBar";
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
import { CHAIN_VALUES, merchantTransactionsFilterSchema } from "../../admin/merchantSchemas";

const DEFAULT_PAGE_SIZE = DEFAULT_LIST_PAGE_SIZE;
const ST = ["pending", "success", "failed"];

export default function MerchantTransactions() {
  const [page, setPage] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [applied, setApplied] = useState({
    chain: "",
    status: "",
    token_symbol: "",
    external_user_id: "",
    pageSize: DEFAULT_PAGE_SIZE,
  });

  const res = useQuery({
    queryKey: ["m-txs", page, applied.pageSize, applied.chain, applied.status, applied.token_symbol, applied.external_user_id],
    queryFn: () => {
      const p = new URLSearchParams({ page: String(page), pageSize: String(applied.pageSize) });
      if (applied.chain) p.set("chain", applied.chain);
      if (applied.status) p.set("status", applied.status);
      if (applied.token_symbol.trim()) p.set("token_symbol", applied.token_symbol.trim());
      if (applied.external_user_id.trim()) p.set("external_user_id", applied.external_user_id.trim());
      return api(`/api/v1/merchant/transactions?${p}`);
    },
  });

  const total = res.data?.total ?? 0;
  const rows = res.data?.transactions ?? [];
  const showEmpty = !res.isLoading && rows.length === 0;

  const hasActiveFilters = Boolean(
    applied.chain ||
      applied.status ||
      applied.token_symbol.trim() ||
      applied.external_user_id.trim(),
  );
  const hasNonDefaultPageSize = applied.pageSize !== DEFAULT_PAGE_SIZE;
  const hasFilterChips = hasActiveFilters || hasNonDefaultPageSize;
  const canReset = page > 1 || hasFilterChips;

  function resetAll() {
    setApplied({
      chain: "",
      status: "",
      token_symbol: "",
      external_user_id: "",
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
          <h1 className="text-2xl font-semibold text-white">Transactions</h1>
          <p className="mt-1 text-sm text-white/50">Only traffic for your merchant account.</p>
        </div>
        <ListFilterToolbar
          onOpenDrawer={() => setDrawerOpen(true)}
          onReset={resetAll}
          canReset={canReset}
        />
      </div>

      {hasFilterChips ? (
        <ListActiveFiltersChips>
          {applied.chain ? (
            <span className="inline-flex items-center gap-1 rounded-xl border border-cyan-400/25 bg-cyan-500/[0.12] px-2.5 py-1.5 pl-3 text-xs text-cyan-50">
              <span className="text-[10px] font-semibold tracking-wide text-cyan-300/80 uppercase">Chain</span>
              <span>{applied.chain}</span>
              <button
                type="button"
                className={listFilterChipCloseClass}
                onClick={() => patchApplied({ chain: "" })}
                aria-label="Remove chain filter"
              >
                ×
              </button>
            </span>
          ) : null}
          {applied.status ? (
            <span className="inline-flex items-center gap-1 rounded-xl border border-emerald-400/25 bg-emerald-500/[0.12] px-2.5 py-1.5 pl-3 text-xs text-emerald-50">
              <span className="text-[10px] font-semibold tracking-wide text-emerald-300/80 uppercase">Status</span>
              <span>{applied.status}</span>
              <button
                type="button"
                className={listFilterChipCloseClass}
                onClick={() => patchApplied({ status: "" })}
                aria-label="Remove status filter"
              >
                ×
              </button>
            </span>
          ) : null}
          {applied.token_symbol.trim() ? (
            <span className="inline-flex items-center gap-1 rounded-xl border border-amber-400/25 bg-amber-500/[0.12] px-2.5 py-1.5 pl-3 text-xs text-amber-50">
              <span className="text-[10px] font-semibold tracking-wide text-amber-300/80 uppercase">Token</span>
              <span className="font-mono">{applied.token_symbol}</span>
              <button
                type="button"
                className={listFilterChipCloseClass}
                onClick={() => patchApplied({ token_symbol: "" })}
                aria-label="Remove token filter"
              >
                ×
              </button>
            </span>
          ) : null}
          {applied.external_user_id.trim() ? (
            <span className="inline-flex max-w-full items-center gap-1 rounded-xl border border-violet-400/25 bg-violet-500/[0.12] px-2.5 py-1.5 pl-3 text-xs text-violet-50">
              <span className="text-[10px] font-semibold tracking-wide text-violet-300/80 uppercase">User</span>
              <span className="max-w-[min(240px,50vw)] truncate font-mono text-[10px]" title={applied.external_user_id}>
                {applied.external_user_id}
              </span>
              <button
                type="button"
                className={listFilterChipCloseClass}
                onClick={() => patchApplied({ external_user_id: "" })}
                aria-label="Remove user filter"
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
              chain: applied.chain,
              status: applied.status,
              token_symbol: applied.token_symbol,
              external_user_id: applied.external_user_id,
            }}
            validationSchema={merchantTransactionsFilterSchema}
            validateOnBlur
            validateOnChange={false}
            onSubmit={(vals, { setSubmitting }) => {
              setApplied((a) => ({
                ...a,
                chain: vals.chain,
                status: vals.status,
                token_symbol: vals.token_symbol,
                external_user_id: vals.external_user_id,
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
                      <label className={listFilterLabelClass} htmlFor="m-tx-chain">
                        Chain
                      </label>
                      <Field id="m-tx-chain" name="chain" as="select" className={listFilterInputClass}>
                        <option value="">All chains</option>
                        {CHAIN_VALUES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </Field>
                      <ErrorMessage name="chain" component="p" className="mt-1 text-xs text-rose-400" />
                    </div>
                    <div>
                      <label className={listFilterLabelClass} htmlFor="m-tx-status">
                        Status
                      </label>
                      <Field id="m-tx-status" name="status" as="select" className={listFilterInputClass}>
                        <option value="">All status</option>
                        {ST.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </Field>
                      <ErrorMessage name="status" component="p" className="mt-1 text-xs text-rose-400" />
                    </div>
                    <div>
                      <label className={listFilterLabelClass} htmlFor="m-tx-token">
                        Token symbol
                      </label>
                      <Field id="m-tx-token" name="token_symbol" className={listFilterInputClass} placeholder="e.g. USDT" />
                      <ErrorMessage name="token_symbol" component="p" className="mt-1 text-xs text-rose-400" />
                    </div>
                    <div>
                      <label className={listFilterLabelClass} htmlFor="m-tx-ext">
                        External user id
                      </label>
                      <Field
                        id="m-tx-ext"
                        name="external_user_id"
                        className={listFilterInputClass}
                        placeholder="Filter by end user"
                      />
                      <ErrorMessage name="external_user_id" component="p" className="mt-1 text-xs text-rose-400" />
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
                        values: { chain: "", status: "", token_symbol: "", external_user_id: "" },
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

      <div className="mt-10 space-y-4">
        <div className="glass overflow-x-auto rounded-2xl">
          <table className="w-full min-w-[700px] text-left text-sm">
            <thead className="border-b border-white/10 bg-white/5 text-xs text-white/50 uppercase">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2">Chain</th>
                <th className="px-3 py-2">Token</th>
                <th className="px-3 py-2">Amount</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {res.isLoading ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-sm text-white/45">
                    Loading…
                  </td>
                </tr>
              ) : null}
              {showEmpty ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-sm text-white/50">
                    No record found.
                  </td>
                </tr>
              ) : null}
              {!res.isLoading &&
                rows.map((t) => (
                  <tr key={t.id} className="text-white/85">
                    <td className="px-3 py-2 text-xs">{t.created_at.slice(0, 19)}</td>
                    <td className="max-w-[120px] truncate px-3 py-2 font-mono text-xs">{t.external_user_id}</td>
                    <td className="px-3 py-2">{t.chain}</td>
                    <td className="px-3 py-2">{t.token_symbol}</td>
                    <td className="px-3 py-2 font-mono text-xs">{t.amount}</td>
                    <td className="px-3 py-2 text-xs">{t.status}</td>
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
