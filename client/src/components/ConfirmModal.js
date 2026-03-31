import { useEffect } from "react";

/**
 * In-app confirmation dialog — fully theme-aware.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {string} props.title
 * @param {import("react").ReactNode} [props.children]
 * @param {string} [props.confirmLabel]
 * @param {string} [props.cancelLabel]
 * @param {() => void} props.onConfirm
 * @param {() => void} props.onCancel
 * @param {boolean} [props.danger]
 * @param {boolean} [props.isLoading]
 */
export default function ConfirmModal({
  open,
  title,
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  danger = false,
  isLoading = false,
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape" && !isLoading) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, isLoading, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 backdrop-blur-sm"
      style={{ background: "rgba(0,0,0,0.6)" }}
      role="presentation"
      onClick={() => !isLoading && onCancel()}
    >
      <div
        className="modal-shell w-full max-w-md rounded-2xl border p-6 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Icon */}
        <div className="mb-4 flex items-center gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
            style={{
              background: danger ? "rgba(239,68,68,0.12)" : "var(--link-active-bg)",
            }}
          >
            {danger ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#f87171" }} aria-hidden>
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--link-active-color)" }} aria-hidden>
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
            )}
          </div>
          <h2 id="confirm-modal-title" className="text-base font-bold" style={{ color: "var(--text-1)" }}>
            {title}
          </h2>
        </div>

        {children ? (
          <div className="mb-5 rounded-xl px-4 py-3 text-sm leading-relaxed"
               style={{ background: "var(--bg-surface3)", color: "var(--text-2)", border: "1px solid var(--border)" }}>
            {children}
          </div>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2.5">
          <button
            type="button"
            disabled={isLoading}
            onClick={onCancel}
            className="rounded-xl border px-4 py-2.5 text-sm font-medium transition disabled:opacity-40"
            style={{ borderColor: "var(--border-mid)", color: "var(--text-2)" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-surface3)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = ""; }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={isLoading}
            onClick={onConfirm}
            className="rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50"
            style={
              danger
                ? { background: "rgba(239,68,68,0.9)", color: "#ffffff" }
                : { background: "var(--btn-primary-bg)", color: "var(--btn-primary-color)" }
            }
            onMouseEnter={(e) => {
              if (!isLoading) e.currentTarget.style.opacity = "0.88";
            }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
          >
            {isLoading ? "Please wait…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
