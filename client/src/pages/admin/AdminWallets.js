import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api";
import ListPaginationBar, { DEFAULT_LIST_PAGE_SIZE } from "../../components/ListPaginationBar";
import { BrandLoader } from "../../components/BrandLoader.js";

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
 * Bulk refresh can take minutes (1s spacing per wallet row). The API returns 202 immediately and
 * completes in the background; we poll status so the browser/proxy never holds one long request.
 *
 * @param {(p: { processed: number; total: number } | null) => void} [onScanProgress]
 * @returns {Promise<{ total: number, ok: number, failed: number }>}
 */
async function startOrWaitForBalanceRefresh(onScanProgress) {
  onScanProgress?.(null);
  try {
    await api("/api/v1/admin/wallets/refresh-balances", { method: "POST", json: {} });
  } catch (e) {
    const st = e && typeof e === "object" && "status" in e ? Number(e.status) : NaN;
    const code = e && typeof e === "object" && "errorCode" in e ? String(e.errorCode) : "";
    if (st !== 409 && code !== "refresh_in_progress") throw e;
  }
  const maxPolls = 4800;
  for (let i = 0; i < maxPolls; i++) {
    await new Promise((r) => setTimeout(r, 750));
    const s = await api("/api/v1/admin/wallets/refresh-balances/status");
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
    "Balance refresh did not finish in time. Check server logs or try again later.",
  );
}

/** All wallets: one row per gateway wallet (pool address); balances cached after full refresh. */
export default function AdminWallets() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_LIST_PAGE_SIZE);
  /** Live “wallet rows probed / total” while a bulk balance refresh runs (all DB rows, not only this table page). */
  const [balanceRefreshScan, setBalanceRefreshScan] = useState(
    /** @type {{ processed: number; total: number } | null} */ (null),
  );

  const listQ = useQuery({
    queryKey: ["admin-wallets", "simple", "unique-address", "live", page, pageSize],
    queryFn: () => {
      const p = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        unique_address: "1",
        environment: "live",
      });
      return api(`/api/v1/admin/wallets?${p}`);
    },
  });

  const refreshMut = useMutation({
    mutationFn: () => startOrWaitForBalanceRefresh(setBalanceRefreshScan),
    onSettled: () => {
      setBalanceRefreshScan(null);
      void queryClient.invalidateQueries({ queryKey: ["admin-wallets"] });
    },
  });

  const total = listQ.data?.total ?? 0;
  const wallets = listQ.data?.wallets ?? [];

  const th =
    "border-b border-white/10 px-3 py-2 text-left text-[10px] font-semibold tracking-wide text-white/45 uppercase";
  const td = "border-b border-white/5 px-3 py-2.5 align-top text-sm text-white/85";

  return (
    <div className="w-full max-w-none">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-semibold text-white">All wallets</h1>
          <p className="mt-1 max-w-2xl text-sm text-white/50 text-pretty">
            <span className="text-white/65">Live</span> deposit wallets only (sandbox hidden). One row per on-chain
            address and rail; duplicate gateway rows for the same address are merged. Click{" "}
            <span className="text-white/75">Refresh balances</span> to re-read on-chain balances for{" "}
            <span className="text-white/75">all</span> wallet rows (including sandbox) and update cached values here.
          </p>
        </div>
        <button
          type="button"
          disabled={refreshMut.isPending}
          onClick={() => refreshMut.mutate()}
          className="rounded-lg bg-sky-600/90 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600 disabled:opacity-50"
        >
          {refreshMut.isPending ? "Refreshing…" : "Refresh balances"}
        </button>
      </div>

      {refreshMut.isError ? (
        <p className="mt-3 text-sm text-rose-400">{String(refreshMut.error)}</p>
      ) : null}
      {refreshMut.isPending ? (
        <p className="mt-3 text-sm text-sky-200/90">
          {balanceRefreshScan && balanceRefreshScan.total > 0 ? (
            <>
              Live scan:{" "}
              <span className="font-mono font-semibold text-white">
                {balanceRefreshScan.processed} / {balanceRefreshScan.total}
              </span>{" "}
              wallet rows (on-chain probe + cache update).
            </>
          ) : (
            <>Starting full balance refresh…</>
          )}
        </p>
      ) : null}
      {refreshMut.isSuccess ? (
        <p className="mt-3 text-sm text-emerald-200/90">
          Updated {refreshMut.data?.ok ?? 0} of {refreshMut.data?.total ?? 0} wallets
          {refreshMut.data?.failed ? ` (${refreshMut.data.failed} with errors or unsupported)` : ""}.
        </p>
      ) : null}

      <div className="glass mt-6 w-full overflow-x-auto rounded-2xl">
        <table className="w-full min-w-[640px] border-collapse text-left">
          <thead>
            <tr>
              <th className={th}>Wallet ID (rep.)</th>
              <th className={th}>Address</th>
              <th className={th}>Rail</th>
              <th className={th}>Cached balance</th>
              <th className={th}>Balance updated</th>
            </tr>
          </thead>
          <tbody>
            {listQ.isLoading ? (
              <tr>
                <td colSpan={5} className={`${td} !py-6`}>
                  <BrandLoader variant="inline" title="" subtitle="Loading…" />
                </td>
              </tr>
            ) : wallets.length === 0 ? (
              <tr>
                <td colSpan={5} className={`${td} text-white/45`}>
                  No wallets yet.
                </td>
              </tr>
            ) : (
              wallets.map((w) => (
                <tr key={w.id}>
                  <td className={`${td} font-mono text-xs text-white/90`}>
                    <span className="whitespace-nowrap">{w.id}</span>
                    {w.gateway_wallet_row_count > 1 ? (
                      <span
                        className="mt-1 block text-[10px] font-normal text-amber-200/80"
                        title="This address exists on more than one gateway wallet row (e.g. different merchants); balance is the same on-chain."
                      >
                        {w.gateway_wallet_row_count} DB rows merged
                      </span>
                    ) : null}
                  </td>
                  <td className={`${td} font-mono text-xs break-all`}>{w.address}</td>
                  <td className={td}>
                    <span className="font-medium text-white/90">
                      {w.currency} · {w.network}
                    </span>
                    <span className="mt-0.5 block font-mono text-[10px] text-white/35">{w.chain}</span>
                  </td>
                  <td className={td}>
                    {w.cached_balance_display ? (
                      <span
                        className={
                          hasPositiveCachedBalance(w)
                            ? "font-medium text-emerald-300"
                            : "text-white/90"
                        }
                      >
                        {w.cached_balance_display}
                      </span>
                    ) : w.cached_balance_error ? (
                      <span className="text-amber-200/85 text-xs" title={w.cached_balance_error}>
                        {w.cached_balance_error.length > 48
                          ? `${w.cached_balance_error.slice(0, 48)}…`
                          : w.cached_balance_error}
                      </span>
                    ) : (
                      <span className="text-white/35">—</span>
                    )}
                  </td>
                  <td className={`${td} whitespace-nowrap text-xs text-white/50`}>
                    {w.cached_balance_updated_at
                      ? new Date(w.cached_balance_updated_at).toLocaleString()
                      : "—"}
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
          pageSize={pageSize}
          setPageSize={(n) => {
            setPageSize(n);
            setPage(1);
          }}
          total={total}
        />
      </div>
    </div>
  );
}
