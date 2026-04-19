/**
 * Consistent status badge using .badge-* CSS classes from index.css.
 * @param {{ status: string; className?: string }} props
 */
export function StatusBadge({ status, className = "" }) {
  const key = (status ?? "").toLowerCase();
  const cls =
    key === "success" || key === "completed" ? "badge-success" :
    key === "pending" ? "badge-pending" :
    key === "underpaid" ? "badge-failed" :
    key === "failed" ? "badge-failed" :
    key === "processing" ? "badge-processing" :
    key === "active" ? "badge-active" :
    key === "inactive" ? "badge-inactive" :
    key === "deleted" ? "badge-deleted" :
    "badge-inactive";
  return (
    <span className={`badge ${cls} ${className}`}>
      <span className="badge-dot" />
      {status}
    </span>
  );
}
