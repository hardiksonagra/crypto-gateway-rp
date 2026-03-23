import { useEffect } from "react";

/**
 * In-app confirmation dialog (do not use window.alert / window.confirm for destructive flows).
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
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={() => !isLoading && onCancel()}
    >
      <div
        className="glass w-full max-w-md rounded-2xl border border-white/10 p-6 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-modal-title" className="text-lg font-semibold text-white">
          {title}
        </h2>
        {children ? <div className="mt-3 text-sm leading-relaxed text-white/65">{children}</div> : null}
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            disabled={isLoading}
            onClick={onCancel}
            className="rounded-xl border border-white/15 px-4 py-2.5 text-sm text-white/80 transition hover:bg-white/5 disabled:opacity-40"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={isLoading}
            onClick={onConfirm}
            className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50 ${
              danger
                ? "bg-rose-600/90 text-white hover:bg-rose-600"
                : "btn-primary"
            }`}
          >
            {isLoading ? "Please wait…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
