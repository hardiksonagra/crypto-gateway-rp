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
import { renderMerchantPortalBlockers } from "../../components/MerchantPortalPageGates.js";
import {
  formatLocalDate,
  formatLocalDateTime,
} from "../../lib/formatLocalDateTime.js";

const DEFAULT_PAGE_SIZE = DEFAULT_LIST_PAGE_SIZE;

/** Set to `true` when merchants should see “Restart scan” on the wallets table again. */
const MERCHANT_RESTART_DEPOSIT_SCAN_ENABLED = false;

/**
 * @param {{ cached_balance_atomic?: string | null }} w
 * @returns {boolean}
 */
function hasPositiveCachedBalance(w) {
  const a = w.cached_balance_atomic;
  if (typeof a !== "string" || !/^[0-9]+$/.test(a.trim())) return false;
  try {
    return BigInt(a.trim()) > 0n;
  } catch {
    return false;
  }
}

/**
 * @param {string} address
 * @returns {string}
 */
function shortAddress(address) {
  const a = String(address ?? "").trim();
  if (a.length <= 16) return a;
  return `${a.slice(0, 8)}…${a.slice(-6)}`;
}

/**
 * @param {string} text
 */
async function copyToClipboard(text) {
  const t = String(text ?? "").trim();
  if (!t) return false;
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {(p: { processed: number; total: number } | null) => void} [onScanProgress]
 * @returns {Promise<{ total: number, ok: number, failed: number }>}
 */
async function startOrWaitForMerchantBalanceRefresh(onScanProgress) {
  onScanProgress?.(null);
  try {
    await api("/api/v1/merchant/wallets/refresh-balances", {
      method: "POST",
      json: {},
    });
  } catch (e) {
    const st = e && typeof e === "object" && "status" in e ? Number(e.status) : NaN;
    const code =
      e && typeof e === "object" && "errorCode" in e ? String(e.errorCode) : "";
    if (st !== 409 && code !== "refresh_in_progress") throw e;
  }
  const maxPolls = 4800;
  for (let i = 0; i < maxPolls; i++) {
    await new Promise((r) => setTimeout(r, 750));
    const s = await api("/api/v1/merchant/wallets/refresh-balances/status");
    const st = Number(s.scan_total ?? 0);
    if (st > 0) {
      onScanProgress?.({
        processed: Number(s.scan_processed ?? 0),
        total: st,
      });
    }
    if (!s.running) {
      onScanProgress?.(null);
      if (typeof s.error === "string" && s.error.trim()) {
        throw new Error(s.error.trim());
      }
      return {
        total: Number(s.total ?? 0),
        ok: Number(s.ok ?? 0),
        failed: Number(s.failed ?? 0),
      };
    }
  }
  throw new Error(
    "Balance refresh did not finish in time. Check again later.",
  );
}

export default function MerchantWallets() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [activityWalletId, setActivityWalletId] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [balanceRefreshScan, setBalanceRefreshScan] = useState(
    /** @type {{ processed: number; total: number } | null} */ (null),
  );
  const [copiedId, setCopiedId] = useState(/** @type {string | null} */ (null));
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
    needsPortalSwitch,
    merchantApiReady,
    portalListAccess,
    portalListDeniedMessage,
    wrongPortalRole,
    authMeIsError,
    authMeError,
  } = useMerchantPortalEnvironment();

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
    enabled: merchantApiReady,
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

  const refreshBalances = useMutation({
    mutationFn: () => startOrWaitForMerchantBalanceRefresh(setBalanceRefreshScan),
    onSettled: () => {
      setBalanceRefreshScan(null);
      void queryClient.invalidateQueries({ queryKey: ["m-wallets"] });
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

  const portalGate = renderMerchantPortalBlockers({
    pageTitle: "Wallets",
    loaderSubtitle: "Loading wallets…",
    flagsLoading,
    authMeIsError,
    authMeError,
    liveGatewayEnabled,
    sandboxGatewayEnabled,
    needsPortalSwitch,
    environment,
    merchantApiReady,
    portalListAccess,
    portalListDeniedMessage,
    wrongPortalRole,
  });
  if (portalGate) return portalGate;

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-white">
            Wallets
          </h1>
          <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-white/50">
            Deposit addresses and cached on-chain USDT. Refresh to update balances from the chain.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={refreshBalances.isPending}
            onClick={() => refreshBalances.mutate()}
            className="inline-flex h-10 items-center rounded-xl bg-sky-500 px-4 text-sm font-semibold text-white shadow-sm shadow-sky-950/40 transition hover:bg-sky-400 disabled:opacity-50"
          >
            {refreshBalances.isPending ? "Refreshing…" : "Refresh balances"}
          </button>
          <ListFilterToolbar
            onOpenDrawer={() => setDrawerOpen(true)}
            onReset={resetAll}
            canReset={canReset}
          />
        </div>
      </div>

      {refreshBalances.isError ? (
        <p className="mt-4 rounded-xl border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {String(refreshBalances.error)}
        </p>
      ) : null}
      {refreshBalances.isPending ? (
        <p className="mt-4 rounded-xl border border-sky-400/20 bg-sky-500/10 px-3 py-2 text-sm text-sky-100/90">
          {balanceRefreshScan && balanceRefreshScan.total > 0 ? (
            <>
              Scanning{" "}
              <span className="font-mono font-semibold text-white">
                {balanceRefreshScan.processed}/{balanceRefreshScan.total}
              </span>
            </>
          ) : (
            <>Starting balance refresh…</>
          )}
        </p>
      ) : null}
      {refreshBalances.isSuccess ? (
        <p className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100/90">
          Updated {refreshBalances.data?.ok ?? 0} of {refreshBalances.data?.total ?? 0}
          {refreshBalances.data?.failed
            ? ` · ${refreshBalances.data.failed} with errors`
            : ""}
        </p>
      ) : null}

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

      <div className="mt-8 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0b0f1a]/80 shadow-[0_0_0_1px_rgba(255,255,255,0.03)_inset] ring-1 ring-black/20">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] border-collapse text-left">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.03]">
                <th className="px-4 py-3 text-[11px] font-semibold tracking-wide text-white/55 uppercase">
                  Wallet
                </th>
                <th className="px-4 py-3 text-[11px] font-semibold tracking-wide text-white/55 uppercase">
                  Rail
                </th>
                <th className="px-4 py-3 text-[11px] font-semibold tracking-wide text-white/55 uppercase">
                  Balance
                </th>
                <th className="px-4 py-3 text-[11px] font-semibold tracking-wide text-white/55 uppercase">
                  User
                </th>
                <th className="px-4 py-3 text-[11px] font-semibold tracking-wide text-white/55 uppercase">
                  Activity
                </th>
                <th className="px-4 py-3 text-[11px] font-semibold tracking-wide text-white/55 uppercase">
                  Scan
                </th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold tracking-wide text-white/55 uppercase">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {res.isLoading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10">
                    <BrandLoader
                      variant="inline"
                      title=""
                      subtitle="Loading wallets…"
                    />
                  </td>
                </tr>
              ) : null}
              {showEmpty ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-14 text-center text-sm text-white/45"
                  >
                    No wallets in this environment yet.
                  </td>
                </tr>
              ) : null}
              {!res.isLoading &&
                wallets.map((w) => {
                  const txc = w.transaction_count ?? 0;
                  const scanLine =
                    environment !== "live"
                      ? "Sandbox"
                      : scanTtlMin <= 0
                        ? "Always on"
                        : txc > 0
                          ? "Always on"
                          : !w.scan_expires_at
                            ? "Always on"
                            : w.deposit_scan_active
                              ? `Until ${formatLocalDateTime(w.scan_expires_at)}`
                              : "Ended";
                  const canRestart =
                    environment === "live" && scanTtlMin > 0 && txc === 0;
                  const addr = String(w.address ?? "");
                  const copied = copiedId === String(w.id);
                  return (
                    <tr
                      key={w.id}
                      className="border-b border-white/[0.06] last:border-0 hover:bg-white/[0.025]"
                    >
                      <td className="px-4 py-3.5 align-middle">
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="min-w-0">
                            <p
                              className="font-mono text-[13px] font-medium tracking-tight text-white/90"
                              title={addr}
                            >
                              {shortAddress(addr)}
                            </p>
                            <p className="mt-0.5 font-mono text-[10px] text-white/35">
                              #{w.id}
                              <span className="text-white/25"> · </span>
                              {formatLocalDate(w.created_at)}
                            </p>
                          </div>
                          <button
                            type="button"
                            className="shrink-0 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-medium text-white/60 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white/85"
                            title="Copy full address"
                            onClick={() => {
                              void copyToClipboard(addr).then((ok) => {
                                if (!ok) return;
                                setCopiedId(String(w.id));
                                window.setTimeout(() => {
                                  setCopiedId((cur) =>
                                    cur === String(w.id) ? null : cur,
                                  );
                                }, 1200);
                              });
                            }}
                          >
                            {copied ? "Copied" : "Copy"}
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 align-middle whitespace-nowrap">
                        <p className="text-sm font-medium text-white/90">
                          {w.currency}
                          <span className="text-white/40"> · </span>
                          {w.network}
                        </p>
                        <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-white/40">
                          {w.chain}
                        </p>
                      </td>
                      <td className="px-4 py-3.5 align-middle whitespace-nowrap">
                        {w.cached_balance_display ? (
                          <p
                            className={
                              hasPositiveCachedBalance(w)
                                ? "text-sm font-semibold tabular-nums text-emerald-300"
                                : "text-sm font-medium tabular-nums text-white/80"
                            }
                          >
                            {w.cached_balance_display}
                          </p>
                        ) : w.cached_balance_error ? (
                          <p
                            className="max-w-[9rem] truncate text-xs text-amber-200/85"
                            title={w.cached_balance_error}
                          >
                            Probe error
                          </p>
                        ) : (
                          <p className="text-sm text-white/35">—</p>
                        )}
                        <p className="mt-0.5 text-[10px] text-white/35">
                          {w.cached_balance_updated_at
                            ? formatLocalDateTime(w.cached_balance_updated_at)
                            : "Not refreshed"}
                        </p>
                      </td>
                      <td className="px-4 py-3.5 align-middle">
                        <p
                          className="max-w-[9rem] truncate font-mono text-xs text-white/75"
                          title={w.external_user_id ?? undefined}
                        >
                          {w.external_user_id || "—"}
                        </p>
                      </td>
                      <td className="px-4 py-3.5 align-middle whitespace-nowrap">
                        <div className="flex items-center gap-3 font-mono text-[11px] tabular-nums text-white/55">
                          <span title="Payers">
                            <span className="text-white/35">P</span>{" "}
                            {w.distinct_payer_users ?? 0}
                          </span>
                          <span title="Success deposits" className="text-emerald-200/80">
                            <span className="text-emerald-200/40">S</span>{" "}
                            {w.success_deposit_count ?? 0}
                          </span>
                          <span title="Tx rows">
                            <span className="text-white/35">T</span> {txc}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 align-middle">
                        <p className="max-w-[8.5rem] truncate text-xs text-white/50" title={scanLine}>
                          {scanLine}
                        </p>
                      </td>
                      <td className="px-4 py-3.5 align-middle text-right whitespace-nowrap">
                        <div className="inline-flex flex-col items-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setActivityWalletId(w.id)}
                            className="rounded-lg border border-white/12 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-white/80 transition hover:bg-white/[0.08]"
                          >
                            Activity
                          </button>
                          {MERCHANT_RESTART_DEPOSIT_SCAN_ENABLED && canRestart ? (
                            <button
                              type="button"
                              disabled={reactivateScan.isPending}
                              onClick={() => reactivateScan.mutate(w.id)}
                              className="rounded-lg border border-sky-500/35 bg-sky-500/15 px-2.5 py-1 text-xs font-medium text-sky-200/95 transition hover:bg-sky-500/25 disabled:opacity-50"
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
      </div>

      {MERCHANT_RESTART_DEPOSIT_SCAN_ENABLED && reactivateScan.isError ? (
        <p className="mt-3 text-sm text-rose-300/90">
          {String(reactivateScan.error)}
        </p>
      ) : null}

      <div className="mt-4">
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
