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
    <div
      className="grid grid-cols-1 gap-x-3 gap-y-1 border-b py-2.5 last:border-0 sm:grid-cols-[minmax(0,11rem)_1fr] sm:items-baseline"
      style={{ borderColor: "var(--border)" }}
    >
      <dt className="shrink-0 text-xs font-medium sm:pt-0.5" style={{ color: "var(--text-3)" }}>
        {label}
      </dt>
      <dd className="min-w-0 break-words font-mono text-xs [overflow-wrap:anywhere]" style={{ color: "var(--text-1)" }}>
        {v}
      </dd>
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
 * @property {string | null} [requested_amount_atomic]
 * @property {string | null} [requested_amount_decimal]
 * @property {string} [received_amount_atomic]
 * @property {string} [received_amount_decimal]
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
 * @param {boolean} [props.rescanTronDepositVisible]
 * @param {() => void} [props.onRescanTronDeposit]
 * @param {boolean} [props.rescanTronDepositLoading]
 * @param {string | null} [props.rescanTronDepositError]
 */
export default function TransactionDetailModal({
  open,
  transaction,
  onClose,
  onRedeliverCallback,
  redeliverLoading = false,
  redeliverError = null,
  rescanTronDepositVisible = false,
  onRescanTronDeposit,
  rescanTronDepositLoading = false,
  rescanTronDepositError = null,
}) {
  const blockClose = redeliverLoading || rescanTronDepositLoading;

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape" && !blockClose) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, blockClose, onClose]);

  if (!open || !transaction) return null;

  const t = transaction;
  const canRedeliver = t.status === "success";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto overscroll-contain p-4 pb-8 backdrop-blur-sm sm:items-center sm:py-8"
      style={{ background: "rgba(0,0,0,0.6)" }}
      role="presentation"
      onClick={() => !blockClose && onClose()}
    >
      <div
        className="modal-shell my-auto flex max-h-[min(90vh,56rem)] w-full min-h-0 max-w-2xl flex-col overflow-hidden rounded-2xl shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tx-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b px-5 py-4 sm:px-6" style={{ borderColor: "var(--border)" }}>
          <h2 id="tx-detail-title" className="text-lg font-semibold" style={{ color: "var(--text-1)" }}>
            Transaction details
          </h2>
          <p
            className="mt-1 font-mono text-xs [overflow-wrap:anywhere] break-words"
            style={{ color: "var(--link-active-color, #818cf8)" }}
          >
            {t.id}
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-3 sm:px-6">
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
              "Requested amount (checkout)",
              t.requested_amount_decimal != null
                ? `${t.requested_amount_decimal} ${t.token_symbol}`
                : null,
            )}
            {DetailRow(
              "Requested amount (raw)",
              t.requested_amount_atomic ?? null,
            )}
            {DetailRow(
              "Received amount (on-chain)",
              t.received_amount_decimal ??
                t.amount_decimal ??
                formatTokenAmount(t.amount, t.token_decimals),
            )}
            {DetailRow(
              "Received amount (raw)",
              t.received_amount_atomic ?? t.amount,
            )}
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
        <div className="shrink-0 space-y-3 border-t px-5 py-4 sm:px-6" style={{ borderColor: "var(--border)" }}>
          {rescanTronDepositVisible ? (
            <p className="text-xs leading-relaxed [overflow-wrap:anywhere]" style={{ color: "var(--text-3)" }}>
              <span style={{ color: "var(--text-2)" }}>Rescan TRON deposit</span> runs the same TronScan
              USDT·TRC20 ingest as the deposit worker for this wallet. If this row is still the checkout
              placeholder (<span className="font-mono">gateway-created:…</span>), the same internal
              transaction id is updated in place when a matching transfer is found (does not change
              callback settings).
            </p>
          ) : null}
          {rescanTronDepositError ? (
            <p
              className="rounded-lg border px-3 py-2 text-xs"
              style={{
                borderColor: "rgba(239,68,68,0.3)",
                background: "rgba(239,68,68,0.1)",
                color: "#f87171",
              }}
            >
              {rescanTronDepositError}
            </p>
          ) : null}
          <p className="text-xs leading-relaxed [overflow-wrap:anywhere]" style={{ color: "var(--text-3)" }}>
            <span style={{ color: "var(--text-2)" }}>Resend webhook</span> posts the same{" "}
            <span className="font-mono" style={{ color: "var(--text-2)" }}>payment</span> payload (
            <span className="font-mono" style={{ color: "var(--text-2)" }}>X-Webhook-Event: payment</span>,{" "}
            <span className="font-mono" style={{ color: "var(--text-2)" }}>status: success</span>) again. It does{" "}
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
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end sm:gap-3">
            <button
              type="button"
              disabled={blockClose}
              onClick={onClose}
              className="w-full rounded-xl border px-4 py-2.5 text-sm transition disabled:opacity-40 sm:w-auto"
              style={{ borderColor: "var(--border-mid)", color: "var(--text-2)" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-surface3)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = ""; }}
            >
              Close
            </button>
            {rescanTronDepositVisible && onRescanTronDeposit ? (
              <button
                type="button"
                disabled={rescanTronDepositLoading || redeliverLoading}
                onClick={onRescanTronDeposit}
                className="w-full rounded-xl border px-4 py-2.5 text-sm font-semibold transition disabled:opacity-40 sm:w-auto"
                style={{ borderColor: "var(--border-mid)", color: "var(--text-1)" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-surface3)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = ""; }}
              >
                {rescanTronDepositLoading ? "Scanning…" : "Rescan TRON deposit"}
              </button>
            ) : null}
            <button
              type="button"
              disabled={!canRedeliver || redeliverLoading}
              onClick={onRedeliverCallback}
              className="w-full rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-40 btn-primary sm:w-auto"
              title={
                canRedeliver
                  ? undefined
                  : "Only successful transactions can resend the payment webhook."
              }
            >
              {redeliverLoading ? "Sending…" : "Resend payment webhook"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
