/**
 * Shared “Advanced filters” UI: toolbar, active-filter chips panel, right drawer shell.
 */

export const listFilterInputClass =
  "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-cyan-500/30 focus:ring-1";
export const listFilterLabelClass = "mb-1.5 block text-xs font-medium text-white/55";
export const listFilterChipCloseClass =
  "ml-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white/60 transition hover:bg-white/15 hover:text-white";
export const listFilterApplyButtonClass =
  "flex-1 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-500 py-2.5 text-sm font-semibold text-slate-950";
export const listFilterSecondaryButtonClass =
  "rounded-xl border border-white/15 px-4 py-2.5 text-sm text-white/75 hover:bg-white/5";

/**
 * @param {object} props
 * @param {() => void} props.onOpenDrawer
 * @param {() => void} props.onReset
 * @param {boolean} props.canReset
 */
export function ListFilterToolbar({ onOpenDrawer, onReset, canReset }) {
  return (
    <div
      className="flex overflow-hidden rounded-xl border border-white/20 bg-white/[0.04] shadow-inner"
      role="group"
      aria-label="Filters"
    >
      <button
        type="button"
        onClick={onOpenDrawer}
        className="px-3 py-2.5 text-sm font-medium text-cyan-200 transition hover:bg-cyan-500/15 sm:px-4"
      >
        Advanced filters
      </button>
      <span className="w-px shrink-0 bg-white/20" aria-hidden />
      <button
        type="button"
        onClick={onReset}
        disabled={!canReset}
        title="Clear filters and page"
        className="px-3 py-2.5 text-sm text-white/75 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35 sm:px-4"
      >
        Reset
      </button>
    </div>
  );
}

/** @param {{ children: import("react").ReactNode }} props */
export function ListActiveFiltersChips({ children }) {
  return (
    <div className="mt-5 rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-950/40 via-[#0f111a]/80 to-cyan-950/30 p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]">
      <div className="mb-2 flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-gradient-to-r from-cyan-400 to-violet-400 shadow-[0_0_8px_rgba(34,211,238,0.5)]" />
        <span className="text-[11px] font-semibold tracking-widest text-violet-200/80 uppercase">Active filters</span>
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {string} [props.title]
 * @param {import("react").ReactNode} props.children
 */
export function ListFilterDrawer({ open, onClose, title = "Filters", children }) {
  return (
    <div
      className={`fixed inset-0 z-50 transition-[visibility] ${open ? "visible" : "invisible delay-200"}`}
      aria-hidden={!open}
    >
      <button
        type="button"
        className={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity ${open ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
        aria-label="Close filters"
      />
      <aside
        className={`absolute right-0 top-0 flex h-full min-h-0 w-full max-w-md flex-col border-l border-white/10 bg-[#0c0e18] shadow-2xl transition-transform duration-200 ease-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-5 py-4">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-white/50 hover:bg-white/5 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        {children}
      </aside>
    </div>
  );
}
