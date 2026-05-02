import { Formik, Form, Field, ErrorMessage } from "formik";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api";
import { usePanelApiPrefix } from "../../hooks/usePanelApiPrefix.js";
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
import { adminWalletsFilterSchema } from "../../admin/merchantSchemas";
import WalletDepositActivityModal from "../../components/WalletDepositActivityModal";
import { BrandLoader } from "../../components/BrandLoader.js";

/** Admin wallet explorer: filters, amounts from recorded deposits (transactions), activity modal. */
export default function AdminWalletDetails() {
  const { apiPrefix, isRp } = usePanelApiPrefix();
  const [page, setPage] = useState(1);
  const [activityWalletId, setActivityWalletId] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [applied, setApplied] = useState({
    q: "",
    merchant_id: "",
    chain: "",
    currency: "",
    network: "",
    pageSize: DEFAULT_LIST_PAGE_SIZE,
  });

  const listQ = useQuery({
    queryKey: [
      isRp ? "rp-wallets" : "admin-wallets",
      "details",
      page,
      applied.pageSize,
      applied.q,
      applied.merchant_id,
      applied.chain,
      applied.currency,
      applied.network,
    ],
    queryFn: () => {
      const p = new URLSearchParams({
        page: String(page),
        pageSize: String(applied.pageSize),
      });
      if (applied.q.trim()) p.set("q", applied.q.trim());
      if (applied.merchant_id.trim()) p.set("merchant_id", applied.merchant_id.trim());
      if (applied.chain.trim()) p.set("chain", applied.chain.trim().toUpperCase());
      if (applied.currency.trim()) p.set("currency", applied.currency.trim());
      if (applied.network.trim()) p.set("network", applied.network.trim());
      return api(`${apiPrefix}/wallets?${p}`);
    },
  });

  const total = listQ.data?.total ?? 0;
  const wallets = listQ.data?.wallets ?? [];

  const hasActiveFilters = Boolean(
    applied.q.trim() ||
      applied.merchant_id.trim() ||
      applied.chain.trim() ||
      applied.currency.trim() ||
      applied.network.trim(),
  );
  const hasNonDefaultPageSize = applied.pageSize !== DEFAULT_LIST_PAGE_SIZE;
  const canReset = page > 1 || hasActiveFilters || hasNonDefaultPageSize;

  function resetAll() {
    setApplied({
      q: "",
      merchant_id: "",
      chain: "",
      currency: "",
      network: "",
      pageSize: DEFAULT_LIST_PAGE_SIZE,
    });
    setPage(1);
    setDrawerOpen(false);
  }

  function patchApplied(partial) {
    setApplied((a) => ({ ...a, ...partial }));
    setPage(1);
  }

  const th =
    "border-b border-white/10 px-3 py-2 text-left text-[10px] font-semibold tracking-wide text-white/45 uppercase";
  const td = "border-b border-white/5 px-3 py-2.5 align-top text-sm text-white/85";

  return (
    <div className="w-full max-w-none">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-semibold text-white">Wallet details</h1>
          <p className="mt-1 max-w-3xl text-sm text-white/50 text-pretty">
            <span className="text-white/65">Successful deposits</span> shows the{" "}
            <span className="text-white/75">total amount</span> from successful deposit transactions recorded for that
            merchant&apos;s wallet (plus how many such deposits). Open <span className="text-white/75">Activity</span>{" "}
            for each payment. On-chain balance refresh is on <span className="text-white/75">All wallets</span>.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ListFilterToolbar
            onOpenDrawer={() => setDrawerOpen(true)}
            onReset={resetAll}
            canReset={canReset}
          />
        </div>
      </div>

      {hasActiveFilters || hasNonDefaultPageSize ? (
        <div className="mt-4">
        <ListActiveFiltersChips>
          {applied.q.trim() ? (
            <span className="filter-chip">
              <span className="filter-chip-label">Search</span>
              <span className="max-w-[200px] truncate font-mono text-white/65">{applied.q}</span>
              <button
                type="button"
                className={listFilterChipCloseClass}
                onClick={() => patchApplied({ q: "" })}
                aria-label="Remove search"
              >
                ×
              </button>
            </span>
          ) : null}
          {applied.merchant_id.trim() ? (
            <span className="filter-chip">
              <span className="filter-chip-label">Merchant</span>
              <span className="max-w-[180px] truncate font-mono">{applied.merchant_id}</span>
              <button
                type="button"
                className={listFilterChipCloseClass}
                onClick={() => patchApplied({ merchant_id: "" })}
                aria-label="Remove merchant"
              >
                ×
              </button>
            </span>
          ) : null}
          {applied.chain.trim() ? (
            <span className="filter-chip">
              <span className="filter-chip-label">Chain</span>
              {applied.chain}
              <button
                type="button"
                className={listFilterChipCloseClass}
                onClick={() => patchApplied({ chain: "" })}
                aria-label="Remove chain"
              >
                ×
              </button>
            </span>
          ) : null}
          {applied.currency.trim() ? (
            <span className="filter-chip">
              <span className="filter-chip-label">Currency</span>
              {applied.currency}
              <button
                type="button"
                className={listFilterChipCloseClass}
                onClick={() => patchApplied({ currency: "" })}
                aria-label="Remove currency"
              >
                ×
              </button>
            </span>
          ) : null}
          {applied.network.trim() ? (
            <span className="filter-chip">
              <span className="filter-chip-label">Network</span>
              {applied.network}
              <button
                type="button"
                className={listFilterChipCloseClass}
                onClick={() => patchApplied({ network: "" })}
                aria-label="Remove network"
              >
                ×
              </button>
            </span>
          ) : null}
          {hasNonDefaultPageSize ? (
            <span className="filter-chip">
              <span className="filter-chip-label">Page size</span>
              {applied.pageSize}
              <button
                type="button"
                className={listFilterChipCloseClass}
                onClick={() => patchApplied({ pageSize: DEFAULT_LIST_PAGE_SIZE })}
                aria-label="Reset page size"
              >
                ×
              </button>
            </span>
          ) : null}
        </ListActiveFiltersChips>
        </div>
      ) : null}

      <div className="glass mt-6 w-full overflow-x-auto rounded-2xl">
        <table className="w-full min-w-[640px] border-collapse text-left">
          <thead>
            <tr>
              <th className={th}>Merchant</th>
              <th className={th}>Address</th>
              <th className={th}>Rail</th>
              <th className={th}>Gateway env</th>
              <th className={th}>Successful deposits</th>
              <th className={th}>Activity</th>
            </tr>
          </thead>
          <tbody>
            {listQ.isLoading ? (
              <tr>
                <td colSpan={6} className={`${td} !py-6`}>
                  <BrandLoader variant="inline" title="" subtitle="Loading…" />
                </td>
              </tr>
            ) : wallets.length === 0 ? (
              <tr>
                <td colSpan={6} className={`${td} text-white/45`}>
                  No wallets match.
                </td>
              </tr>
            ) : (
              wallets.map((w) => (
                <tr key={w.id}>
                  <td className={td}>
                    <div className="max-w-[220px] truncate text-xs" title={w.merchant?.email}>
                      {w.merchant?.display_name ||
                        w.merchant?.displayName ||
                        w.merchant?.email ||
                        w.merchant?.id ||
                        "—"}
                    </div>
                  </td>
                  <td className={`${td} font-mono text-xs break-all`}>{w.address}</td>
                  <td className={td}>
                    <span className="font-medium text-white/90">
                      {w.currency} · {w.network}
                    </span>
                    <span className="mt-0.5 block font-mono text-[10px] text-white/35">{w.chain}</span>
                  </td>
                  <td className={`${td} text-xs capitalize`}>{w.gateway_environment ?? "—"}</td>
                  <td className={td}>
                    {w.success_received_display ? (
                      <span className="font-medium text-emerald-200/90">{w.success_received_display}</span>
                    ) : (
                      <span className="text-white/35">—</span>
                    )}
                    <span className="mt-0.5 block font-mono text-[11px] text-white/40">
                      {(w.success_deposit_count ?? 0) === 1
                        ? "1 deposit"
                        : `${w.success_deposit_count ?? 0} deposits`}
                    </span>
                  </td>
                  <td className={td}>
                    <button
                      type="button"
                      onClick={() => setActivityWalletId(w.id)}
                      className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-xs text-white/80 hover:bg-white/10"
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4">
        <ListPaginationBar
          page={page}
          setPage={setPage}
          pageSize={applied.pageSize}
          setPageSize={(n) => patchApplied({ pageSize: n })}
          total={total}
        />
      </div>

      <WalletDepositActivityModal
        open={activityWalletId != null}
        walletId={activityWalletId}
        panel={isRp ? "rp" : "admin"}
        onClose={() => setActivityWalletId(null)}
      />

      <ListFilterDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Filter wallets"
      >
        <Formik
          enableReinitialize
          initialValues={{
            q: applied.q,
            merchant_id: applied.merchant_id,
            chain: applied.chain,
            currency: applied.currency,
            network: applied.network,
            pageSize: String(applied.pageSize),
          }}
          validationSchema={adminWalletsFilterSchema}
          onSubmit={(values) => {
            patchApplied({
              q: values.q,
              merchant_id: values.merchant_id,
              chain: values.chain,
              currency: values.currency,
              network: values.network,
              pageSize: parseInt(values.pageSize, 10) || DEFAULT_LIST_PAGE_SIZE,
            });
            setDrawerOpen(false);
          }}
        >
          {({ isSubmitting }) => (
            <Form className="grid grid-cols-1 gap-4">
              <div>
                <label className={listFilterLabelClass} htmlFor="fwd-q">
                  Search
                </label>
                <Field id="fwd-q" name="q" className={listFilterInputClass} placeholder="Address, wallet id, user…" />
                <ErrorMessage name="q" component="p" className="mt-1 text-xs text-rose-400" />
              </div>
              <div>
                <label className={listFilterLabelClass} htmlFor="fwd-merchant">
                  Merchant id
                </label>
                <Field id="fwd-merchant" name="merchant_id" className={listFilterInputClass} />
              </div>
              <div>
                <label className={listFilterLabelClass} htmlFor="fwd-chain">
                  Chain
                </label>
                <Field id="fwd-chain" name="chain" className={listFilterInputClass} placeholder="TRON, ETH, …" />
              </div>
              <div>
                <label className={listFilterLabelClass} htmlFor="fwd-currency">
                  Currency
                </label>
                <Field id="fwd-currency" name="currency" className={listFilterInputClass} />
              </div>
              <div>
                <label className={listFilterLabelClass} htmlFor="fwd-network">
                  Network
                </label>
                <Field id="fwd-network" name="network" className={listFilterInputClass} />
              </div>
              <div>
                <label className={listFilterLabelClass} htmlFor="fwd-ps">
                  Page size
                </label>
                <Field id="fwd-ps" name="pageSize" as="select" className={listFilterInputClass}>
                  <option value="10">10</option>
                  <option value="20">20</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                </Field>
              </div>
              <div className="flex flex-wrap gap-2 pt-2">
                <button type="submit" disabled={isSubmitting} className={listFilterApplyButtonClass}>
                  Apply
                </button>
                <button
                  type="button"
                  className={listFilterSecondaryButtonClass}
                  onClick={() => setDrawerOpen(false)}
                >
                  Cancel
                </button>
              </div>
            </Form>
          )}
        </Formik>
      </ListFilterDrawer>
    </div>
  );
}
