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

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 backdrop-blur-sm"
      style={{ background: "rgba(0,0,0,0.6)" }}
      role="presentation"
      onClick={() => onClose()}
    >
      <div
        className="modal-shell max-h-[min(90vh,720px)] w-full max-w-4xl overflow-hidden rounded-2xl shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-activity-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4"
             style={{ borderColor: "var(--border)" }}>
          <div className="min-w-0">
            <h2 id="wallet-activity-title" className="text-lg font-semibold" style={{ color: "var(--text-1)" }}>
              Deposit activity
            </h2>
            <p className="mt-1 font-mono text-[11px] break-all" style={{ color: "var(--text-3)" }}>
              {walletId}
            </p>
            {note ? (
              <p className="mt-2 text-xs leading-relaxed" style={{ color: "var(--text-3)" }}>{note}</p>
            ) : null}
            {summary ? (
              <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs">
                <div>
                  <dt className="inline" style={{ color: "var(--text-3)" }}>Distinct payers</dt>{" "}
                  <dd className="inline font-mono" style={{ color: "var(--text-1)" }}>{summary.distinct_payers}</dd>
                </div>
                <div>
                  <dt className="inline" style={{ color: "var(--text-3)" }}>Successful deposits</dt>{" "}
                  <dd className="inline font-mono" style={{ color: "#34d399" }}>{summary.success_tx}</dd>
                </div>
                <div>
                  <dt className="inline" style={{ color: "var(--text-3)" }}>All tx rows</dt>{" "}
                  <dd className="inline font-mono" style={{ color: "var(--text-1)" }}>{summary.total_tx}</dd>
                </div>
              </dl>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg border px-3 py-1.5 text-sm transition"
            style={{ borderColor: "var(--border-mid)", color: "var(--text-2)" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-surface3)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = ""; }}
          >
            Close
          </button>
        </div>

        <div className="max-h-[min(60vh,480px)] overflow-auto px-3 pb-4 pt-2">
          {q.isLoading ? (
            <p className="px-2 py-6 text-sm" style={{ color: "var(--text-3)" }}>Loading…</p>
          ) : q.isError ? (
            <p className="px-2 py-6 text-sm" style={{ color: "#f87171" }}>{String(q.error)}</p>
          ) : events.length === 0 ? (
            <p className="px-2 py-6 text-sm" style={{ color: "var(--text-3)" }}>No deposits recorded for this wallet.</p>
          ) : (
            <table className="w-full min-w-[640px] border-collapse text-left">
              <thead>
                <tr>
                  {["Time (UTC)", "External user", "Amount", "Status", "Tx"].map((h) => (
                    <th key={h} className="border-b px-2 py-2 text-left text-[10px] font-semibold tracking-wide uppercase"
                        style={{ borderColor: "var(--border)", color: "var(--text-3)" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => {
                  const dec = formatTokenAmount(ev.amount, ev.token_decimals ?? 18);
                  return (
                    <tr key={ev.id}>
                      <td className="border-b px-2 py-2 align-top text-xs whitespace-nowrap"
                          style={{ borderColor: "var(--border)", color: "var(--text-2)" }}>
                        {ev.created_at?.replace("T", " ").slice(0, 19) ?? "—"}
                      </td>
                      <td className="border-b px-2 py-2 align-top font-mono text-[11px]"
                          style={{ borderColor: "var(--border)", color: "var(--text-2)" }}>
                        {ev.external_user_id ?? "—"}
                      </td>
                      <td className="border-b px-2 py-2 align-top text-xs"
                          style={{ borderColor: "var(--border)" }}>
                        <span style={{ color: "var(--text-1)" }}>{dec}</span>{" "}
                        <span style={{ color: "var(--text-3)" }}>{ev.token_symbol}</span>
                      </td>
                      <td className="border-b px-2 py-2 align-top text-xs"
                          style={{ borderColor: "var(--border)" }}>
                        <span style={{
                          color: ev.status === "success" ? "#34d399"
                            : ev.status === "failed" ? "#f87171"
                            : "#fbbf24"
                        }}>
                          {ev.status}
                        </span>
                      </td>
                      <td className="border-b px-2 py-2 align-top max-w-[140px] truncate font-mono text-[10px]"
                          style={{ borderColor: "var(--border)", color: "var(--text-3)" }}
                          title={ev.tx_hash}>
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
