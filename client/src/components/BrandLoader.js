import { SITE_NAME } from "./BrandMark.js";

/**
 * Favicon + sky/violet orbit; shared across portal. CSS: `brand-loader-*` in `index.css`.
 *
 * @param {{
 *   title?: string,
 *   subtitle?: string,
 *   variant?: "page" | "section" | "inline",
 *   className?: string,
 *   "aria-label"?: string,
 * }} props
 */
export function BrandLoader({
  title = "Loading",
  subtitle,
  variant = "section",
  className = "",
  "aria-label": ariaLabel,
}) {
  const label = ariaLabel ?? `Loading ${SITE_NAME}`;
  const inline = variant === "inline";

  const wrap =
    variant === "page"
      ? `flex min-h-[min(70vh,32rem)] w-full flex-1 flex-col items-center justify-center gap-5 self-stretch py-12 text-center ${className}`.trim()
      : inline
        ? `flex min-h-[10rem] w-full max-w-full flex-col items-center justify-center gap-2 self-center py-6 text-center box-border ${className}`.trim()
        : `flex min-h-[11rem] w-full max-w-full flex-col items-center justify-center gap-4 self-center py-8 text-center box-border ${className}`.trim();

  const box = inline ? "h-14 w-14" : "h-[4.75rem] w-[4.75rem]";
  const glowInset = inline ? "-inset-2" : "-inset-3";
  const innerInset = inline ? "inset-[4px]" : "inset-[5px]";
  const orbitInset = inline ? "inset-[-2px]" : "inset-[-3px]";
  const imgClass = inline
    ? "h-8 w-8"
    : "h-10 w-10";
  const imgPx = inline ? 32 : 40;

  return (
    <div
      className={`brand-loader-root ${wrap}`}
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={label}
    >
      <div
        className={`relative flex shrink-0 items-center justify-center ${box}`}
      >
        <div
          className={`brand-loader-glow pointer-events-none absolute ${glowInset} rounded-[1.35rem] bg-[radial-gradient(ellipse_at_center,rgba(56,189,248,0.22)_0%,rgba(139,92,246,0.12)_45%,transparent_70%)] blur-md`}
          aria-hidden
        />
        <div
          className="absolute inset-0 rounded-2xl border border-white/[0.07]"
          aria-hidden
        />
        <div
          className={`brand-loader-orbit absolute ${orbitInset} rounded-[1.1rem] border-2 border-transparent border-t-sky-400/90 border-r-violet-500/55 opacity-95 shadow-[0_0_18px_rgba(56,189,248,0.25)]`}
          aria-hidden
        />
        <div
          className={`absolute ${innerInset} rounded-[0.85rem] bg-[var(--bg-surface)]/95 ring-1 ring-white/[0.06]`}
          aria-hidden
        />
        <img
          src="/favicon.png"
          alt=""
          width={imgPx}
          height={imgPx}
          decoding="async"
          draggable={false}
          className={`relative z-10 select-none object-contain drop-shadow-[0_0_14px_rgba(56,189,248,0.4)] ${imgClass}`}
        />
      </div>
      {(title || subtitle) && (
        <div className="flex max-w-sm flex-col items-center gap-1.5 px-4 text-center">
          {title ? (
            <p
              className={`font-display font-semibold uppercase tracking-[0.28em] text-white/40 ${inline ? "text-[10px]" : "text-[11px] tracking-[0.32em]"}`}
            >
              {title}
            </p>
          ) : null}
          {subtitle ? (
            <p
              className={`text-white/30 ${inline ? "text-[11px] leading-snug" : "text-xs"}`}
            >
              {subtitle}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
