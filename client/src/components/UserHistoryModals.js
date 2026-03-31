import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { BrandLoader } from "./BrandLoader.js";
import { formatLocalDateTime } from "../lib/formatLocalDateTime.js";

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

function ModalShell({ id, title, subtitle, extra, onClose, children }) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 backdrop-blur-sm"
      style={{ background: "rgba(0,0,0,0.6)" }}
      role="presentation"
      onClick={onClose}
    >
      <div
        className="modal-shell max-h-[min(90vh,720px)] w-full max-w-4xl overflow-hidden rounded-2xl shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4"
             style={{ borderColor: "var(--border)" }}>
          <div className="min-w-0">
            <h2 id={id} className="text-lg font-semibold" style={{ color: "var(--text-1)" }}>
              {title}
            </h2>
            {subtitle && (
              <p className="mt-1 font-mono text-[11px] break-all" style={{ color: "var(--text-3)" }}>
                {subtitle}
              </p>
            )}
            {extra}
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
        <div className="max-h-[min(58vh,480px)] overflow-auto px-3 pb-4 pt-2">
          {children}
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

  return (
    <ModalShell
      id="user-assign-history-title"
      title="Wallet assignment history"
      subtitle={userId}
      extra={
        <p className="mt-2 text-xs" style={{ color: "var(--text-3)" }}>
          Each row is one deposit-address / create-wallet resolution for this end-user (newest first).
          Older data before this feature was added will not appear.
        </p>
      }
      onClose={onClose}
    >
      {q.isLoading ? (
        <BrandLoader
          variant="inline"
          title=""
          subtitle="Loading…"
          className="px-2 py-4"
          aria-label="Loading assignment history"
        />
      ) : q.isError ? (
        <p className="px-2 py-6 text-sm" style={{ color: "#f87171" }}>{String(q.error)}</p>
      ) : events.length === 0 ? (
        <p className="px-2 py-6 text-sm" style={{ color: "var(--text-3)" }}>No assignment events recorded yet.</p>
      ) : (
        <table className="w-full min-w-[640px] border-collapse text-left">
          <thead>
            <tr>
              {["Time", "How", "Address", "Rail"].map((h) => (
                <th key={h} className="border-b px-2 py-2 text-left text-[10px] font-semibold tracking-wide uppercase"
                    style={{ borderColor: "var(--border)", color: "var(--text-3)" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {events.map((ev) => (
              <tr key={ev.id}>
                <td className="border-b px-2 py-2 align-top text-xs whitespace-nowrap"
                    style={{ borderColor: "var(--border)", color: "var(--text-2)" }}>
                  {formatLocalDateTime(ev.at)}
                </td>
                <td className="border-b px-2 py-2 align-top text-xs max-w-[220px]"
                    style={{ borderColor: "var(--border)", color: "var(--text-2)" }}
                    title={labels[ev.source] ?? ev.source}>
                  {labels[ev.source] ?? ev.source}
                </td>
                <td className="border-b px-2 py-2 align-top max-w-[200px] break-all font-mono text-[10px]"
                    style={{ borderColor: "var(--border)", color: "var(--text-3)" }}>
                  {ev.wallet_address}
                </td>
                <td className="border-b px-2 py-2 align-top text-xs"
                    style={{ borderColor: "var(--border)" }}>
                  <span style={{ color: "var(--text-1)" }}>
                    {ev.currency} · {ev.network}
                  </span>
                  <span className="mt-0.5 block font-mono text-[10px]" style={{ color: "var(--text-3)" }}>
                    {ev.chain}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ModalShell>
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

  const summaryExtra = summary ? (
    <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs">
      <div>
        <dt className="inline" style={{ color: "var(--text-3)" }}>All tx rows</dt>{" "}
        <dd className="inline font-mono" style={{ color: "var(--text-1)" }}>{summary.total_transactions}</dd>
      </div>
      <div>
        <dt className="inline" style={{ color: "var(--text-3)" }}>Successful</dt>{" "}
        <dd className="inline font-mono" style={{ color: "#34d399" }}>{summary.successful_deposits}</dd>
      </div>
      <div>
        <dt className="inline" style={{ color: "var(--text-3)" }}>Listed below</dt>{" "}
        <dd className="inline font-mono" style={{ color: "var(--text-1)" }}>{summary.rows_in_response}</dd>
      </div>
    </dl>
  ) : null;

  return (
    <ModalShell
      id="user-deposit-history-title"
      title="Deposit & transaction history"
      subtitle={userId}
      extra={summaryExtra}
      onClose={onClose}
    >
      {q.isLoading ? (
        <BrandLoader
          variant="inline"
          title=""
          subtitle="Loading…"
          className="px-2 py-4"
          aria-label="Loading deposit history"
        />
      ) : q.isError ? (
        <p className="px-2 py-6 text-sm" style={{ color: "#f87171" }}>{String(q.error)}</p>
      ) : events.length === 0 ? (
        <p className="px-2 py-6 text-sm" style={{ color: "var(--text-3)" }}>No payer transactions for this user.</p>
      ) : (
        <table className="w-full min-w-[720px] border-collapse text-left">
          <thead>
            <tr>
              {["Time", "Amount", "Status", "Wallet", "Tx"].map((h) => (
                <th key={h} className="border-b px-2 py-2 text-left text-[10px] font-semibold tracking-wide uppercase"
                    style={{ borderColor: "var(--border)", color: "var(--text-3)" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {events.map((ev) => (
              <tr key={ev.id}>
                <td className="border-b px-2 py-2 align-top text-xs whitespace-nowrap"
                    style={{ borderColor: "var(--border)", color: "var(--text-2)" }}>
                  {formatLocalDateTime(ev.at)}
                </td>
                <td className="border-b px-2 py-2 align-top text-xs"
                    style={{ borderColor: "var(--border)" }}>
                  <span style={{ color: "var(--text-1)" }}>{ev.amount_decimal}</span>{" "}
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
                <td className="border-b px-2 py-2 align-top max-w-[160px] break-all font-mono text-[10px]"
                    style={{ borderColor: "var(--border)", color: "var(--text-3)" }}
                    title={ev.wallet_address}>
                  {ev.wallet_address}
                </td>
                <td className="border-b px-2 py-2 align-top max-w-[120px] truncate font-mono text-[10px]"
                    style={{ borderColor: "var(--border)", color: "var(--text-3)" }}
                    title={ev.tx_hash}>
                  {ev.tx_hash}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ModalShell>
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
      className="min-w-[2.5rem] rounded-lg border px-2 py-1 text-center font-mono text-xs transition"
      style={
        disabled
          ? { borderColor: "var(--border)", color: "var(--text-3)", cursor: "default" }
          : {
              borderColor: "var(--link-active-border, rgba(90,111,255,0.4))",
              background: "var(--link-active-bg, rgba(90,111,255,0.1))",
              color: "var(--link-active-color, #818cf8)",
            }
      }
    >
      {count}
    </button>
  );
}
