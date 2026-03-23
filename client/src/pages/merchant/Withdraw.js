import { useMemo, useState } from "react";
import { Formik, Form, Field, ErrorMessage } from "formik";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api";
import {
  CHAIN_VALUES,
  EVM_CHAIN_VALUES,
  merchantWithdrawSchema,
  merchantWithdrawalsListFilterSchema,
} from "../../admin/merchantSchemas";
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

const DEFAULT_PAGE_SIZE = DEFAULT_LIST_PAGE_SIZE;
const WITHDRAW_ST = ["pending", "processing", "completed", "failed"];

const NATIVE = {
  ETH: "ETH",
  BNB: "BNB",
  POLYGON: "MATIC",
  ARBITRUM: "ETH",
  OPTIMISM: "ETH",
};

export default function MerchantWithdraw() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [historyFilters, setHistoryFilters] = useState({
    chain: "",
    status: "",
    token_symbol: "",
    to_address: "",
    pageSize: DEFAULT_PAGE_SIZE,
  });
  const [msg, setMsg] = useState(null);

  const listQ = useQuery({
    queryKey: [
      "m-withdrawals",
      page,
      historyFilters.pageSize,
      historyFilters.chain,
      historyFilters.status,
      historyFilters.token_symbol,
      historyFilters.to_address,
    ],
    queryFn: () => {
      const p = new URLSearchParams({
        page: String(page),
        pageSize: String(historyFilters.pageSize),
      });
      if (historyFilters.chain) p.set("chain", historyFilters.chain);
      if (historyFilters.status) p.set("status", historyFilters.status);
      if (historyFilters.token_symbol.trim()) p.set("token_symbol", historyFilters.token_symbol.trim());
      if (historyFilters.to_address.trim()) p.set("to_address", historyFilters.to_address.trim());
      return api(`/api/v1/merchant/withdrawals?${p}`);
    },
  });

  const dash = useQuery({
    queryKey: ["m-dash"],
    queryFn: () => api("/api/v1/merchant/dashboard"),
  });

  const total = listQ.data?.total ?? 0;
  const withdrawals = listQ.data?.withdrawals ?? [];
  const showEmpty = !listQ.isLoading && withdrawals.length === 0;

  const hasHistoryFilters = Boolean(
    historyFilters.chain ||
      historyFilters.status ||
      historyFilters.token_symbol.trim() ||
      historyFilters.to_address.trim(),
  );
  const hasNonDefaultHistoryPageSize = historyFilters.pageSize !== DEFAULT_PAGE_SIZE;
  const hasHistoryFilterChips = hasHistoryFilters || hasNonDefaultHistoryPageSize;
  const canResetHistory = page > 1 || hasHistoryFilterChips;

  function resetHistoryFilters() {
    setHistoryFilters({
      chain: "",
      status: "",
      token_symbol: "",
      to_address: "",
      pageSize: DEFAULT_PAGE_SIZE,
    });
    setPage(1);
    setHistoryDrawerOpen(false);
  }

  function patchHistoryFilters(partial) {
    setHistoryFilters((h) => ({ ...h, ...partial }));
    setPage(1);
  }

  const initialWithdraw = useMemo(
    () => ({ chain: "ETH", to_address: "", amount: "" }),
    [],
  );

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-white">Withdraw</h1>
      <p className="mt-1 max-w-2xl text-sm text-white/50">
        Native EVM withdrawals only: sends from the first deposit wallet on the selected chain that has
        enough balance for the payout plus gas. Token (USDT, etc.) pooling is not automated here.
      </p>

      <div className="mt-10 flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-sm font-semibold tracking-wide text-white/40 uppercase">Withdrawal history</h2>
        <ListFilterToolbar
          onOpenDrawer={() => setHistoryDrawerOpen(true)}
          onReset={resetHistoryFilters}
          canReset={canResetHistory}
        />
      </div>

      {hasHistoryFilterChips ? (
        <ListActiveFiltersChips>
          {historyFilters.chain ? (
            <span className="filter-chip">
              <span className="filter-chip-label">Chain</span>
              <span>{historyFilters.chain}</span>
              <button
                type="button"
                className={listFilterChipCloseClass}
                onClick={() => patchHistoryFilters({ chain: "" })}
                aria-label="Remove chain filter"
              >
                ×
              </button>
            </span>
          ) : null}
          {historyFilters.status ? (
            <span className="filter-chip">
              <span className="filter-chip-label">Status</span>
              <span>{historyFilters.status}</span>
              <button
                type="button"
                className={listFilterChipCloseClass}
                onClick={() => patchHistoryFilters({ status: "" })}
                aria-label="Remove status filter"
              >
                ×
              </button>
            </span>
          ) : null}
          {historyFilters.token_symbol.trim() ? (
            <span className="filter-chip">
              <span className="filter-chip-label">Token</span>
              <span className="font-mono">{historyFilters.token_symbol}</span>
              <button
                type="button"
                className={listFilterChipCloseClass}
                onClick={() => patchHistoryFilters({ token_symbol: "" })}
                aria-label="Remove token filter"
              >
                ×
              </button>
            </span>
          ) : null}
          {historyFilters.to_address.trim() ? (
            <span className="filter-chip max-w-full">
              <span className="filter-chip-label">To</span>
              <span className="max-w-[min(240px,50vw)] truncate font-mono text-[10px]" title={historyFilters.to_address}>
                {historyFilters.to_address}
              </span>
              <button
                type="button"
                className={listFilterChipCloseClass}
                onClick={() => patchHistoryFilters({ to_address: "" })}
                aria-label="Remove to-address filter"
              >
                ×
              </button>
            </span>
          ) : null}
          {hasNonDefaultHistoryPageSize ? (
            <span className="filter-chip">
              <span className="filter-chip-label">Page size</span>
              <span className="font-mono text-white/65">{historyFilters.pageSize}</span>
              <button
                type="button"
                className={listFilterChipCloseClass}
                onClick={() => patchHistoryFilters({ pageSize: DEFAULT_PAGE_SIZE })}
                aria-label="Reset page size"
              >
                ×
              </button>
            </span>
          ) : null}
        </ListActiveFiltersChips>
      ) : null}

      <ListFilterDrawer open={historyDrawerOpen} onClose={() => setHistoryDrawerOpen(false)}>
        {historyDrawerOpen ? (
          <Formik
            enableReinitialize
            initialValues={{
              chain: historyFilters.chain,
              status: historyFilters.status,
              token_symbol: historyFilters.token_symbol,
              to_address: historyFilters.to_address,
            }}
            validationSchema={merchantWithdrawalsListFilterSchema}
            validateOnBlur
            validateOnChange={false}
            onSubmit={(vals, { setSubmitting }) => {
              setHistoryFilters((h) => ({
                ...h,
                chain: vals.chain,
                status: vals.status,
                token_symbol: vals.token_symbol,
                to_address: vals.to_address,
              }));
              setPage(1);
              setHistoryDrawerOpen(false);
              setSubmitting(false);
            }}
          >
            {({ resetForm }) => (
              <Form className="flex min-h-0 flex-1 flex-col">
                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                  <div className="space-y-5">
                    <div>
                      <label className={listFilterLabelClass} htmlFor="m-wh-chain">
                        Chain
                      </label>
                      <Field id="m-wh-chain" name="chain" as="select" className={listFilterInputClass}>
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
                      <label className={listFilterLabelClass} htmlFor="m-wh-status">
                        Status
                      </label>
                      <Field id="m-wh-status" name="status" as="select" className={listFilterInputClass}>
                        <option value="">All status</option>
                        {WITHDRAW_ST.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </Field>
                      <ErrorMessage name="status" component="p" className="mt-1 text-xs text-rose-400" />
                    </div>
                    <div>
                      <label className={listFilterLabelClass} htmlFor="m-wh-token">
                        Token symbol
                      </label>
                      <Field id="m-wh-token" name="token_symbol" className={listFilterInputClass} placeholder="e.g. ETH" />
                      <ErrorMessage name="token_symbol" component="p" className="mt-1 text-xs text-rose-400" />
                    </div>
                    <div>
                      <label className={listFilterLabelClass} htmlFor="m-wh-to">
                        To address
                      </label>
                      <Field
                        id="m-wh-to"
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
                        values: { chain: "", status: "", token_symbol: "", to_address: "" },
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

      <div className="mt-4 space-y-4">
        <div className="data-table-surface">
          <table className="data-table min-w-[640px]">
            <thead>
              <tr>
                <th>When</th>
                <th>Chain</th>
                <th>Token</th>
                <th>Amount</th>
                <th>To</th>
                <th>Status</th>
                <th>Tx</th>
              </tr>
            </thead>
            <tbody>
              {listQ.isLoading ? (
                <tr>
                  <td colSpan={7} className="!py-12 text-center text-sm text-white/40">
                    Loading…
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
              {!listQ.isLoading &&
                withdrawals.map((w) => (
                  <tr key={w.id}>
                    <td className="text-xs text-white/45">{w.createdAt.slice(0, 19)}</td>
                    <td>{w.chain}</td>
                    <td>{w.tokenSymbol}</td>
                    <td className="font-mono text-xs">{w.amount}</td>
                    <td className="max-w-[140px] truncate font-mono text-[10px] text-white/50">{w.toAddress}</td>
                    <td className="text-xs">{w.status}</td>
                    <td className="max-w-[120px] truncate font-mono text-[10px] text-white/50">
                      {w.txHash ?? "—"}
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
          pageSize={historyFilters.pageSize}
          setPageSize={(n) => setHistoryFilters((h) => ({ ...h, pageSize: n }))}
        />
      </div>

      <h2 className="mt-12 text-sm font-semibold tracking-wide text-white/40 uppercase">New withdrawal</h2>
      <div className="mt-3 grid gap-8 lg:grid-cols-2">
        <Formik
          initialValues={initialWithdraw}
          validationSchema={merchantWithdrawSchema}
          validateOnBlur
          validateOnChange={false}
          onSubmit={async (values, { setSubmitting, resetForm }) => {
            setMsg(null);
            const sym = NATIVE[values.chain] ?? "ETH";
            try {
              const r = await api("/api/v1/merchant/withdrawals", {
                method: "POST",
                json: {
                  chain: values.chain,
                  to_address: values.to_address.trim(),
                  amount: values.amount.trim(),
                  token_symbol: sym,
                },
              });
              setMsg(`Sent. Tx: ${r.tx_hash}`);
              resetForm({ values: { ...initialWithdraw, chain: values.chain } });
              void qc.invalidateQueries({ queryKey: ["m-dash"] });
              void qc.invalidateQueries({ queryKey: ["m-withdrawals"] });
              setPage(1);
            } catch (err) {
              setMsg(String(err));
            } finally {
              setSubmitting(false);
            }
          }}
        >
          {({ isSubmitting }) => (
            <Form className="glass space-y-4 rounded-2xl p-6">
              <div>
                <label className="text-xs text-white/50" htmlFor="chain">
                  EVM chain
                </label>
                <Field
                  id="chain"
                  name="chain"
                  as="select"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
                >
                  {EVM_CHAIN_VALUES.map((c) => (
                    <option key={c} value={c}>
                      {c} (native {NATIVE[c]})
                    </option>
                  ))}
                </Field>
                <ErrorMessage name="chain" component="p" className="mt-1 text-xs text-rose-400" />
              </div>
              <div>
                <label className="text-xs text-white/50" htmlFor="to_address">
                  Destination 0x address
                </label>
                <Field
                  id="to_address"
                  name="to_address"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm"
                  placeholder="0x…"
                  autoComplete="off"
                />
                <ErrorMessage name="to_address" component="p" className="mt-1 text-xs text-rose-400" />
              </div>
              <div>
                <label className="text-xs text-white/50" htmlFor="amount">
                  Amount (smallest unit, e.g. wei)
                </label>
                <Field
                  id="amount"
                  name="amount"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm"
                  placeholder="1000000000000000000"
                  autoComplete="off"
                />
                <ErrorMessage name="amount" component="p" className="mt-1 text-xs text-rose-400" />
              </div>
              <button
                type="submit"
                disabled={isSubmitting}
                className="btn-primary w-full rounded-xl py-3 text-sm"
              >
                {isSubmitting ? "Submitting…" : "Withdraw"}
              </button>
              {msg ? <p className="text-sm text-amber-200/90">{msg}</p> : null}
            </Form>
          )}
        </Formik>

        <div className="glass rounded-2xl p-6">
          <h3 className="text-sm font-semibold text-white/80">Quick balances</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {(dash.data?.balances ?? [])
              .filter((b) => EVM_CHAIN_VALUES.includes(b.chain))
              .map((b) => (
                <li key={`${b.chain}-${b.token_symbol}`} className="flex justify-between font-mono text-xs">
                  <span className="text-white/60">
                    {b.chain} {b.token_symbol}
                  </span>
                  <span className="text-white/70">{b.balance_raw}</span>
                </li>
              ))}
            {(!dash.data?.balances?.length ||
              !dash.data.balances.some((b) => EVM_CHAIN_VALUES.includes(b.chain))) && (
              <li className="text-white/45">No EVM native balances to show.</li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
