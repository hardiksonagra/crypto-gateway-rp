import { Formik, Form, Field, ErrorMessage } from "formik";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api";
import TransactionDetailModal from "../../components/TransactionDetailModal.js";
import { useMerchantPortalEnvironment } from "../../hooks/useMerchantPortalEnvironment.js";
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
import { adminTransactionsFilterSchema, CHAIN_VALUES } from "../../admin/merchantSchemas";
import { formatTokenAmount } from "../../lib/formatTokenAmount.js";

const DEFAULT_PAGE_SIZE = DEFAULT_LIST_PAGE_SIZE;
const ST = ["pending", "success", "failed"];

export default function AdminTransactions() {
  const queryClient = useQueryClient();
  const { portalEnvironmentKey } = useMerchantPortalEnvironment();
  const [page, setPage] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detailTx, setDetailTx] = useState(null);
  const [applied, setApplied] = useState({
    merchant_id: "",
    external_user_id: "",
    chain: "",
    status: "",
    token_symbol: "",
    address: "",
    pageSize: DEFAULT_PAGE_SIZE,
  });

  const res = useQuery({
    queryKey: [
      "admin-txs",
      page,
      applied.pageSize,
      applied.merchant_id,
      applied.external_user_id,
      applied.chain,
      applied.status,
      applied.token_symbol,
      applied.address,
      portalEnvironmentKey,
    ],
    queryFn: () => {
      const p = new URLSearchParams({ page: String(page), pageSize: String(applied.pageSize) });
      if (applied.merchant_id.trim()) p.set("merchant_id", applied.merchant_id.trim());
      if (applied.external_user_id.trim()) p.set("external_user_id", applied.external_user_id.trim());
      if (applied.chain) p.set("chain", applied.chain);
      if (applied.status) p.set("status", applied.status);
      if (applied.token_symbol.trim()) p.set("token_symbol", applied.token_symbol.trim());
      if (applied.address.trim()) p.set("address", applied.address.trim());
      return api(`/api/v1/admin/transactions?${p}`);
    },
  });

  const redeliverMutation = useMutation({
    mutationFn: (txId) =>
      api(`/api/v1/admin/transactions/${encodeURIComponent(txId)}/redeliver-callback`, {
        method: "POST",
        json: {},
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-txs"] });
      setDetailTx((prev) =>
        prev
          ? {
              ...prev,
              callback_delivered_at: prev.callback_delivered_at ?? new Date().toISOString(),
            }
          : null,
      );
    },
  });

  const total = res.data?.total ?? 0;
  const rows = res.data?.transactions ?? [];
  const showEmpty = !res.isLoading && rows.length === 0;

  const hasActiveFilters = Boolean(
    applied.merchant_id.trim() ||
      applied.external_user_id.trim() ||
      applied.chain ||
      applied.status ||
      applied.token_symbol.trim() ||
      applied.address.trim(),
  );
  const hasNonDefaultPageSize = applied.pageSize !== DEFAULT_PAGE_SIZE;
  const hasFilterChips = hasActiveFilters || hasNonDefaultPageSize;
  const canReset = page > 1 || hasFilterChips;

  function resetAll() {
    setApplied({
      merchant_id: "",
      external_user_id: "",
      chain: "",
      status: "",
      token_symbol: "",
      address: "",
      pageSize: DEFAULT_PAGE_SIZE,
    });
    setPage(1);
    setDrawerOpen(false);
  }

  function patchApplied(partial) {
    setApplied((a) => ({ ...a, ...partial }));
    setPage(1);
  }

  const redeliverErr =
    redeliverMutation.isError && detailTx?.id === redeliverMutation.variables
      ? String(redeliverMutation.error?.message ?? "Request failed")
      : null;

  return (
    <div>
      <TransactionDetailModal
        open={Boolean(detailTx)}
        transaction={detailTx}
        onClose={() => {
          if (!redeliverMutation.isPending) {
            setDetailTx(null);
            redeliverMutation.reset();
          }
        }}
        onRedeliverCallback={() => {
          if (detailTx) redeliverMutation.mutate(detailTx.id);
        }}
        redeliverLoading={redeliverMutation.isPending}
        redeliverError={redeliverErr}
      />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-semibold text-white">Transactions</h1>
          <p className="mt-1 text-sm text-white/50">
            Same detail view and webhook resend as the merchant portal, across all merchants. Scope (live
            vs sandbox) follows your Profile setting.
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
          {applied.merchant_id.trim() ? (
            <span className="filter-chip max-w-full">
              <span className="filter-chip-label">Merchant</span>
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
          {applied.external_user_id.trim() ? (
            <span className="filter-chip max-w-full">
              <span className="filter-chip-label">User</span>
              <span
                className="max-w-[min(240px,45vw)] truncate font-mono text-[10px]"
                title={applied.external_user_id}
              >
                {applied.external_user_id}
              </span>
              <button
                type="button"
                className={listFilterChipCloseClass}
                onClick={() => patchApplied({ external_user_id: "" })}
                aria-label="Remove external user filter"
              >
                ×
              </button>
            </span>
          ) : null}
          {applied.chain ? (
            <span className="filter-chip">
              <span className="filter-chip-label">Chain</span>
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
            <span className="filter-chip">
              <span className="filter-chip-label">Status</span>
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
            <span className="filter-chip max-w-full">
              <span className="filter-chip-label">Token</span>
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
          {applied.address.trim() ? (
            <span className="inline-flex max-w-full items-center gap-1 rounded-xl border border-white/20 bg-white/[0.08] px-2.5 py-1.5 pl-3 text-xs text-white/85">
              <span className="text-[10px] font-semibold tracking-wide text-white/50 uppercase">Address</span>
              <span className="max-w-[min(240px,50vw)] truncate font-mono text-[10px]" title={applied.address}>
                {applied.address}
              </span>
              <button
                type="button"
                className={listFilterChipCloseClass}
                onClick={() => patchApplied({ address: "" })}
                aria-label="Remove address filter"
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
              merchant_id: applied.merchant_id,
              external_user_id: applied.external_user_id,
              chain: applied.chain,
              status: applied.status,
              token_symbol: applied.token_symbol,
              address: applied.address,
            }}
            validationSchema={adminTransactionsFilterSchema}
            validateOnBlur
            validateOnChange={false}
            onSubmit={(vals, { setSubmitting }) => {
              setApplied((a) => ({
                ...a,
                merchant_id: vals.merchant_id,
                external_user_id: vals.external_user_id,
                chain: vals.chain,
                status: vals.status,
                token_symbol: vals.token_symbol,
                address: vals.address,
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
                      <label className={listFilterLabelClass} htmlFor="adm-tx-merchant">
                        Merchant id
                      </label>
                      <Field
                        id="adm-tx-merchant"
                        name="merchant_id"
                        className={listFilterInputClass}
                        placeholder="Merchant id"
                      />
                      <ErrorMessage name="merchant_id" component="p" className="mt-1 text-xs text-rose-400" />
                    </div>
                    <div>
                      <label className={listFilterLabelClass} htmlFor="adm-tx-ext-user">
                        External user ID
                      </label>
                      <Field
                        id="adm-tx-ext-user"
                        name="external_user_id"
                        className={listFilterInputClass}
                        placeholder="Gateway external_user_id"
                      />
                      <ErrorMessage
                        name="external_user_id"
                        component="p"
                        className="mt-1 text-xs text-rose-400"
                      />
                    </div>
                    <div>
                      <label className={listFilterLabelClass} htmlFor="adm-tx-chain">
                        Chain
                      </label>
                      <Field id="adm-tx-chain" name="chain" as="select" className={listFilterInputClass}>
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
                      <label className={listFilterLabelClass} htmlFor="adm-tx-status">
                        Status
                      </label>
                      <Field id="adm-tx-status" name="status" as="select" className={listFilterInputClass}>
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
                      <label className={listFilterLabelClass} htmlFor="adm-tx-token">
                        Token symbol
                      </label>
                      <Field id="adm-tx-token" name="token_symbol" className={listFilterInputClass} placeholder="e.g. USDT" />
                      <ErrorMessage name="token_symbol" component="p" className="mt-1 text-xs text-rose-400" />
                    </div>
                    <div>
                      <label className={listFilterLabelClass} htmlFor="adm-tx-addr">
                        Deposit address
                      </label>
                      <Field
                        id="adm-tx-addr"
                        name="address"
                        className={listFilterInputClass}
                        placeholder="0x… or partial"
                      />
                      <ErrorMessage name="address" component="p" className="mt-1 text-xs text-rose-400" />
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
                          external_user_id: "",
                          chain: "",
                          status: "",
                          token_symbol: "",
                          address: "",
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
        <div className="data-table-surface">
          <table className="data-table min-w-[960px]">
            <thead>
              <tr>
                <th>Transaction ID</th>
                <th>When</th>
                <th>Merchant</th>
                <th>User</th>
                <th>Chain</th>
                <th>Token</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {res.isLoading ? (
                <tr>
                  <td colSpan={8} className="!py-12 text-center text-sm text-white/40">
                    Loading…
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
              {!res.isLoading &&
                rows.map((t) => (
                  <tr key={t.id}>
                    <td className="max-w-[200px]">
                      <button
                        type="button"
                        onClick={() => {
                          redeliverMutation.reset();
                          setDetailTx(t);
                        }}
                        className="max-w-full truncate text-left font-mono text-xs text-sky-300/95 underline decoration-sky-500/40 underline-offset-2 transition hover:text-sky-200 hover:decoration-sky-300/70"
                        title={t.id}
                      >
                        {t.id.length > 18 ? `${t.id.slice(0, 10)}…${t.id.slice(-6)}` : t.id}
                      </button>
                    </td>
                    <td className="text-xs text-white/45">{t.created_at.slice(0, 19)}</td>
                    <td className="max-w-[130px] truncate text-xs" title={t.merchant?.email ?? ""}>
                      {t.merchant?.email ?? "—"}
                    </td>
                    <td className="max-w-[120px] truncate font-mono text-xs">{t.external_user_id}</td>
                    <td>{t.chain}</td>
                    <td>{t.token_symbol}</td>
                    <td className="font-mono text-xs">
                      <span className="text-white/90">
                        {formatTokenAmount(t.amount, t.token_decimals)}
                      </span>
                      <span className="mt-0.5 block text-[10px] text-white/35">
                        raw {t.amount}
                      </span>
                    </td>
                    <td className="text-xs">{t.status}</td>
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
