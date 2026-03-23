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
import { adminWithdrawalsFilterSchema, CHAIN_VALUES } from "../../admin/merchantSchemas";

const DEFAULT_PAGE_SIZE = DEFAULT_LIST_PAGE_SIZE;
const ST = ["pending", "processing", "completed", "failed"];

export default function AdminWithdrawals() {
  const [page, setPage] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [applied, setApplied] = useState({
    merchant_id: "",
    chain: "",
    status: "",
    token_symbol: "",
    to_address: "",
    pageSize: DEFAULT_PAGE_SIZE,
  });

  const res = useQuery({
    queryKey: [
      "admin-withdrawals",
      page,
      applied.pageSize,
      applied.merchant_id,
      applied.chain,
      applied.status,
      applied.token_symbol,
      applied.to_address,
    ],
    queryFn: () => {
      const p = new URLSearchParams({ page: String(page), pageSize: String(applied.pageSize) });
      if (applied.merchant_id.trim()) p.set("merchant_id", applied.merchant_id.trim());
      if (applied.chain) p.set("chain", applied.chain);
      if (applied.status) p.set("status", applied.status);
      if (applied.token_symbol.trim()) p.set("token_symbol", applied.token_symbol.trim());
      if (applied.to_address.trim()) p.set("to_address", applied.to_address.trim());
      return api(`/api/v1/admin/withdrawals?${p}`);
    },
  });

  const total = res.data?.total ?? 0;
  const rows = res.data?.withdrawals ?? [];
  const showEmpty = !res.isLoading && rows.length === 0;

  const hasActiveFilters = Boolean(
    applied.merchant_id.trim() ||
      applied.chain ||
      applied.status ||
      applied.token_symbol.trim() ||
      applied.to_address.trim(),
  );
  const hasNonDefaultPageSize = applied.pageSize !== DEFAULT_PAGE_SIZE;
  const hasFilterChips = hasActiveFilters || hasNonDefaultPageSize;
  const canReset = page > 1 || hasFilterChips;

  function resetAll() {
    setApplied({
      merchant_id: "",
      chain: "",
      status: "",
      token_symbol: "",
      to_address: "",
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
          <h1 className="text-2xl font-semibold text-white">Withdrawals</h1>
          <p className="mt-1 text-sm text-white/50">All merchant payout requests across the gateway.</p>
        </div>
        <ListFilterToolbar
          onOpenDrawer={() => setDrawerOpen(true)}
          onReset={resetAll}
          canReset={canReset}
        />
      </div>

      {hasFilterChips ? (
        <ListActiveFiltersChips>
          {applied.merchant_id.trim() ? (
            <span className="inline-flex max-w-full items-center gap-1 rounded-xl border border-violet-400/25 bg-violet-500/[0.12] px-2.5 py-1.5 pl-3 text-xs text-violet-50">
              <span className="text-[10px] font-semibold tracking-wide text-violet-300/80 uppercase">Merchant</span>
              <span className="truncate font-mono" title={applied.merchant_id}>
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
            <span className="inline-flex max-w-full items-center gap-1 rounded-xl border border-amber-400/25 bg-amber-500/[0.12] px-2.5 py-1.5 pl-3 text-xs text-amber-50">
              <span className="text-[10px] font-semibold tracking-wide text-amber-300/80 uppercase">Token</span>
              <span className="truncate font-mono">{applied.token_symbol}</span>
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
          {applied.to_address.trim() ? (
            <span className="inline-flex max-w-full items-center gap-1 rounded-xl border border-white/20 bg-white/[0.08] px-2.5 py-1.5 pl-3 text-xs text-white/85">
              <span className="text-[10px] font-semibold tracking-wide text-white/50 uppercase">To</span>
              <span className="max-w-[min(240px,50vw)] truncate font-mono text-[10px]" title={applied.to_address}>
                {applied.to_address}
              </span>
              <button
                type="button"
                className={listFilterChipCloseClass}
                onClick={() => patchApplied({ to_address: "" })}
                aria-label="Remove to-address filter"
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
              merchant_id: applied.merchant_id,
              chain: applied.chain,
              status: applied.status,
              token_symbol: applied.token_symbol,
              to_address: applied.to_address,
            }}
            validationSchema={adminWithdrawalsFilterSchema}
            validateOnBlur
            validateOnChange={false}
            onSubmit={(vals, { setSubmitting }) => {
              setApplied((a) => ({
                ...a,
                merchant_id: vals.merchant_id,
                chain: vals.chain,
                status: vals.status,
                token_symbol: vals.token_symbol,
                to_address: vals.to_address,
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
                      <label className={listFilterLabelClass} htmlFor="adm-w-merchant">
                        Merchant id
                      </label>
                      <Field
                        id="adm-w-merchant"
                        name="merchant_id"
                        className={listFilterInputClass}
                        placeholder="Merchant id"
                      />
                      <ErrorMessage name="merchant_id" component="p" className="mt-1 text-xs text-rose-400" />
                    </div>
                    <div>
                      <label className={listFilterLabelClass} htmlFor="adm-w-chain">
                        Chain
                      </label>
                      <Field id="adm-w-chain" name="chain" as="select" className={listFilterInputClass}>
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
                      <label className={listFilterLabelClass} htmlFor="adm-w-status">
                        Status
                      </label>
                      <Field id="adm-w-status" name="status" as="select" className={listFilterInputClass}>
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
                      <label className={listFilterLabelClass} htmlFor="adm-w-token">
                        Token symbol
                      </label>
                      <Field id="adm-w-token" name="token_symbol" className={listFilterInputClass} placeholder="e.g. ETH" />
                      <ErrorMessage name="token_symbol" component="p" className="mt-1 text-xs text-rose-400" />
                    </div>
                    <div>
                      <label className={listFilterLabelClass} htmlFor="adm-w-to">
                        To address
                      </label>
                      <Field
                        id="adm-w-to"
                        name="to_address"
                        className={listFilterInputClass}
                        placeholder="0x… or partial"
                      />
                      <ErrorMessage name="to_address" component="p" className="mt-1 text-xs text-rose-400" />
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
                        values: {
                          merchant_id: "",
                          chain: "",
                          status: "",
                          token_symbol: "",
                          to_address: "",
                        },
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
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead className="border-b border-white/10 bg-white/5 text-xs text-white/50 uppercase">
              <tr>
                <th className="px-3 py-3">When</th>
                <th className="px-3 py-3">Merchant</th>
                <th className="px-3 py-3">Chain</th>
                <th className="px-3 py-3">Token</th>
                <th className="px-3 py-3">Amount</th>
                <th className="px-3 py-3">To</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Tx</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {res.isLoading ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-sm text-white/45">
                    Loading…
                  </td>
                </tr>
              ) : null}
              {showEmpty ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-sm text-white/50">
                    No record found.
                  </td>
                </tr>
              ) : null}
              {!res.isLoading &&
                rows.map((w) => (
                  <tr key={w.id} className="text-white/85">
                    <td className="px-3 py-2 text-xs text-white/50">{w.created_at.slice(0, 19)}</td>
                    <td className="max-w-[140px] truncate px-3 py-2 text-xs">{w.merchant.email}</td>
                    <td className="px-3 py-2">{w.chain}</td>
                    <td className="px-3 py-2">{w.token_symbol}</td>
                    <td className="px-3 py-2 font-mono text-xs">{w.amount}</td>
                    <td className="max-w-[120px] truncate px-3 py-2 font-mono text-[10px]">{w.to_address}</td>
                    <td className="px-3 py-2 text-xs">{w.status}</td>
                    <td className="max-w-[120px] truncate px-3 py-2 font-mono text-[10px] text-cyan-300/80">
                      {w.tx_hash ?? "—"}
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
