import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { formatTokenAmount } from "../lib/formatTokenAmount.js";

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {string | null} props.walletId
 * @param {"admin" | "merchant"} props.panel
 * @param {() => void} props.onClose
 */
export default function WalletDepositActivityModal({ open, walletId, panel, onClose }) {
  const path =
    panel === "admin"
      ? `/api/v1/admin/wallets/${encodeURIComponent(walletId ?? "")}/deposit-activity?limit=200`
      : `/api/v1/merchant/wallets/${encodeURIComponent(walletId ?? "")}/deposit-activity?limit=200`;

  const q = useQuery({
    queryKey: ["wallet-deposit-activity", panel, walletId],
    queryFn: () => api(path),
    enabled: open && Boolean(walletId),
  });

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !walletId) return null;

  const summary = q.data?.summary;
  const events = q.data?.events ?? [];
  const note = q.data?.note;

  const th =
    "border-b border-white/10 px-2 py-2 text-left text-[10px] font-semibold tracking-wide text-white/45 uppercase";
  const td = "border-b border-white/5 px-2 py-2 align-top text-xs text-white/80";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={() => onClose()}
    >
      <div
        className="glass max-h-[min(90vh,720px)] w-full max-w-4xl overflow-hidden rounded-2xl border border-white/10 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-activity-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div className="min-w-0">
            <h2 id="wallet-activity-title" className="text-lg font-semibold text-white">
              Deposit activity
            </h2>
            <p className="mt-1 font-mono text-[11px] text-white/45 break-all">{walletId}</p>
            {note ? <p className="mt-2 text-xs leading-relaxed text-white/40">{note}</p> : null}
            {summary ? (
              <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-white/55">
                <div>
                  <dt className="inline text-white/35">Distinct payers</dt>{" "}
                  <dd className="inline font-mono text-white/80">{summary.distinct_payers}</dd>
                </div>
                <div>
                  <dt className="inline text-white/35">Successful deposits</dt>{" "}
                  <dd className="inline font-mono text-emerald-200/90">{summary.success_tx}</dd>
                </div>
                <div>
                  <dt className="inline text-white/35">All tx rows</dt>{" "}
                  <dd className="inline font-mono text-white/80">{summary.total_tx}</dd>
                </div>
              </dl>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg border border-white/15 px-3 py-1.5 text-sm text-white/75 hover:bg-white/5"
          >
            Close
          </button>
        </div>

        <div className="max-h-[min(60vh,480px)] overflow-auto px-3 pb-4 pt-2">
          {q.isLoading ? (
            <p className="px-2 py-6 text-sm text-white/45">Loading…</p>
          ) : q.isError ? (
            <p className="px-2 py-6 text-sm text-rose-300/90">{String(q.error)}</p>
          ) : events.length === 0 ? (
            <p className="px-2 py-6 text-sm text-white/45">No deposits recorded for this wallet.</p>
          ) : (
            <table className="w-full min-w-[640px] border-collapse text-left">
              <thead>
                <tr>
                  <th className={th}>Time (UTC)</th>
                  <th className={th}>External user</th>
                  <th className={th}>Amount</th>
                  <th className={th}>Status</th>
                  <th className={th}>Tx</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => {
                  const dec = formatTokenAmount(ev.amount, ev.token_decimals ?? 18);
                  return (
                    <tr key={ev.id}>
                      <td className={`${td} whitespace-nowrap text-white/60`}>
                        {ev.created_at?.replace("T", " ").slice(0, 19) ?? "—"}
                      </td>
                      <td className={`${td} font-mono text-[11px]`}>
                        {ev.external_user_id ?? "—"}
                      </td>
                      <td className={td}>
                        <span className="text-white/90">{dec}</span>{" "}
                        <span className="text-white/40">{ev.token_symbol}</span>
                      </td>
                      <td className={td}>
                        <span
                          className={
                            ev.status === "success"
                              ? "text-emerald-200/90"
                              : ev.status === "failed"
                                ? "text-rose-300/90"
                                : "text-amber-200/85"
                          }
                        >
                          {ev.status}
                        </span>
                      </td>
                      <td className={`${td} max-w-[140px] truncate font-mono text-[10px] text-white/50`} title={ev.tx_hash}>
                        {ev.tx_hash}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
