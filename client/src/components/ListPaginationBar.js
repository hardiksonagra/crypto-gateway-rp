import { useEffect, useMemo } from "react";
import { getVisiblePages } from "../lib/pagination";

export const LIST_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
export const DEFAULT_LIST_PAGE_SIZE = 20;

export default function ListPaginationBar({ page, setPage, total, pageSize, setPageSize }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageItems = useMemo(() => getVisiblePages(page, totalPages), [page, totalPages]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages, setPage]);

  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <label className="flex items-center gap-2" style={{ color: "var(--text-3)" }}>
          <span className="whitespace-nowrap">Page size</span>
          <select
            value={pageSize}
            onChange={(e) => { const n = Number(e.target.value); setPageSize(n); setPage(1); }}
            className="rounded-lg px-2 py-1.5 text-sm outline-none"
            style={{
              border: "1px solid var(--border-mid)",
              background: "var(--bg-surface3)",
              color: "var(--text-1)",
            }}
          >
            {LIST_PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n} style={{ background: "var(--bg-surface2)" }}>{n}</option>
            ))}
          </select>
        </label>
        <span className="hidden sm:inline" style={{ color: "var(--text-3)" }} aria-hidden>·</span>
        <p style={{ color: "var(--text-2)" }}>
          Showing{" "}
          <span style={{ color: "var(--text-1)", fontWeight: 600 }}>{rangeStart}</span>–
          <span style={{ color: "var(--text-1)", fontWeight: 600 }}>{rangeEnd}</span>
          {" "}of{" "}
          <span style={{ color: "var(--text-1)", fontWeight: 600 }}>{total}</span>
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1 sm:justify-end">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          className="rounded-lg px-3 py-1.5 text-sm transition disabled:opacity-30"
          style={{ border: "1px solid var(--border-mid)", color: "var(--text-2)" }}
          onMouseEnter={(e) => { if (page > 1) e.currentTarget.style.background = "var(--bg-surface3)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = ""; }}
        >
          Prev
        </button>

        {pageItems.map((item, idx) =>
          item === "ellipsis" ? (
            <span key={`e-${idx}`} className="px-2 text-sm" style={{ color: "var(--text-3)" }}>…</span>
          ) : (
            <button
              key={item}
              type="button"
              onClick={() => setPage(item)}
              className="min-w-[2.25rem] rounded-lg px-2 py-1.5 text-sm transition"
              style={
                item === page
                  ? { background: "var(--link-active-bg)", color: "var(--link-active-color)", border: "1px solid var(--link-active-border)", fontWeight: 600 }
                  : { color: "var(--text-2)", border: "1px solid transparent" }
              }
              onMouseEnter={(e) => { if (item !== page) e.currentTarget.style.background = "var(--bg-surface3)"; }}
              onMouseLeave={(e) => { if (item !== page) e.currentTarget.style.background = ""; }}
            >
              {item}
            </button>
          )
        )}

        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          className="rounded-lg px-3 py-1.5 text-sm transition disabled:opacity-30"
          style={{ border: "1px solid var(--border-mid)", color: "var(--text-2)" }}
          onMouseEnter={(e) => { if (page < totalPages) e.currentTarget.style.background = "var(--bg-surface3)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = ""; }}
        >
          Next
        </button>
      </div>
    </div>
  );
}
