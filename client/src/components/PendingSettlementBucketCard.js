import { Formik, Form } from "formik";
import { useRef } from "react";
import { apiForm } from "../api";
import { formatTokenAmount } from "../lib/formatTokenAmount.js";

const labelCls = "mb-1 block text-xs font-medium text-white/60";

/**
 * @param {{ transaction_count: number; meets_min: boolean }} b
 * @param {'admin' | 'merchant'} variant
 */
function statusLabelFor(b, variant) {
  if (!b.transaction_count) return "No volume";
  const eligible = b.transaction_count > 0 && b.meets_min;
  if (variant === "admin" || variant === "rp") {
    return eligible ? "Ready to settle" : "Below threshold";
  }
  return eligible ? "Above minimum" : "Below minimum";
}

/**
 * @param {{
 *   variant: 'admin' | 'merchant' | 'rp';
 *   b: Record<string, unknown> & {
 *     chain: string;
 *     token_symbol: string;
 *     token_decimals: number;
 *     transaction_count: number;
 *     meets_min: boolean;
 *     gross_raw: string;
 *     mdr_percent: number;
 *     mdr_amount_raw: string;
 *     after_mdr_raw: string;
 *     settlement_rate_percent: number;
 *     settlement_fee_raw: string;
 *     net_to_merchant_raw: string;
 *     min_settlement_amount?: string;
 *     min_settlement_atomic?: string;
 *   };
 *   merchantEmail?: string;
 *   merchantDisplayName?: string | null;
 *   identityLabel?: string;
 *   merchantId?: string;
 *   onSettled?: () => void;
 * }} props
 */
export function PendingSettlementBucketCard({
  variant,
  b,
  merchantEmail,
  merchantDisplayName,
  identityLabel,
  merchantId,
  onSettled,
}) {
  const eligible = b.transaction_count > 0 && b.meets_min;
  const statusLabel = statusLabelFor(b, variant);
  const whoLabel = identityLabel ?? (variant === "merchant" ? "Account" : "Merchant");
  const netHeading = variant === "merchant" ? "Est. net" : "Net";

  const minHuman = String(b.min_settlement_amount ?? "0").trim();
  const showMin = minHuman !== "" && minHuman !== "0";

  const netColSpan = showMin ? "xl:col-span-2" : "xl:col-span-5";

  const feeMdrOnly = variant === "rp";

  const showAdminSettle =
    (variant === "admin" || variant === "rp") &&
    Boolean(merchantId) &&
    typeof onSettled === "function";

  return (
    <article className="surface-adaptive-card group relative w-full overflow-hidden rounded-2xl border border-white/[0.09] bg-gradient-to-br from-[#141a2e]/95 via-[#0e1222]/98 to-[#090c18] shadow-[0_24px_48px_-12px_rgba(0,0,0,0.55)] ring-1 ring-inset ring-white/[0.04] transition-[box-shadow,transform] duration-300 hover:shadow-[0_28px_56px_-12px_rgba(60,80,200,0.12)]">
      <div
        className="pointer-events-none absolute inset-y-3 left-0 w-1 rounded-full bg-gradient-to-b from-cyan-400 via-indigo-500 to-fuchsia-500 opacity-95 shadow-[0_0_12px_rgba(99,102,241,0.45)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -right-16 top-0 h-40 w-40 rounded-full bg-indigo-500/[0.12] blur-3xl transition-opacity duration-500 group-hover:opacity-100"
        aria-hidden
      />
      <div className="pointer-events-none absolute bottom-0 right-0 h-24 w-48 bg-gradient-to-tl from-violet-600/[0.08] to-transparent blur-2xl" aria-hidden />

      <div className="relative pl-5 pr-4 pb-4 pt-3 sm:pl-6">
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-white/[0.06] pb-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-lg border border-cyan-500/30 bg-cyan-500/[0.12] px-2.5 py-0.5 font-mono text-[11px] font-bold uppercase tracking-wider text-cyan-100/95">
                {b.chain}
              </span>
              <span className="rounded-lg border border-violet-500/30 bg-violet-500/[0.12] px-2.5 py-0.5 font-mono text-[11px] font-semibold text-violet-100/95">
                {b.token_symbol}
              </span>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-medium tabular-nums text-white/45">
                {b.token_decimals} decimals
              </span>
            </div>
            {merchantEmail ? (
              <p
                className="basis-full truncate text-xs sm:basis-auto sm:max-w-[min(100%,28rem)]"
                title={merchantEmail}
              >
                <span className="text-white/38">{whoLabel}</span>{" "}
                <span className="font-mono text-white/80">{merchantEmail}</span>
                {merchantDisplayName?.trim() ? (
                  <span className="text-white/42"> · {merchantDisplayName.trim()}</span>
                ) : null}
              </p>
            ) : null}
          </div>
          <div
            className={`shrink-0 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${
              eligible
                ? "bg-emerald-500/15 text-emerald-100/95 ring-1 ring-emerald-400/35"
                : b.transaction_count > 0
                  ? "bg-amber-500/12 text-amber-100/90 ring-1 ring-amber-400/30"
                  : "bg-white/[0.06] text-white/45 ring-1 ring-white/10"
            }`}
          >
            {statusLabel}
          </div>
        </header>

        <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-12 xl:items-stretch xl:gap-x-4 xl:gap-y-3">
          <div className="flex gap-2 xl:col-span-2">
            <div className="min-w-0 flex-1 rounded-lg border border-white/[0.06] bg-white/[0.03] px-2.5 py-2">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-white/38">Txns</p>
              <p className="mt-0.5 font-mono text-base font-semibold tabular-nums text-white/90">
                {b.transaction_count}
              </p>
            </div>
            <div className="min-w-0 flex-1 rounded-lg border border-white/[0.06] bg-white/[0.03] px-2.5 py-2">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-white/38">Gross</p>
              <p className="mt-0.5 truncate font-mono text-sm font-semibold tabular-nums text-white/88">
                {formatTokenAmount(b.gross_raw, b.token_decimals)}
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-amber-500/15 border-l-[3px] border-l-amber-400/50 bg-gradient-to-r from-amber-500/[0.06] to-transparent px-3 py-2 xl:col-span-5 xl:py-2.5">
            <p className="text-[9px] font-bold uppercase tracking-widest text-amber-200/55 xl:mb-1.5">
              {feeMdrOnly ? "Fees (partner merchants)" : "Fee pipeline"}
            </p>
            {feeMdrOnly ? (
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="min-w-0">
                  <p className="truncate text-white/40">MDR ({Number(b.mdr_percent).toFixed(2)}%)</p>
                  <p className="font-mono tabular-nums text-amber-200/85">
                    −{formatTokenAmount(b.mdr_amount_raw, b.token_decimals)}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-white/40">After MDR (net)</p>
                  <p className="font-mono tabular-nums text-white/75">
                    {formatTokenAmount(b.net_to_merchant_raw, b.token_decimals)}
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2 text-[11px]">
                <div className="min-w-0">
                  <p className="truncate text-white/40">MDR ({Number(b.mdr_percent).toFixed(2)}%)</p>
                  <p className="font-mono tabular-nums text-amber-200/85">
                    −{formatTokenAmount(b.mdr_amount_raw, b.token_decimals)}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-white/40">After MDR</p>
                  <p className="font-mono tabular-nums text-white/75">
                    {formatTokenAmount(b.after_mdr_raw, b.token_decimals)}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="truncate text-white/40">Settle ({Number(b.settlement_rate_percent).toFixed(2)}%)</p>
                  <p className="font-mono tabular-nums text-amber-200/85">
                    −{formatTokenAmount(b.settlement_fee_raw, b.token_decimals)}
                  </p>
                </div>
              </div>
            )}
            {feeMdrOnly ? (
              <p className="mt-2 text-[10px] leading-snug text-white/38">
                Platform settlement fee is not applied to merchants under a reseller partner; net matches MDR
                deduction only.
              </p>
            ) : null}
          </div>

          <div
            className={`rounded-xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/[0.1] via-emerald-600/[0.04] to-transparent px-3 py-2 ring-1 ring-inset ring-emerald-400/10 ${netColSpan}`}
          >
            <p className="text-[9px] font-bold uppercase tracking-widest text-emerald-200/55">{netHeading}</p>
            <p className="font-mono text-lg font-semibold tracking-tight text-emerald-100/95 tabular-nums xl:text-xl">
              {formatTokenAmount(b.net_to_merchant_raw, b.token_decimals)}
            </p>
            <p className="font-mono text-[9px] text-white/35">raw {String(b.net_to_merchant_raw)}</p>
          </div>

          {showMin ? (
            <div className="rounded-xl border border-white/[0.08] bg-slate-950/40 px-3 py-2 xl:col-span-3">
              <p className="text-[9px] font-bold uppercase tracking-widest text-white/40">Min (merchant)</p>
              <p className="font-mono text-sm font-semibold text-white/85">{minHuman}</p>
              <p className="line-clamp-2 text-[9px] leading-snug text-white/42">
                → {String(b.min_settlement_atomic ?? "0")} smallest ·{" "}
                {formatTokenAmount(b.min_settlement_atomic ?? "0", b.token_decimals)} display
              </p>
            </div>
          ) : null}
        </div>

        {!b.meets_min && b.transaction_count > 0 ? (
          <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.08] px-3 py-2 text-[11px] leading-snug text-amber-100/90 xl:mt-2">
            <span className="shrink-0 text-amber-300" aria-hidden>
              ◆
            </span>
            <p>
              Net (raw) must be <span className="font-semibold text-white/90">strictly greater</span> than
              the converted minimum in smallest units. Merchant min is in token units.
            </p>
          </div>
        ) : null}

        {showAdminSettle && eligible ? (
          <div className="surface-adaptive-admin-strip mt-2 rounded-xl border border-indigo-400/25 bg-gradient-to-r from-indigo-500/[0.1] via-indigo-600/[0.04] to-black/20 px-3 py-2.5 ring-1 ring-inset ring-indigo-400/10 xl:flex xl:items-end xl:gap-4">
            <p className="mb-2 shrink-0 text-[9px] font-bold uppercase tracking-[0.15em] text-indigo-200/55 xl:mb-0 xl:pt-1">
              Record payout
            </p>
            <div className="min-w-0 flex-1">
              <BatchSettleForm
                merchantId={merchantId}
                bucket={b}
                onSettled={onSettled}
                embedded
                submitUrl={
                  variant === "rp" ? "/api/v1/rp/settlements/batch" : "/api/v1/admin/settlements/batch"
                }
              />
            </div>
          </div>
        ) : null}
      </div>
    </article>
  );
}

/**
 * @param {{
 *   merchantId: string;
 *   bucket: Record<string, unknown> & { chain: string; token_symbol: string; token_decimals: number; transaction_count: number; meets_min: boolean };
 *   onSettled: () => void;
 *   embedded?: boolean;
 *   submitUrl?: string;
 * }} props
 */
function BatchSettleForm({
  merchantId,
  bucket,
  onSettled,
  embedded,
  submitUrl = "/api/v1/admin/settlements/batch",
}) {
  const fileRef = useRef(null);
  const bucketKey = `${bucket.chain}-${bucket.token_symbol}-${bucket.token_decimals}`;
  const canSettle = bucket.transaction_count > 0 && bucket.meets_min;
  if (!canSettle) {
    return null;
  }

  return (
    <Formik
      initialValues={{}}
      onSubmit={async (_, { setStatus, setSubmitting }) => {
        setStatus(undefined);
        const f = fileRef.current?.files?.[0];
        if (!f) {
          setStatus("Proof file is required (JPEG, PNG, WebP, GIF, or PDF, max 8MB).");
          setSubmitting(false);
          return;
        }
        try {
          const fd = new FormData();
          fd.append("merchant_id", merchantId);
          fd.append("chain", bucket.chain);
          fd.append("token_symbol", bucket.token_symbol);
          fd.append("token_decimals", String(bucket.token_decimals));
          fd.append("proof", f);
          await apiForm(submitUrl, fd);
          if (fileRef.current) fileRef.current.value = "";
          onSettled();
        } catch (e) {
          setStatus(String(e));
        } finally {
          setSubmitting(false);
        }
      }}
    >
      {({ isSubmitting, status }) => (
        <Form
          className={`flex flex-wrap items-end gap-3 ${embedded ? "" : "mt-3 border-t border-white/10 pt-3"}`}
        >
          <div className="min-w-[200px] flex-1">
            <label className={labelCls} htmlFor={`proof-${bucketKey}`}>
              Proof <span className="text-rose-200/90">(required)</span> — JPEG, PNG, WebP, GIF, or PDF, max
              8MB
            </label>
            <input
              ref={fileRef}
              id={`proof-${bucketKey}`}
              name="proof"
              type="file"
              required
              accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
              disabled={isSubmitting}
              className="block w-full text-sm text-white/70 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-sm file:text-white"
            />
          </div>
          <button
            type="submit"
            disabled={isSubmitting}
            className="btn-primary rounded-lg px-4 py-2 text-sm"
          >
            {isSubmitting ? "Settling…" : "Settle batch"}
          </button>
          {status ? <p className="w-full text-xs text-rose-400">{status}</p> : null}
        </Form>
      )}
    </Formik>
  );
}
