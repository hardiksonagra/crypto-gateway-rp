import { Formik, Form, Field, ErrorMessage } from "formik";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api";
import ListPaginationBar, { DEFAULT_LIST_PAGE_SIZE } from "../../components/ListPaginationBar";
import {
  ListActiveFiltersChips,
  ListFilterDrawer,
  ListFilterToolbar,
  listFilterApplyButtonClass,
  listFilterChipCloseClass,
  listFilterInputClass,
  listFilterLabelClass,
  listFilterSecondaryButtonClass,
} from "../../components/ListFilterChrome";
import { merchantUsersFilterSchema } from "../../admin/merchantSchemas";

const DEFAULT_PAGE_SIZE = DEFAULT_LIST_PAGE_SIZE;

export default function MerchantUsers() {
  const [page, setPage] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [applied, setApplied] = useState({
    q: "",
    pageSize: DEFAULT_PAGE_SIZE,
  });

  const res = useQuery({
    queryKey: ["m-users", page, applied.pageSize, applied.q],
    queryFn: () => {
      const p = new URLSearchParams({ page: String(page), pageSize: String(applied.pageSize) });
      if (applied.q.trim()) p.set("q", applied.q.trim());
      return api(`/api/v1/merchant/users?${p}`);
    },
  });

  const total = res.data?.total ?? 0;
  const users = res.data?.users ?? [];
  const showEmpty = !res.isLoading && users.length === 0;

  const hasActiveFilters = Boolean(applied.q.trim());
  const hasNonDefaultPageSize = applied.pageSize !== DEFAULT_PAGE_SIZE;
  const hasFilterChips = hasActiveFilters || hasNonDefaultPageSize;
  const canReset = page > 1 || hasFilterChips;

  function resetAll() {
    setApplied({ q: "", pageSize: DEFAULT_PAGE_SIZE });
    setPage(1);
    setDrawerOpen(false);
  }

  function patchApplied(partial) {
    setApplied((a) => ({ ...a, ...partial }));
    setPage(1);
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold text-white">Users</h1>
          <p className="mt-1 text-sm text-white/50">Customers created via your API key.</p>
        </div>
        <ListFilterToolbar
          onOpenDrawer={() => setDrawerOpen(true)}
          onReset={resetAll}
          canReset={canReset}
        />
      </div>

      {hasFilterChips ? (
        <ListActiveFiltersChips>
          {applied.q.trim() ? (
            <span className="inline-flex max-w-full items-center gap-1 rounded-xl border border-cyan-400/25 bg-cyan-500/[0.12] px-2.5 py-1.5 pl-3 text-xs text-cyan-50">
              <span className="text-[10px] font-semibold tracking-wide text-cyan-300/80 uppercase">Search</span>
              <span className="max-w-[min(280px,50vw)] truncate font-mono text-cyan-100/95" title={applied.q}>
                {applied.q}
              </span>
              <button
                type="button"
                className={listFilterChipCloseClass}
                onClick={() => patchApplied({ q: "" })}
                aria-label="Remove search filter"
              >
                ×
              </button>
            </span>
          ) : null}
          {hasNonDefaultPageSize ? (
            <span className="inline-flex items-center gap-1 rounded-xl border border-violet-400/25 bg-violet-500/[0.12] px-2.5 py-1.5 pl-3 text-xs text-violet-50">
              <span className="text-[10px] font-semibold tracking-wide text-violet-300/80 uppercase">Page size</span>
              <span className="font-mono">{applied.pageSize}</span>
              <button
                type="button"
                className={listFilterChipCloseClass}
                onClick={() => patchApplied({ pageSize: DEFAULT_PAGE_SIZE })}
                aria-label="Reset page size"
              >
                ×
              </button>
            </span>
          ) : null}
        </ListActiveFiltersChips>
      ) : null}

      <ListFilterDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        {drawerOpen ? (
          <Formik
            enableReinitialize
            initialValues={{ q: applied.q }}
            validationSchema={merchantUsersFilterSchema}
            validateOnBlur
            validateOnChange={false}
            onSubmit={(vals, { setSubmitting }) => {
              setApplied((a) => ({ ...a, q: vals.q }));
              setPage(1);
              setDrawerOpen(false);
              setSubmitting(false);
            }}
          >
            {({ resetForm }) => (
              <Form className="flex min-h-0 flex-1 flex-col">
                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                  <div className="space-y-5">
                    <div>
                      <label className={listFilterLabelClass} htmlFor="m-users-q">
                        Search (external id or internal id)
                      </label>
                      <Field
                        id="m-users-q"
                        name="q"
                        className={listFilterInputClass}
                        placeholder="Type to filter…"
                      />
                      <ErrorMessage name="q" component="p" className="mt-1 text-xs text-rose-400" />
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 gap-3 border-t border-white/10 px-5 py-4">
                  <button type="submit" className={listFilterApplyButtonClass}>
                    Apply
                  </button>
                  <button
                    type="button"
                    onClick={() => resetForm({ values: { q: "" } })}
                    className={listFilterSecondaryButtonClass}
                  >
                    Reset
                  </button>
                </div>
              </Form>
            )}
          </Formik>
        ) : (
          <div className="min-h-0 flex-1" />
        )}
      </ListFilterDrawer>

      <div className="mt-10 space-y-4">
        <div className="glass overflow-hidden rounded-2xl">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-white/10 bg-white/5 text-xs text-white/50 uppercase">
              <tr>
                <th className="px-4 py-3">External id</th>
                <th className="px-4 py-3">Wallets</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {res.isLoading ? (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-sm text-white/45">
                    Loading…
                  </td>
                </tr>
              ) : null}
              {showEmpty ? (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-sm text-white/50">
                    No record found.
                  </td>
                </tr>
              ) : null}
              {!res.isLoading &&
                users.map((u) => (
                  <tr key={u.id} className="text-white/85">
                    <td className="px-4 py-3 font-mono text-xs">{u.external_user_id}</td>
                    <td className="px-4 py-3">{u.wallets_count}</td>
                    <td className="px-4 py-3 text-xs text-white/50">{u.created_at.slice(0, 10)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <ListPaginationBar
          page={page}
          setPage={setPage}
          total={total}
          pageSize={applied.pageSize}
          setPageSize={(n) => setApplied((a) => ({ ...a, pageSize: n }))}
        />
      </div>
    </div>
  );
}
