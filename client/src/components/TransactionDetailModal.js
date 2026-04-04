import { useEffect } from "react";
import { formatTokenAmount } from "../lib/formatTokenAmount.js";
import { formatLocalDateTime } from "../lib/formatLocalDateTime.js";

/** @param {string} label @param {string | number | null | undefined} value */
function DetailRow(label, value) {
  const v =
    value === null || value === undefined || value === ""
      ? "—"
      : String(value);
  return (
    <div className="grid grid-cols-[minmax(0,140px)_1fr] gap-x-3 gap-y-1 border-b py-2.5 last:border-0"
         style={{ borderColor: "var(--border)" }}>
      <dt className="text-xs font-medium" style={{ color: "var(--text-3)" }}>{label}</dt>
      <dd className="break-all font-mono text-xs" style={{ color: "var(--text-1)" }}>{v}</dd>
    </div>
  );
}

/**
 * @typedef {object} MerchantTransactionRow
 * @property {string} id
 * @property {string} tx_hash
 * @property {string} chain
 * @property {string} status
 * @property {string} token_symbol
 * @property {number} token_decimals
 * @property {string} amount
 * @property {string} [amount_decimal]
 * @property {number} confirmations
 * @property {string} from_address
 * @property {string} to_address
 * @property {string} wallet_id
 * @property {string} wallet_address
 * @property {string} currency
 * @property {string} network
 * @property {string | null} block_number
 * @property {number} log_index
 * @property {string | null} callback_delivered_at
 * @property {string} external_user_id
 * @property {string} gateway_environment
 * @property {string} created_at
 * @property {string} updated_at
 * @property {string} [merchant_id]
 * @property {string} [merchant_email]
 * @property {string | null} [transaction_id]
 */

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {MerchantTransactionRow | null} props.transaction
 * @param {() => void} props.onClose
 * @param {() => void} props.onRedeliverCallback
 * @param {boolean} [props.redeliverLoading]
 * @param {string | null} [props.redeliverError]
 */
export default function TransactionDetailModal({
  open,
  transaction,
  onClose,
  onRedeliverCallback,
  redeliverLoading = false,
  redeliverError = null,
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape" && !redeliverLoading) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, redeliverLoading, onClose]);

  if (!open || !transaction) return null;

  const t = transaction;
  const canRedeliver = t.status === "success";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 backdrop-blur-sm"
      style={{ background: "rgba(0,0,0,0.6)" }}
      role="presentation"
      onClick={() => !redeliverLoading && onClose()}
    >
      <div
        className="modal-shell max-h-[min(90vh,720px)] w-full max-w-lg overflow-hidden rounded-2xl shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tx-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b px-6 py-4" style={{ borderColor: "var(--border)" }}>
          <h2 id="tx-detail-title" className="text-lg font-semibold" style={{ color: "var(--text-1)" }}>
            Transaction details
          </h2>
          <p className="mt-1 break-all font-mono text-xs" style={{ color: "var(--link-active-color, #818cf8)" }}>
            {t.id}
          </p>
        </div>
        <div className="max-h-[min(52vh,420px)] overflow-y-auto px-6 py-2">
          <dl>
            {DetailRow("Reference / order ID", t.transaction_id)}
            {DetailRow("Tx hash", t.tx_hash)}
            {DetailRow("Status", t.status)}
            {DetailRow("Chain", t.chain)}
            {DetailRow("Currency", t.currency)}
            {DetailRow("Network", t.network)}
            {DetailRow("Token", t.token_symbol)}
            {DetailRow("Token decimals", t.token_decimals)}
            {DetailRow(
              "Amount (display)",
              t.amount_decimal ?? formatTokenAmount(t.amount, t.token_decimals),
            )}
            {DetailRow("Amount (raw / smallest units)", t.amount)}
            {DetailRow("Confirmations", t.confirmations)}
            {DetailRow("From address", t.from_address)}
            {DetailRow("To address", t.to_address)}
            {DetailRow("Wallet ID", t.wallet_id)}
            {DetailRow("Wallet address", t.wallet_address)}
            {DetailRow("External user ID", t.external_user_id)}
            {t.merchant_id ? DetailRow("Merchant ID", t.merchant_id) : null}
            {t.merchant_email ? DetailRow("Merchant email", t.merchant_email) : null}
            {DetailRow("Gateway environment", t.gateway_environment)}
            {DetailRow("Block number", t.block_number)}
            {DetailRow("Log index", t.log_index)}
            {DetailRow(
              "Callback delivered at",
              t.callback_delivered_at ? formatLocalDateTime(t.callback_delivered_at) : null,
            )}
            {DetailRow("Created at", formatLocalDateTime(t.created_at))}
            {DetailRow("Updated at", formatLocalDateTime(t.updated_at))}
          </dl>
        </div>
        <div className="space-y-3 border-t px-6 py-4" style={{ borderColor: "var(--border)" }}>
          <p className="text-xs leading-relaxed" style={{ color: "var(--text-3)" }}>
            <span style={{ color: "var(--text-2)" }}>Resend webhook</span> posts the same{" "}
            <span className="font-mono" style={{ color: "var(--text-2)" }}>payment.success</span> JSON again. It does{" "}
            <strong style={{ color: "var(--text-1)" }}>not</strong> create another transaction in this
            system. Your server should treat the same{" "}
            <span className="font-mono" style={{ color: "var(--text-2)" }}>transaction_id</span> idempotently.
          </p>
          {redeliverError ? (
            <p className="rounded-lg border px-3 py-2 text-xs"
               style={{ borderColor: "rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.1)", color: "#f87171" }}>
              {redeliverError}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-3">
            <button
              type="button"
              disabled={redeliverLoading}
              onClick={onClose}
              className="rounded-xl border px-4 py-2.5 text-sm transition disabled:opacity-40"
              style={{ borderColor: "var(--border-mid)", color: "var(--text-2)" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-surface3)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = ""; }}
            >
              Close
            </button>
            <button
              type="button"
              disabled={!canRedeliver || redeliverLoading}
              onClick={onRedeliverCallback}
              className="rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-40 btn-primary"
              title={
                canRedeliver
                  ? undefined
                  : "Only successful transactions can trigger the payment.success webhook."
              }
            >
              {redeliverLoading ? "Sending…" : "Resend payment.success webhook"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
