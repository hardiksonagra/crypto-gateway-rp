import { Formik, Form, Field, ErrorMessage } from "formik";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api";
import { useMerchantPortalEnvironment } from "../../hooks/useMerchantPortalEnvironment.js";
import ListPaginationBar, {
  DEFAULT_LIST_PAGE_SIZE,
} from "../../components/ListPaginationBar";
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
import { merchantWalletsFilterSchema } from "../../admin/merchantSchemas";
import WalletDepositActivityModal from "../../components/WalletDepositActivityModal";
import { BrandLoader } from "../../components/BrandLoader.js";
import {
  formatLocalDate,
  formatLocalDateTime,
} from "../../lib/formatLocalDateTime.js";

const DEFAULT_PAGE_SIZE = DEFAULT_LIST_PAGE_SIZE;

/** Set to `true` when merchants should see “Restart scan” on the wallets table again. */
const MERCHANT_RESTART_DEPOSIT_SCAN_ENABLED = false;

export default function MerchantWallets() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [activityWalletId, setActivityWalletId] = useState(null);
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
    queryKey: [
      "m-wallets",
      page,
      applied.pageSize,
      applied.q,
      portalEnvironmentKey,
    ],
    queryFn: () => {
      const p = new URLSearchParams({
        page: String(page),
        pageSize: String(applied.pageSize),
      });
      if (applied.q.trim()) p.set("q", applied.q.trim());
      return api(`/api/v1/merchant/wallets?${p}`);
    },
    enabled: envQueryEnabled,
  });

  const total = res.data?.total ?? 0;
  const wallets = res.data?.wallets ?? [];
  const scanTtlMin = res.data?.deposit_scan_ttl_minutes ?? 0;
  const showEmpty = !res.isLoading && wallets.length === 0;

  const reactivateScan = useMutation({
    mutationFn: (walletId) =>
      api(
        `/api/v1/merchant/wallets/${encodeURIComponent(walletId)}/reactivate-deposit-scan`,
        { method: "POST", json: {} },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["m-wallets"] });
    },
  });

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
        subtitle="Loading wallets…"
        aria-label="Loading wallets"
      />
    );
  }

  if (!liveGatewayEnabled && !sandboxGatewayEnabled) {
    return (
      <div>
        <h1 className="font-display text-2xl font-semibold text-white">
          Wallets
        </h1>
        <p className="mt-4 text-sm text-rose-200/90">
          Neither live nor sandbox gateway is enabled for your account. Contact
          support.
        </p>
      </div>
    );
  }

  if (!envQueryEnabled) {
    return (
      <BrandLoader
        variant="page"
        title=""
        subtitle="Preparing wallets…"
        aria-label="Preparing wallets list"
      />
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-semibold text-white">
            Wallets
          </h1>
          {environment === "live" && scanTtlMin > 0 ? (
            <p className="mt-2 max-w-3xl text-xs leading-relaxed text-white/40">
              New live wallets are scanned for deposits for{" "}
              <span className="font-mono text-white/55">{scanTtlMin}</span>{" "}
              minutes. The same address is still returned from the API after
              that; if a payer sends late, use{" "}
              <span className="text-white/50">Restart scan window</span> to
              watch again for another{" "}
              <span className="font-mono text-white/55">{scanTtlMin}</span>{" "}
              minutes (no new address).
            </p>
          ) : null}
          <p className="mt-2 max-w-3xl text-xs leading-relaxed text-white/40">
            <span className="text-white/55">Payers / success / tx rows</span>{" "}
            are from on-chain deposits we recorded.
            <span className="text-white/55"> Activity</span> shows each deposit
            time, external user, and amount. Pure API assignments without a
            deposit are not in that history.
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
              <span
                className="max-w-[min(280px,50vw)] truncate font-mono text-white/65"
                title={applied.q}
              >
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
              <span className="font-mono text-white/65">
                {applied.pageSize}
              </span>
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
            validationSchema={merchantWalletsFilterSchema}
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
                      <label
                        className={listFilterLabelClass}
                        htmlFor="m-wallets-q"
                      >
                        Search (address, wallet id, external user id)
                      </label>
                      <Field
                        id="m-wallets-q"
                        name="q"
                        className={listFilterInputClass}
                        placeholder="Type to filter…"
                      />
                      <ErrorMessage
                        name="q"
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
        <div className="data-table-surface overflow-x-auto">
          <table className="data-table min-w-[900px]">
            <thead>
              <tr>
                <th>Address</th>
                <th>Asset</th>
                <th>Chain</th>
                <th>External user</th>
                <th>Payers</th>
                <th>Success</th>
                <th>Tx rows</th>
                <th>Deposit scan</th>
                <th>Created</th>
                <th className="whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody>
              {res.isLoading ? (
                <tr>
                  <td colSpan={10} className="!py-8">
                    <BrandLoader
                      variant="inline"
                      title=""
                      subtitle="Loading…"
                    />
                  </td>
                </tr>
              ) : null}
              {showEmpty ? (
                <tr>
                  <td
                    colSpan={10}
                    className="!py-12 text-center text-sm text-white/45"
                  >
                    No record found.
                  </td>
                </tr>
              ) : null}
              {!res.isLoading &&
                wallets.map((w) => {
                  const txc = w.transaction_count ?? 0;
                  const scanLine =
                    environment !== "live"
                      ? "— (sandbox)"
                      : scanTtlMin <= 0
                        ? "Always on"
                        : txc > 0
                          ? "Always on (has payments)"
                          : !w.scan_expires_at
                            ? "Always on"
                            : w.deposit_scan_active
                              ? `Until ${formatLocalDateTime(w.scan_expires_at)}`
                              : "Window ended";
                  const canRestart =
                    environment === "live" && scanTtlMin > 0 && txc === 0;
                  return (
                    <tr key={w.id}>
                      <td>
                        <div
                          className="max-w-[min(320px,40vw)] font-mono text-xs text-white/75 break-all"
                          title={w.address}
                        >
                          {w.address}
                        </div>
                        <div
                          className="mt-0.5 font-mono text-[10px] text-white/35"
                          title={w.id}
                        >
                          {w.id}
                        </div>
                      </td>
                      <td className="whitespace-nowrap text-sm text-white/80">
                        {w.currency}{" "}
                        <span className="text-white/45">· {w.network}</span>
                      </td>
                      <td className="font-mono text-xs text-white/65">
                        {w.chain}
                      </td>
                      <td className="font-mono text-xs text-white/75">
                        {w.external_user_id}
                      </td>
                      <td className="font-mono text-xs text-white/75">
                        {w.distinct_payer_users ?? 0}
                      </td>
                      <td className="font-mono text-xs text-emerald-200/85">
                        {w.success_deposit_count ?? 0}
                      </td>
                      <td className="font-mono text-xs text-white/65">{txc}</td>
                      <td className="max-w-[200px] text-xs text-white/55">
                        {scanLine}
                      </td>
                      <td className="text-xs text-white/45">
                        {formatLocalDate(w.created_at)}
                      </td>
                      <td className="whitespace-nowrap">
                        <div className="flex flex-col items-start gap-1.5">
                          <button
                            type="button"
                            onClick={() => setActivityWalletId(w.id)}
                            className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-xs text-white/80 hover:bg-white/10"
                          >
                            Activity
                          </button>
                          {MERCHANT_RESTART_DEPOSIT_SCAN_ENABLED && canRestart ? (
                            <button
                              type="button"
                              disabled={reactivateScan.isPending}
                              onClick={() => reactivateScan.mutate(w.id)}
                              className="rounded-lg border border-sky-500/35 bg-sky-500/15 px-2.5 py-1 text-xs font-medium text-sky-200/95 transition hover:border-sky-400/50 hover:bg-sky-500/25 disabled:opacity-50"
                            >
                              Restart scan
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {MERCHANT_RESTART_DEPOSIT_SCAN_ENABLED && reactivateScan.isError ? (
          <p className="text-sm text-rose-300/90">
            {String(reactivateScan.error)}
          </p>
        ) : null}

        <ListPaginationBar
          page={page}
          setPage={setPage}
          total={total}
          pageSize={applied.pageSize}
          setPageSize={(n) => setApplied((a) => ({ ...a, pageSize: n }))}
        />
      </div>

      <WalletDepositActivityModal
        open={activityWalletId != null}
        walletId={activityWalletId}
        panel="merchant"
        onClose={() => setActivityWalletId(null)}
      />
    </div>
  );
}
