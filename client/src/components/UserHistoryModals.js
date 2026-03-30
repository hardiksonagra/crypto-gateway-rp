import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

/**
 * @param {"admin" | "merchant"} panel
 * @param {string} userId
 * @param {string} [adminMerchantId]
 * @param {"assignments" | "deposits"} kind
 */
function userHistoryUrl(panel, userId, kind, adminMerchantId) {
  const enc = encodeURIComponent(userId);
  const base =
    kind === "assignments"
      ? panel === "admin"
        ? `/api/v1/admin/users/${enc}/wallet-assignment-history?limit=200`
        : `/api/v1/merchant/users/${enc}/wallet-assignment-history?limit=200`
      : panel === "admin"
        ? `/api/v1/admin/users/${enc}/payer-deposit-history?limit=200`
        : `/api/v1/merchant/users/${enc}/payer-deposit-history?limit=200`;
  if (panel === "admin" && adminMerchantId) {
    return `${base}&merchant_id=${encodeURIComponent(adminMerchantId)}`;
  }
  return base;
}

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {string | null} props.userId
 * @param {"admin" | "merchant"} props.panel
 * @param {string} [props.adminMerchantId]
 * @param {() => void} props.onClose
 */
export function UserAssignmentHistoryModal({
  open,
  userId,
  panel,
  adminMerchantId,
  onClose,
}) {
  const path =
    userId && open
      ? userHistoryUrl(panel, userId, "assignments", adminMerchantId)
      : "";

  const q = useQuery({
    queryKey: ["user-assignment-history", panel, userId, adminMerchantId ?? ""],
    queryFn: () => api(path),
    enabled: open && Boolean(userId),
  });

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !userId) return null;

  const labels = q.data?.source_labels ?? {};
  const events = q.data?.events ?? [];
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
        aria-labelledby="user-assign-history-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div className="min-w-0">
            <h2 id="user-assign-history-title" className="text-lg font-semibold text-white">
              Wallet assignment history
            </h2>
            <p className="mt-1 font-mono text-[11px] text-white/45 break-all">{userId}</p>
            <p className="mt-2 text-xs text-white/40">
              Each row is one deposit-address / create-wallet resolution for this end-user (newest first).
              Older data before this feature was added will not appear.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg border border-white/15 px-3 py-1.5 text-sm text-white/75 hover:bg-white/5"
          >
            Close
          </button>
        </div>

        <div className="max-h-[min(58vh,480px)] overflow-auto px-3 pb-4 pt-2">
          {q.isLoading ? (
            <p className="px-2 py-6 text-sm text-white/45">Loading…</p>
          ) : q.isError ? (
            <p className="px-2 py-6 text-sm text-rose-300/90">{String(q.error)}</p>
          ) : events.length === 0 ? (
            <p className="px-2 py-6 text-sm text-white/45">No assignment events recorded yet.</p>
          ) : (
            <table className="w-full min-w-[640px] border-collapse text-left">
              <thead>
                <tr>
                  <th className={th}>Time (UTC)</th>
                  <th className={th}>How</th>
                  <th className={th}>Address</th>
                  <th className={th}>Rail</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => (
                  <tr key={ev.id}>
                    <td className={`${td} whitespace-nowrap text-white/60`}>
                      {ev.at?.replace("T", " ").slice(0, 19) ?? "—"}
                    </td>
                    <td className={`${td} max-w-[220px] text-white/65`} title={labels[ev.source] ?? ev.source}>
                      {labels[ev.source] ?? ev.source}
                    </td>
                    <td className={`${td} max-w-[200px] break-all font-mono text-[10px] text-white/55`}>
                      {ev.wallet_address}
                    </td>
                    <td className={td}>
                      <span className="text-white/85">
                        {ev.currency} · {ev.network}
                      </span>
                      <span className="mt-0.5 block font-mono text-[10px] text-white/35">{ev.chain}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {string | null} props.userId
 * @param {"admin" | "merchant"} props.panel
 * @param {string} [props.adminMerchantId]
 * @param {() => void} props.onClose
 */
export function UserPayerDepositHistoryModal({
  open,
  userId,
  panel,
  adminMerchantId,
  onClose,
}) {
  const path =
    userId && open
      ? userHistoryUrl(panel, userId, "deposits", adminMerchantId)
      : "";

  const q = useQuery({
    queryKey: ["user-payer-deposit-history", panel, userId, adminMerchantId ?? ""],
    queryFn: () => api(path),
    enabled: open && Boolean(userId),
  });

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !userId) return null;

  const summary = q.data?.summary;
  const events = q.data?.events ?? [];
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
        aria-labelledby="user-deposit-history-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div className="min-w-0">
            <h2 id="user-deposit-history-title" className="text-lg font-semibold text-white">
              Deposit &amp; transaction history
            </h2>
            <p className="mt-1 font-mono text-[11px] text-white/45 break-all">{userId}</p>
            {summary ? (
              <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-white/55">
                <div>
                  <dt className="inline text-white/35">All tx rows</dt>{" "}
                  <dd className="inline font-mono text-white/80">{summary.total_transactions}</dd>
                </div>
                <div>
                  <dt className="inline text-white/35">Successful</dt>{" "}
                  <dd className="inline font-mono text-emerald-200/90">{summary.successful_deposits}</dd>
                </div>
                <div>
                  <dt className="inline text-white/35">Listed below</dt>{" "}
                  <dd className="inline font-mono text-white/80">{summary.rows_in_response}</dd>
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

        <div className="max-h-[min(58vh,480px)] overflow-auto px-3 pb-4 pt-2">
          {q.isLoading ? (
            <p className="px-2 py-6 text-sm text-white/45">Loading…</p>
          ) : q.isError ? (
            <p className="px-2 py-6 text-sm text-rose-300/90">{String(q.error)}</p>
          ) : events.length === 0 ? (
            <p className="px-2 py-6 text-sm text-white/45">No payer transactions for this user.</p>
          ) : (
            <table className="w-full min-w-[720px] border-collapse text-left">
              <thead>
                <tr>
                  <th className={th}>Time (UTC)</th>
                  <th className={th}>Amount</th>
                  <th className={th}>Status</th>
                  <th className={th}>Wallet</th>
                  <th className={th}>Tx</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => (
                  <tr key={ev.id}>
                    <td className={`${td} whitespace-nowrap text-white/60`}>
                      {ev.at?.replace("T", " ").slice(0, 19) ?? "—"}
                    </td>
                    <td className={td}>
                      <span className="text-white/90">{ev.amount_decimal}</span>{" "}
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
                    <td
                      className={`${td} max-w-[160px] break-all font-mono text-[10px] text-white/50`}
                      title={ev.wallet_address}
                    >
                      {ev.wallet_address}
                    </td>
                    <td
                      className={`${td} max-w-[120px] truncate font-mono text-[10px] text-white/45`}
                      title={ev.tx_hash}
                    >
                      {ev.tx_hash}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * @param {object} props
 * @param {number} props.count
 * @param {boolean} props.disabled
 * @param {() => void} props.onClick
 * @param {string} [props.title]
 */
export function UserHistoryCountButton({ count, disabled, onClick, title }) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={`min-w-[2.5rem] rounded-lg border px-2 py-1 text-center font-mono text-xs transition ${
        disabled
          ? "cursor-default border-white/10 text-white/30"
          : "border-sky-500/40 bg-sky-500/10 text-sky-100 hover:border-sky-400/55 hover:bg-sky-500/20"
      }`}
    >
      {count}
    </button>
  );
}
