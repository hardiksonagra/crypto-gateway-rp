import { Formik, Form, Field, ErrorMessage } from "formik";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../../api";
import { usePanelApiPrefix } from "../../hooks/usePanelApiPrefix.js";
import TransactionDetailModal from "../../components/TransactionDetailModal.js";
import PayoutDetailModal from "../../components/PayoutDetailModal.js";
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
import { formatLocalDateTime } from "../../lib/formatLocalDateTime.js";
import { StatusBadge } from "../../components/StatusBadge.js";
import { BrandLoader } from "../../components/BrandLoader.js";
import { resellerPartnerLabel, resellerPartnerTitle } from "../../lib/resellerPartnerLabel.js";

const DEFAULT_PAGE_SIZE = DEFAULT_LIST_PAGE_SIZE;
const ST = ["created", "pending", "success", "failed", "underpaid"];

export default function AdminTransactions() {
  const { apiPrefix, isRp } = usePanelApiPrefix();
  const queryClient = useQueryClient();
  const { portalEnvironmentKey } = useMerchantPortalEnvironment();
  const { pathname } = useLocation();
  const ledgerTab = pathname.endsWith("/pay-outs") ? "payout" : "payin";
  const [page, setPage] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [txModal, setTxModal] = useState(null);
  const [applied, setApplied] = useState({
    merchant_id: "",
    external_user_id: "",
    transaction_id: "",
    chain: "",
    status: "",
    token_symbol: "",
    address: "",
    pageSize: DEFAULT_PAGE_SIZE,
  });

  const adminPayoutBlocked =
    !isRp && ledgerTab === "payout" && !applied.merchant_id.trim();

  const res = useQuery({
    queryKey: [
      isRp ? "rp-txs" : "admin-txs",
      ledgerTab,
      page,
      applied.pageSize,
      applied.merchant_id,
      applied.external_user_id,
      applied.transaction_id,
      applied.chain,
      applied.status,
      applied.token_symbol,
      applied.address,
      portalEnvironmentKey,
    ],
    queryFn: () => {
      const p = new URLSearchParams({
        page: String(page),
        pageSize: String(applied.pageSize),
        ledger_kind: ledgerTab === "payout" ? "payout" : "deposit",
      });
      if (applied.merchant_id.trim()) p.set("merchant_id", applied.merchant_id.trim());
      if (applied.external_user_id.trim()) p.set("external_user_id", applied.external_user_id.trim());
      if (applied.transaction_id.trim()) p.set("transaction_id", applied.transaction_id.trim());
      if (applied.chain) p.set("chain", applied.chain);
      if (applied.status) p.set("status", applied.status);
      if (applied.token_symbol.trim()) p.set("token_symbol", applied.token_symbol.trim());
      if (applied.address.trim()) p.set("address", applied.address.trim());
      return api(`${apiPrefix}/transactions?${p}`);
    },
    enabled: !adminPayoutBlocked,
  });

  const redeliverMutation = useMutation({
    mutationFn: (txId) =>
      api(`${apiPrefix}/transactions/${encodeURIComponent(txId)}/redeliver-callback`, {
        method: "POST",
        json: {},
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-txs"] });
      void queryClient.invalidateQueries({ queryKey: ["rp-txs"] });
      setTxModal((prev) =>
        prev?.kind === "deposit"
          ? {
              ...prev,
              deposit: {
                ...prev.deposit,
                callback_delivered_at:
                  prev.deposit.callback_delivered_at ?? new Date().toISOString(),
              },
            }
          : prev,
      );
    },
  });

  const rescanTronMutation = useMutation({
    mutationFn: (txId) =>
      api(`${apiPrefix}/transactions/${encodeURIComponent(txId)}/rescan-tron-deposit`, {
        method: "POST",
        json: {},
      }),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["admin-txs"] });
      void queryClient.invalidateQueries({ queryKey: ["rp-txs"] });
      const patch = data && typeof data === "object" ? data.transaction : null;
      if (patch && typeof patch === "object") {
        setTxModal((prev) =>
          prev?.kind === "deposit" ? { ...prev, deposit: { ...prev.deposit, ...patch } } : prev,
        );
      }
    },
  });

  const total = adminPayoutBlocked ? 0 : (res.data?.total ?? 0);
  const rawLedger =
    Array.isArray(res.data?.ledger) && res.data.ledger.length > 0
      ? res.data.ledger
      : (res.data?.transactions ?? []).map((d) => ({
          kind: "deposit",
          created_at: d.created_at,
          deposit: d,
        }));
  const ledgerEntries = adminPayoutBlocked
    ? []
    : ledgerTab === "payout"
      ? rawLedger.filter((e) => e.kind === "payout")
      : rawLedger.filter((e) => e.kind === "deposit");
  const showEmpty =
    adminPayoutBlocked || (!res.isLoading && ledgerEntries.length === 0);

  const hasActiveFilters = Boolean(
    applied.merchant_id.trim() ||
      applied.external_user_id.trim() ||
      applied.transaction_id.trim() ||
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
      transaction_id: "",
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
    redeliverMutation.isError &&
    txModal?.kind === "deposit" &&
    txModal.deposit?.id === redeliverMutation.variables
      ? String(redeliverMutation.error?.message ?? "Request failed")
      : null;

  const rescanTronErr =
    rescanTronMutation.isError &&
    txModal?.kind === "deposit" &&
    txModal.deposit?.id === rescanTronMutation.variables
      ? String(rescanTronMutation.error?.message ?? "Request failed")
      : null;

  const depRow = txModal?.kind === "deposit" ? txModal.deposit : null;
  const rescanTronVisible =
    Boolean(depRow) &&
    depRow.chain === "TRON" &&
    String(depRow.currency ?? "").toUpperCase() === "USDT" &&
    String(depRow.network ?? "").toUpperCase() === "TRC20";

  return (
    <div>
      <TransactionDetailModal
        open={txModal?.kind === "deposit"}
        transaction={depRow}
        onClose={() => {
          if (!redeliverMutation.isPending && !rescanTronMutation.isPending) {
            setTxModal(null);
            redeliverMutation.reset();
            rescanTronMutation.reset();
          }
        }}
        onRedeliverCallback={() => {
          if (txModal?.kind === "deposit") redeliverMutation.mutate(txModal.deposit.id);
        }}
        redeliverLoading={redeliverMutation.isPending}
        redeliverError={redeliverErr}
        rescanTronDepositVisible={rescanTronVisible}
        onRescanTronDeposit={() => {
          if (txModal?.kind === "deposit") rescanTronMutation.mutate(txModal.deposit.id);
        }}
        rescanTronDepositLoading={rescanTronMutation.isPending}
        rescanTronDepositError={rescanTronErr}
        operatorActions
      />
      <PayoutDetailModal
        open={txModal?.kind === "payout"}
        payout={txModal?.kind === "payout" ? txModal.payout : null}
        merchantEmail={txModal?.kind === "payout" ? txModal.merchant?.email ?? null : null}
        onClose={() => setTxModal(null)}
      />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-bold" style={{ color: "var(--text-1)" }}>
            {ledgerTab === "payout" ? "Payout" : "Transactions"}
          </h1>
        </div>
        <ListFilterToolbar
          onOpenDrawer={() => setDrawerOpen(true)}
          onReset={resetAll}
          canReset={canReset}
        />
      </div>

      {adminPayoutBlocked ? (
        <p className="mt-4 text-sm text-amber-200/85">
          Choose a merchant filter (email or numeric id) to view payout records in the admin panel.
        </p>
      ) : null}

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
          {applied.transaction_id.trim() ? (
            <span className="filter-chip max-w-full">
              <span className="filter-chip-label">Reference ID</span>
              <span
                className="max-w-[min(240px,45vw)] truncate font-mono text-[10px]"
                title={applied.transaction_id}
              >
                {applied.transaction_id}
              </span>
              <button
                type="button"
                className={listFilterChipCloseClass}
                onClick={() => patchApplied({ transaction_id: "" })}
                aria-label="Remove reference transaction filter"
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
              transaction_id: applied.transaction_id,
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
                transaction_id: vals.transaction_id,
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
                      <label className={listFilterLabelClass} htmlFor="adm-tx-ref-id">
                        Reference / order ID
                      </label>
                      <Field
                        id="adm-tx-ref-id"
                        name="transaction_id"
                        className={listFilterInputClass}
                        placeholder="Gateway transaction_id (partial match)"
                      />
                      <ErrorMessage
                        name="transaction_id"
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
                          transaction_id: "",
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
          {ledgerTab === "payin" ? (
            <table className="data-table min-w-[1260px]">
              <thead>
                <tr>
                  <th>Transaction ID</th>
                  <th>Reference ID</th>
                  <th>When</th>
                  <th>Merchant</th>
                  <th className="text-xs">RP</th>
                  <th>User</th>
                  <th>Chain</th>
                  <th>Token</th>
                  <th>Requested</th>
                  <th>Received</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {res.isLoading && !adminPayoutBlocked ? (
                  <tr>
                    <td colSpan={11} className="!py-8">
                      <BrandLoader variant="inline" title="" subtitle="Loading…" />
                    </td>
                  </tr>
                ) : null}
                {showEmpty ? (
                  <tr>
                    <td colSpan={11} className="!py-12 text-center text-sm text-white/45">
                      No transactions found.
                    </td>
                  </tr>
                ) : null}
                {!res.isLoading &&
                  !adminPayoutBlocked &&
                  ledgerEntries.map((entry) => {
                    const t = entry.deposit;
                    return (
                      <tr key={`d-${t.id}`}>
                        <td className="max-w-[200px]">
                          <button
                            type="button"
                            onClick={() => {
                              redeliverMutation.reset();
                              rescanTronMutation.reset();
                              setTxModal({ kind: "deposit", deposit: t });
                            }}
                            className="max-w-full truncate text-left font-mono text-xs text-sky-300/95 underline decoration-sky-500/40 underline-offset-2 transition hover:text-sky-200 hover:decoration-sky-300/70"
                            title={String(t.id)}
                          >
                            {(() => {
                              const sid = String(t.id);
                              return sid.length > 18 ? `${sid.slice(0, 10)}…${sid.slice(-6)}` : sid;
                            })()}
                          </button>
                        </td>
                        <td className="max-w-[140px] truncate font-mono text-[10px] text-white/55" title={t.transaction_id ?? ""}>
                          {t.transaction_id ?? "—"}
                        </td>
                        <td className="text-xs text-white/45">{formatLocalDateTime(t.created_at)}</td>
                        <td className="max-w-[130px] truncate text-xs" title={t.merchant?.email ?? ""}>
                          {t.merchant?.email ?? "—"}
                        </td>
                        <td
                          className="max-w-[120px] truncate text-[10px] text-white/75"
                          title={resellerPartnerTitle(t)}
                        >
                          {resellerPartnerLabel(t)}
                        </td>
                        <td className="max-w-[120px] truncate font-mono text-xs">{t.external_user_id ?? "—"}</td>
                        <td>{t.chain}</td>
                        <td>{t.token_symbol}</td>
                        <td className="font-mono text-xs">
                          {t.requested_amount_decimal != null ? (
                            <>
                              <span className="text-white/90">
                                {t.requested_amount_decimal} {t.token_symbol}
                              </span>
                              {t.requested_amount_atomic ? (
                                <span className="mt-0.5 block text-[10px] text-white/35">
                                  raw {t.requested_amount_atomic}
                                </span>
                              ) : null}
                            </>
                          ) : (
                            <span className="text-white/35">—</span>
                          )}
                        </td>
                        <td className="font-mono text-xs">
                          <span className="text-white/90">
                            {formatTokenAmount(t.amount, t.token_decimals)}
                          </span>
                          <span className="mt-0.5 block text-[10px] text-white/35">
                            raw {t.amount}
                          </span>
                        </td>
                        <td>
                          <StatusBadge status={t.status} />
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          ) : (
            <table className="data-table min-w-[1280px]">
              <thead>
                <tr>
                  <th>Payout ID</th>
                  <th>Client reference</th>
                  <th>When</th>
                  <th>Merchant</th>
                  <th className="text-xs">RP</th>
                  <th>Chain</th>
                  <th>Token</th>
                  <th>Gross</th>
                  <th>Sent</th>
                  <th>Network fee</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {res.isLoading && !adminPayoutBlocked ? (
                  <tr>
                    <td colSpan={11} className="!py-8">
                      <BrandLoader variant="inline" title="" subtitle="Loading…" />
                    </td>
                  </tr>
                ) : null}
                {showEmpty ? (
                  <tr>
                    <td colSpan={11} className="!py-12 text-center text-sm text-white/45">
                      {adminPayoutBlocked
                        ? "Choose a merchant filter (email or id), then payout records load here."
                        : "No payout records found."}
                    </td>
                  </tr>
                ) : null}
                {!res.isLoading &&
                  !adminPayoutBlocked &&
                  ledgerEntries.map((entry) => {
                    const p = entry.payout;
                    const merch = entry.merchant;
                    const pid = String(p.id ?? "");
                    return (
                      <tr key={`p-${pid}`}>
                        <td className="max-w-[200px]">
                          <button
                            type="button"
                            onClick={() =>
                              setTxModal({ kind: "payout", payout: p, merchant: merch })
                            }
                            className="max-w-full truncate text-left font-mono text-xs text-sky-300/95 underline decoration-sky-500/40 underline-offset-2 transition hover:text-sky-200 hover:decoration-sky-300/70"
                            title={pid}
                          >
                            {pid.length > 18 ? `${pid.slice(0, 10)}…${pid.slice(-6)}` : pid}
                          </button>
                        </td>
                        <td className="max-w-[140px] truncate font-mono text-[10px] text-white/55" title={p.client_reference_id ?? ""}>
                          {p.client_reference_id ?? "—"}
                        </td>
                        <td className="text-xs text-white/45">{formatLocalDateTime(p.created_at)}</td>
                        <td className="max-w-[130px] truncate text-xs" title={merch?.email ?? ""}>
                          {merch?.email ?? "—"}
                        </td>
                        <td className="max-w-[120px] truncate text-[10px] text-white/75" title={resellerPartnerTitle(entry)}>
                          {resellerPartnerLabel(entry)}
                        </td>
                        <td>{p.chain}</td>
                        <td>{p.token_symbol}</td>
                        <td className="font-mono text-xs">
                          {p.gross_amount_decimal != null ? (
                            <span className="text-white/90">
                              {p.gross_amount_decimal} {p.token_symbol}
                            </span>
                          ) : (
                            <span className="text-white/35">—</span>
                          )}
                        </td>
                        <td className="font-mono text-xs">
                          {p.net_amount_decimal != null ? (
                            <span className="text-white/90">
                              {p.net_amount_decimal} {p.token_symbol}
                            </span>
                          ) : (
                            <span className="text-white/35">—</span>
                          )}
                        </td>
                        <td className="font-mono text-xs text-amber-200/85">
                          {p.network_fee_native_decimal != null && p.network_fee_native_symbol ? (
                            <span title="Native gas / bandwidth burned by sender (TRX or ETH), not USDT">
                              {String(p.network_fee_native_decimal)} {String(p.network_fee_native_symbol)}
                            </span>
                          ) : (
                            <span className="text-white/35">—</span>
                          )}
                        </td>
                        <td>
                          <StatusBadge status={p.status} />
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          )}
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
