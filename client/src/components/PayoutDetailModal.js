import { useEffect } from "react";
import { formatLocalDateTime } from "../lib/formatLocalDateTime.js";

/** @param {unknown} v */
function isPositiveAmount(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0;
}

/** @param {string} label @param {string | number | null | undefined} value */
function DetailRow(label, value) {
  const v =
    value === null || value === undefined || value === ""
      ? "—"
      : String(value);
  return (
    <div
      className="grid grid-cols-1 gap-x-3 gap-y-1 border-b border-white/[0.08] py-2.5 last:border-0 sm:grid-cols-[minmax(0,11rem)_1fr] sm:items-baseline"
    >
      <dt className="shrink-0 text-xs font-medium text-white/45 sm:pt-0.5">{label}</dt>
      <dd className="min-w-0 break-words font-mono text-xs text-white/90 [overflow-wrap:anywhere]">{v}</dd>
    </div>
  );
}

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {Record<string, unknown> | null} props.payout
 * @param {string | null | undefined} props.merchantEmail
 * @param {() => void} props.onClose
 */
export default function PayoutDetailModal({ open, payout, merchantEmail, onClose }) {
  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !payout || typeof payout !== "object") return null;

  const p = payout;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto overscroll-contain p-4 pb-8 backdrop-blur-sm sm:items-center sm:py-8"
      style={{ background: "rgba(0,0,0,0.6)" }}
      role="presentation"
      onClick={() => onClose()}
    >
      <div
        className="modal-shell my-auto flex max-h-[min(90vh,56rem)] w-full min-h-0 max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0e1222] shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="payout-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-white/10 px-5 py-4 sm:px-6">
          <h2 id="payout-detail-title" className="text-lg font-semibold text-white">
            Payout details
          </h2>
          <p className="mt-1 font-mono text-xs text-sky-300/90 [overflow-wrap:anywhere]">
            {String(p.id ?? "")}
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-3 sm:px-6">
          <dl>
            {merchantEmail ? DetailRow("Merchant", merchantEmail) : null}
            {DetailRow("Client reference", p.client_reference_id)}
            {DetailRow("Status", p.status)}
            {DetailRow("Chain", p.chain)}
            {DetailRow("Token", p.token_symbol)}
            {DetailRow("To address", p.to_address)}
            {DetailRow("Gross", p.gross_amount_decimal != null ? String(p.gross_amount_decimal) : null)}
            {DetailRow("Gross (raw)", p.gross_amount_atomic)}
            {DetailRow(
              "Amount sent (recipient)",
              p.net_amount_decimal != null ? String(p.net_amount_decimal) : null,
            )}
            {DetailRow("Amount sent (raw)", p.net_amount_atomic)}
            {DetailRow(
              "Payout MDR (RP reference, not deducted)",
              p.mdr_amount_decimal != null ? String(p.mdr_amount_decimal) : null,
            )}
            {isPositiveAmount(p.settlement_fee_amount_decimal) || isPositiveAmount(p.settlement_fee_amount_atomic)
              ? DetailRow(
                  "Settlement fee (legacy)",
                  p.settlement_fee_amount_decimal != null ? String(p.settlement_fee_amount_decimal) : null,
                )
              : null}
            {DetailRow("MDR %", p.mdr_percent != null ? String(p.mdr_percent) : null)}
            {isPositiveAmount(p.settlement_rate_percent)
              ? DetailRow("Settlement % (legacy)", String(p.settlement_rate_percent))
              : null}
            {DetailRow(
              "Network fee (native)",
              p.network_fee_native_decimal != null && p.network_fee_native_symbol
                ? `${String(p.network_fee_native_decimal)} ${String(p.network_fee_native_symbol)}`
                : null,
            )}
            {DetailRow("Network fee (raw atomic)", p.network_fee_native_atomic)}
            {DetailRow("Tx hash", p.tx_hash)}
            {DetailRow("Failure reason", p.failure_reason)}
            {DetailRow(
              "Callback delivered at",
              p.callback_delivered_at ? formatLocalDateTime(String(p.callback_delivered_at)) : null,
            )}
            {DetailRow("Gateway environment", p.environment)}
            {DetailRow("Created at", p.created_at ? formatLocalDateTime(String(p.created_at)) : null)}
            {DetailRow("Updated at", p.updated_at ? formatLocalDateTime(String(p.updated_at)) : null)}
          </dl>
        </div>
        <div className="shrink-0 border-t border-white/10 px-5 py-4 sm:px-6">
          <p className="mb-3 text-xs text-white/45">
            Payouts are not sent to your webhook URL. Poll{" "}
            <span className="font-mono text-white/65">GET /api/v1/gateway/payout</span> with the same{" "}
            <span className="font-mono text-white/65">client_reference_id</span> you used when creating the payout.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl border border-white/15 px-4 py-2.5 text-sm text-white/80 transition hover:bg-white/[0.06] sm:w-auto"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
