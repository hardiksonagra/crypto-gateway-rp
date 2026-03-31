/**
 * Shared "Advanced filters" UI — fully theme-aware via CSS variables.
 */

export const listFilterInputClass = "form-input";
export const listFilterLabelClass = "form-label";
export const listFilterChipCloseClass =
  "ml-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition"
  + " hover:bg-[var(--chip-border)] hover:text-[var(--text-1)]"
  + " text-[var(--chip-label)]";
export const listFilterApplyButtonClass = "btn-primary flex-1 rounded-xl py-2.5 text-sm";
export const listFilterSecondaryButtonClass =
  "rounded-xl border px-4 py-2.5 text-sm transition"
  + " border-[var(--border-mid)] text-[var(--text-2)] hover:bg-[var(--bg-surface3)]";

/**
 * @param {{ onOpenDrawer: () => void; onReset: () => void; canReset: boolean }} props
 */
export function ListFilterToolbar({ onOpenDrawer, onReset, canReset }) {
  return (
    <div
      className="flex overflow-hidden rounded-xl"
      style={{
        border: "1px solid var(--border-mid)",
        background: "var(--bg-surface3)",
      }}
      role="group"
      aria-label="Filters"
    >
      <button
        type="button"
        onClick={onOpenDrawer}
        className="flex items-center gap-2 px-3 py-2.5 text-sm font-medium transition sm:px-4"
        style={{ color: "var(--text-2)" }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--link-hover-bg)"; e.currentTarget.style.color = "var(--text-1)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = ""; e.currentTarget.style.color = "var(--text-2)"; }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
        </svg>
        Filters
      </button>
      <span className="w-px shrink-0" style={{ background: "var(--border-mid)" }} aria-hidden />
      <button
        type="button"
        onClick={onReset}
        disabled={!canReset}
        title="Clear all filters"
        className="px-3 py-2.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-35 sm:px-4"
        style={{ color: "var(--text-3)" }}
        onMouseEnter={(e) => { if (canReset) { e.currentTarget.style.background = "var(--link-hover-bg)"; e.currentTarget.style.color = "var(--text-1)"; }}}
        onMouseLeave={(e) => { e.currentTarget.style.background = ""; e.currentTarget.style.color = "var(--text-3)"; }}
      >
        Reset
      </button>
    </div>
  );
}

/** @param {{ children: import("react").ReactNode }} props */
export function ListActiveFiltersChips({ children }) {
  return (
    <div
      className="mt-5 rounded-xl p-3.5"
      style={{ background: "var(--bg-surface3)", border: "1px solid var(--border)" }}
    >
      <p className="mb-2.5 text-[9px] font-bold uppercase tracking-[0.14em]"
         style={{ color: "var(--text-3)" }}>
        Active filters
      </p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

/**
 * @param {{ open: boolean; onClose: () => void; title?: string; children: import("react").ReactNode }} props
 */
export function ListFilterDrawer({ open, onClose, title = "Filters", children }) {
  return (
    <div
      className={`fixed inset-0 z-50 transition-[visibility] ${open ? "visible" : "invisible delay-200"}`}
      aria-hidden={!open}
    >
      {/* Backdrop */}
      <button
        type="button"
        className={`absolute inset-0 backdrop-blur-sm transition-opacity ${open ? "opacity-100" : "opacity-0"}`}
        style={{ background: "rgba(0,0,0,0.5)" }}
        onClick={onClose}
        aria-label="Close filters"
      />

      {/* Panel */}
      <aside
        className={`drawer-shell absolute right-0 top-0 flex h-full min-h-0 w-full max-w-sm flex-col border-l shadow-2xl transition-transform duration-200 ease-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div
          className="flex shrink-0 items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid var(--drawer-border)" }}
        >
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg"
                 style={{ background: "var(--link-active-bg)" }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--link-active-color)" }} aria-hidden>
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
              </svg>
            </div>
            <h2 className="text-sm font-bold" style={{ color: "var(--text-1)" }}>{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg transition"
            style={{ color: "var(--text-3)" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-surface3)"; e.currentTarget.style.color = "var(--text-1)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = ""; e.currentTarget.style.color = "var(--text-3)"; }}
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {children}
      </aside>
    </div>
  );
}
