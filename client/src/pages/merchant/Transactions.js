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
import { CHAIN_VALUES, merchantTransactionsFilterSchema } from "../../admin/merchantSchemas";
import { formatTokenAmount } from "../../lib/formatTokenAmount.js";
import { formatLocalDateTime } from "../../lib/formatLocalDateTime.js";
import { BrandLoader } from "../../components/BrandLoader.js";

const DEFAULT_PAGE_SIZE = DEFAULT_LIST_PAGE_SIZE;
const ST = ["pending", "success", "failed"];

export default function MerchantTransactions() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detailTx, setDetailTx] = useState(null);
  const [applied, setApplied] = useState({
    chain: "",
    status: "",
    token_symbol: "",
    external_user_id: "",
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
    queryKey: [
      "m-txs",
      page,
      applied.pageSize,
      applied.chain,
      applied.status,
      applied.token_symbol,
      applied.external_user_id,
      portalEnvironmentKey,
    ],
    queryFn: () => {
      const p = new URLSearchParams({
        page: String(page),
        pageSize: String(applied.pageSize),
      });
      if (applied.chain) p.set("chain", applied.chain);
      if (applied.status) p.set("status", applied.status);
      if (applied.token_symbol.trim()) p.set("token_symbol", applied.token_symbol.trim());
      if (applied.external_user_id.trim()) p.set("external_user_id", applied.external_user_id.trim());
      return api(`/api/v1/merchant/transactions?${p}`);
    },
    enabled: envQueryEnabled,
  });

  const redeliverMutation = useMutation({
    mutationFn: (txId) =>
      api(`/api/v1/merchant/transactions/${encodeURIComponent(txId)}/redeliver-callback`, {
        method: "POST",
        json: {},
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["m-txs"] });
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

  if (flagsLoading) {
    return (
      <BrandLoader
        variant="page"
        title=""
        subtitle="Loading transactions…"
        aria-label="Loading transactions"
      />
    );
  }

  if (!liveGatewayEnabled && !sandboxGatewayEnabled) {
    return (
      <div>
        <h1 className="font-display text-2xl font-semibold text-white">Transactions</h1>
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
        subtitle="Preparing transactions…"
        aria-label="Preparing transactions list"
      />
    );
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
            <span className="filter-chip">
              <span className="filter-chip-label">Token</span>
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
            <span className="filter-chip max-w-full">
              <span className="filter-chip-label">User</span>
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
        <div className="data-table-surface">
          <table className="data-table min-w-[860px]">
            <thead>
              <tr>
                <th>Transaction ID</th>
                <th>When</th>
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
                  <td colSpan={7} className="!py-8">
                    <BrandLoader variant="inline" title="" subtitle="Loading…" />
                  </td>
                </tr>
              ) : null}
              {showEmpty ? (
                <tr>
                  <td colSpan={7} className="!py-12 text-center text-sm text-white/45">
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
                    <td className="text-xs text-white/45">{formatLocalDateTime(t.created_at)}</td>
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
