import { useEffect, useMemo } from "react";
import { getVisiblePages } from "../lib/pagination";

export const LIST_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
export const DEFAULT_LIST_PAGE_SIZE = 20;

/**
 * Page size selector, range text, and numbered page controls for list APIs.
 *
 * @param {object} props
 * @param {number} props.page
 * @param {(n: number) => void} props.setPage
 * @param {number} props.total
 * @param {number} props.pageSize
 * @param {(n: number) => void} props.setPageSize
 */
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
        <label className="flex items-center gap-2 text-white/55">
          <span className="whitespace-nowrap">Page size</span>
          <select
            value={pageSize}
            onChange={(e) => {
              const n = Number(e.target.value);
              setPageSize(n);
              setPage(1);
            }}
            className="rounded-lg border border-white/15 bg-black/40 px-2 py-1.5 text-sm text-white outline-none ring-white/20 focus:ring-1"
          >
            {LIST_PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <span className="hidden text-white/30 sm:inline" aria-hidden>
          ·
        </span>
        <p className="text-white/45">
          Showing <span className="text-white/80">{rangeStart}</span>–
          <span className="text-white/80">{rangeEnd}</span> of <span className="text-white/80">{total}</span>
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1 sm:justify-end">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-white/70 hover:bg-white/5 disabled:opacity-30"
        >
          Prev
        </button>
        {pageItems.map((item, idx) =>
          item === "ellipsis" ? (
            <span key={`e-${idx}`} className="px-2 text-white/35">
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              onClick={() => setPage(item)}
              className={`min-w-[2.25rem] rounded-lg px-2 py-1.5 text-sm ${
                item === page
                  ? "bg-white/12 font-semibold text-white ring-1 ring-white/25"
                  : "text-white/65 hover:bg-white/5"
              }`}
            >
              {item}
            </button>
          ),
        )}
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-white/70 hover:bg-white/5 disabled:opacity-30"
        >
          Next
        </button>
      </div>
    </div>
  );
}
