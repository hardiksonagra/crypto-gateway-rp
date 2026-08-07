import { formatTokenAmount } from "../lib/formatTokenAmount.js";

/**
 * Pending payout buckets from `/settlements/payout-preview` APIs.
 *
 * @param {{
 *   b: Record<string, unknown> & {
 *     chain: string;
 *     token_symbol: string;
 *     token_decimals: number;
 *     payout_row_count: number;
 *     gross_amount_atomic: string;
 *     net_amount_atomic: string;
 *     mdr_amount_atomic: string;
 *   };
 * }} props
 */
export function PayoutPreviewBucketCard({ b }) {
  const dec = b.token_decimals ?? 6;
  return (
    <article className="surface-adaptive-card w-full overflow-hidden rounded-2xl border border-white/[0.09] bg-gradient-to-br from-[#141a2e]/95 via-[#0e1222]/98 to-[#090c18] p-4 shadow-lg ring-1 ring-inset ring-white/[0.04] sm:p-5">
      <header className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] pb-3">
        <span className="rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/[0.12] px-2.5 py-0.5 font-mono text-[11px] font-bold uppercase tracking-wider text-fuchsia-100/95">
          Payout
        </span>
        <span className="rounded-lg border border-cyan-500/30 bg-cyan-500/[0.12] px-2.5 py-0.5 font-mono text-[11px] font-bold text-cyan-100/95">
          {b.chain}
        </span>
        <span className="rounded-lg border border-violet-500/30 bg-violet-500/[0.12] px-2.5 py-0.5 font-mono text-[11px] font-semibold text-violet-100/95">
          {b.token_symbol}
        </span>
        <span className="text-[10px] text-white/45">{b.payout_row_count ?? 0} pending/processing</span>
      </header>
      <div className="mt-4 grid grid-cols-1 gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-white/38">Gross (requested)</p>
          <p className="mt-0.5 font-mono text-white/90">{formatTokenAmount(b.gross_amount_atomic, dec)}</p>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-white/38">
            RP reference fee (not deducted)
          </p>
          <p className="mt-0.5 font-mono text-amber-200/85">{formatTokenAmount(b.mdr_amount_atomic, dec)}</p>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-white/38">Sent / recipient (full gross)</p>
          <p className="mt-0.5 font-mono text-emerald-200/90">{formatTokenAmount(b.net_amount_atomic, dec)}</p>
        </div>
      </div>
    </article>
  );
}
