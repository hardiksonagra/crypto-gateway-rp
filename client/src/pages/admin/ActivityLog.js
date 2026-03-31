import { Formik, Form, Field, ErrorMessage } from "formik";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api";
import ListPaginationBar, { DEFAULT_LIST_PAGE_SIZE } from "../../components/ListPaginationBar";
import { BrandLoader } from "../../components/BrandLoader.js";
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
import {
  adminAuditLogsFilterSchema,
  adminPanelAuditLogsFilterSchema,
} from "../../admin/merchantSchemas";
import { formatLocalDateTime } from "../../lib/formatLocalDateTime.js";

const DEFAULT_PAGE_SIZE = DEFAULT_LIST_PAGE_SIZE;

function formatMeta(meta) {
  try {
    return JSON.stringify(meta ?? {}, null, 2);
  } catch {
    return String(meta);
  }
}

const tabBtn =
  "rounded-t-lg border border-b-0 px-4 py-2.5 text-sm font-medium transition hover:border-white/10 hover:bg-white/[0.04]";

const initialGatewayApplied = {
  merchant_id: "",
  source: "",
  action: "",
  created_from: "",
  created_to: "",
  pageSize: DEFAULT_PAGE_SIZE,
};

const initialPortalApplied = {
  panel: "",
  merchant_id: "",
  actor_id: "",
  path: "",
  created_from: "",
  created_to: "",
  pageSize: DEFAULT_PAGE_SIZE,
};

export default function AdminActivityLog() {
  const [tab, setTab] = useState("gateway");
  const [gwPage, setGwPage] = useState(1);
  const [gwDrawerOpen, setGwDrawerOpen] = useState(false);
  const [gwApplied, setGwApplied] = useState(initialGatewayApplied);
  const [plPage, setPlPage] = useState(1);
  const [plDrawerOpen, setPlDrawerOpen] = useState(false);
  const [plApplied, setPlApplied] = useState(initialPortalApplied);

  const gwRes = useQuery({
    queryKey: [
      "admin-audit-logs",
      gwPage,
      gwApplied.pageSize,
      gwApplied.merchant_id,
      gwApplied.source,
      gwApplied.action,
      gwApplied.created_from,
      gwApplied.created_to,
    ],
    enabled: tab === "gateway",
    queryFn: () => {
      const p = new URLSearchParams({
        page: String(gwPage),
        pageSize: String(gwApplied.pageSize),
      });
      if (gwApplied.merchant_id.trim()) p.set("merchant_id", gwApplied.merchant_id.trim());
      if (gwApplied.source.trim()) p.set("source", gwApplied.source.trim());
      if (gwApplied.action.trim()) p.set("action", gwApplied.action.trim());
      if (gwApplied.created_from) p.set("created_from", gwApplied.created_from);
      if (gwApplied.created_to) p.set("created_to", gwApplied.created_to);
      return api(`/api/v1/admin/audit-logs?${p}`);
    },
  });

  const plRes = useQuery({
    queryKey: [
      "admin-panel-audit-logs",
      plPage,
      plApplied.pageSize,
      plApplied.panel,
      plApplied.merchant_id,
      plApplied.actor_id,
      plApplied.path,
      plApplied.created_from,
      plApplied.created_to,
    ],
    enabled: tab === "portal",
    queryFn: () => {
      const p = new URLSearchParams({
        page: String(plPage),
        pageSize: String(plApplied.pageSize),
      });
      if (plApplied.panel) p.set("panel", plApplied.panel);
      if (plApplied.merchant_id.trim()) p.set("merchant_id", plApplied.merchant_id.trim());
      if (plApplied.actor_id.trim()) p.set("actor_id", plApplied.actor_id.trim());
      if (plApplied.path.trim()) p.set("path", plApplied.path.trim());
      if (plApplied.created_from) p.set("created_from", plApplied.created_from);
      if (plApplied.created_to) p.set("created_to", plApplied.created_to);
      return api(`/api/v1/admin/panel-audit-logs?${p}`);
    },
  });

  const gwTotal = gwRes.data?.total ?? 0;
  const gwLogs = gwRes.data?.logs ?? [];
  const gwShowEmpty = tab === "gateway" && !gwRes.isLoading && gwLogs.length === 0;

  const plTotal = plRes.data?.total ?? 0;
  const plLogs = plRes.data?.logs ?? [];
  const plShowEmpty = tab === "portal" && !plRes.isLoading && plLogs.length === 0;

  const gwHasFilters = Boolean(
    gwApplied.merchant_id.trim() ||
      gwApplied.source.trim() ||
      gwApplied.action.trim() ||
      gwApplied.created_from ||
      gwApplied.created_to,
  );
  const gwHasChips = gwHasFilters || gwApplied.pageSize !== DEFAULT_PAGE_SIZE;
  const gwCanReset = gwPage > 1 || gwHasChips;

  const plHasFilters = Boolean(
    plApplied.panel ||
      plApplied.merchant_id.trim() ||
      plApplied.actor_id.trim() ||
      plApplied.path.trim() ||
      plApplied.created_from ||
      plApplied.created_to,
  );
  const plHasChips = plHasFilters || plApplied.pageSize !== DEFAULT_PAGE_SIZE;
  const plCanReset = plPage > 1 || plHasChips;

  function resetGateway() {
    setGwApplied(initialGatewayApplied);
    setGwPage(1);
    setGwDrawerOpen(false);
  }

  function patchGateway(partial) {
    setGwApplied((a) => ({ ...a, ...partial }));
    setGwPage(1);
  }

  function resetPortal() {
    setPlApplied(initialPortalApplied);
    setPlPage(1);
    setPlDrawerOpen(false);
  }

  function patchPortal(partial) {
    setPlApplied((a) => ({ ...a, ...partial }));
    setPlPage(1);
  }

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-bold" style={{ color: "var(--text-1)" }}>Activity log</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-2)" }}>Gateway events, webhooks, and portal admin/merchant actions.</p>
        </div>
        <ListFilterToolbar
          onOpenDrawer={() => (tab === "gateway" ? setGwDrawerOpen(true) : setPlDrawerOpen(true))}
          onReset={tab === "gateway" ? resetGateway : resetPortal}
          canReset={tab === "gateway" ? gwCanReset : plCanReset}
        />
      </div>

      <div className="mt-6 flex flex-wrap gap-0" role="tablist" aria-label="Activity log source">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "gateway"}
          className={tabBtn}
          style={tab === "gateway"
            ? { color: "var(--tab-active-color)", borderBottomColor: "var(--link-active-border)" }
            : { color: "var(--tab-inactive-color)", borderBottomColor: "transparent" }}
          onClick={() => setTab("gateway")}
        >
          Gateway &amp; webhooks
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "portal"}
          className={tabBtn}
          style={tab === "portal"
            ? { color: "var(--tab-active-color)", borderBottomColor: "var(--link-active-border)" }
            : { color: "var(--tab-inactive-color)", borderBottomColor: "transparent" }}
          onClick={() => setTab("portal")}
        >
          Portals (admin / merchant)
        </button>
      </div>

      {tab === "gateway" && gwHasChips ? (
        <ListActiveFiltersChips>
          {gwApplied.merchant_id.trim() ? (
            <span className="filter-chip max-w-full">
              <span className="filter-chip-label">Merchant</span>
              <span className="max-w-[min(220px,45vw)] truncate font-mono" title={gwApplied.merchant_id}>
                {gwApplied.merchant_id}
              </span>
              <button
                type="button"
                className={listFilterChipCloseClass}
                onClick={() => patchGateway({ merchant_id: "" })}
                aria-label="Remove merchant filter"
              >
                ×
              </button>
            </span>
          ) : null}
          {gwApplied.source.trim() ? (
            <span className="filter-chip max-w-full">
              <span className="filter-chip-label">Source</span>
              <span className="max-w-[min(180px,40vw)] truncate font-mono" title={gwApplied.source}>
                {gwApplied.source}
              </span>
              <button
                type="button"
                className={listFilterChipCloseClass}
                onClick={() => patchGateway({ source: "" })}
                aria-label="Remove source filter"
              >
                ×
              </button>
            </span>
          ) : null}
          {gwApplied.action.trim() ? (
            <span className="filter-chip max-w-full">
              <span className="filter-chip-label">Action</span>
              <span className="max-w-[min(220px,45vw)] truncate font-mono" title={gwApplied.action}>
                {gwApplied.action}
              </span>
              <button
                type="button"
                className={listFilterChipCloseClass}
                onClick={() => patchGateway({ action: "" })}
                aria-label="Remove action filter"
              >
                ×
              </button>
            </span>
          ) : null}
          {gwApplied.created_from ? (
            <span className="inline-flex items-center gap-1 rounded-xl border border-white/20 bg-white/[0.08] px-2.5 py-1.5 pl-3 text-xs text-white/85">
              <span className="text-[10px] font-semibold tracking-wide text-white/50 uppercase">From</span>
              <span className="font-mono">{gwApplied.created_from}</span>
              <button
                type="button"
                className={listFilterChipCloseClass}
                onClick={() => patchGateway({ created_from: "" })}
                aria-label="Remove from date"
              >
                ×
              </button>
            </span>
          ) : null}
          {gwApplied.created_to ? (
            <span className="inline-flex items-center gap-1 rounded-xl border border-white/20 bg-white/[0.08] px-2.5 py-1.5 pl-3 text-xs text-white/85">
              <span className="text-[10px] font-semibold tracking-wide text-white/50 uppercase">To</span>
              <span className="font-mono">{gwApplied.created_to}</span>
              <button
                type="button"
                className={listFilterChipCloseClass}
                onClick={() => patchGateway({ created_to: "" })}
                aria-label="Remove to date"
              >
                ×
              </button>
            </span>
          ) : null}
          {gwApplied.pageSize !== DEFAULT_PAGE_SIZE ? (
            <span className="filter-chip">
              <span className="filter-chip-label">Page size</span>
              <span className="font-mono text-white/65">{gwApplied.pageSize}</span>
              <button
                type="button"
                className={listFilterChipCloseClass}
                onClick={() => patchGateway({ pageSize: DEFAULT_PAGE_SIZE })}
                aria-label="Reset page size"
              >
                ×
              </button>
            </span>
          ) : null}
        </ListActiveFiltersChips>
      ) : null}

      {tab === "portal" && plHasChips ? (
        <ListActiveFiltersChips>
          {plApplied.panel ? (
            <span className="filter-chip">
              <span className="filter-chip-label">Panel</span>
              <span className="font-mono text-white/65">{plApplied.panel}</span>
              <button
                type="button"
                className={listFilterChipCloseClass}
                onClick={() => patchPortal({ panel: "" })}
                aria-label="Remove panel filter"
              >
                ×
              </button>
            </span>
          ) : null}
          {plApplied.merchant_id.trim() ? (
            <span className="filter-chip max-w-full">
              <span className="filter-chip-label">Target merchant id</span>
              <span className="max-w-[min(220px,45vw)] truncate font-mono" title={plApplied.merchant_id}>
                {plApplied.merchant_id}
              </span>
              <button
                type="button"
                className={listFilterChipCloseClass}
                onClick={() => patchPortal({ merchant_id: "" })}
                aria-label="Remove merchant filter"
              >
                ×
              </button>
            </span>
          ) : null}
          {plApplied.actor_id.trim() ? (
            <span className="filter-chip max-w-full">
              <span className="filter-chip-label">Actor id</span>
              <span className="max-w-[min(220px,45vw)] truncate font-mono" title={plApplied.actor_id}>
                {plApplied.actor_id}
              </span>
              <button
                type="button"
                className={listFilterChipCloseClass}
                onClick={() => patchPortal({ actor_id: "" })}
                aria-label="Remove actor filter"
              >
                ×
              </button>
            </span>
          ) : null}
          {plApplied.path.trim() ? (
            <span className="filter-chip max-w-full">
              <span className="filter-chip-label">Path contains</span>
              <span className="max-w-[min(200px,40vw)] truncate font-mono" title={plApplied.path}>
                {plApplied.path}
              </span>
              <button
                type="button"
                className={listFilterChipCloseClass}
                onClick={() => patchPortal({ path: "" })}
                aria-label="Remove path filter"
              >
                ×
              </button>
            </span>
          ) : null}
          {plApplied.created_from ? (
            <span className="inline-flex items-center gap-1 rounded-xl border border-white/20 bg-white/[0.08] px-2.5 py-1.5 pl-3 text-xs text-white/85">
              <span className="text-[10px] font-semibold tracking-wide text-white/50 uppercase">From</span>
              <span className="font-mono">{plApplied.created_from}</span>
              <button
                type="button"
                className={listFilterChipCloseClass}
                onClick={() => patchPortal({ created_from: "" })}
                aria-label="Remove from date"
              >
                ×
              </button>
            </span>
          ) : null}
          {plApplied.created_to ? (
            <span className="inline-flex items-center gap-1 rounded-xl border border-white/20 bg-white/[0.08] px-2.5 py-1.5 pl-3 text-xs text-white/85">
              <span className="text-[10px] font-semibold tracking-wide text-white/50 uppercase">To</span>
              <span className="font-mono">{plApplied.created_to}</span>
              <button
                type="button"
                className={listFilterChipCloseClass}
                onClick={() => patchPortal({ created_to: "" })}
                aria-label="Remove to date"
              >
                ×
              </button>
            </span>
          ) : null}
          {plApplied.pageSize !== DEFAULT_PAGE_SIZE ? (
            <span className="filter-chip">
              <span className="filter-chip-label">Page size</span>
              <span className="font-mono text-white/65">{plApplied.pageSize}</span>
              <button
                type="button"
                className={listFilterChipCloseClass}
                onClick={() => patchPortal({ pageSize: DEFAULT_PAGE_SIZE })}
                aria-label="Reset page size"
              >
                ×
              </button>
            </span>
          ) : null}
        </ListActiveFiltersChips>
      ) : null}

      <ListFilterDrawer open={gwDrawerOpen} onClose={() => setGwDrawerOpen(false)}>
        {gwDrawerOpen ? (
          <Formik
            enableReinitialize
            initialValues={{
              merchant_id: gwApplied.merchant_id,
              source: gwApplied.source,
              action: gwApplied.action,
              created_from: gwApplied.created_from,
              created_to: gwApplied.created_to,
            }}
            validationSchema={adminAuditLogsFilterSchema}
            validateOnBlur
            validateOnChange={false}
            onSubmit={(vals, { setSubmitting }) => {
              setGwApplied((a) => ({
                ...a,
                merchant_id: vals.merchant_id,
                source: vals.source,
                action: vals.action,
                created_from: vals.created_from,
                created_to: vals.created_to,
              }));
              setGwPage(1);
              setGwDrawerOpen(false);
              setSubmitting(false);
            }}
          >
            {({ resetForm }) => (
              <Form className="flex min-h-0 flex-1 flex-col">
                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                  <div className="space-y-5">
                    <div>
                      <label className={listFilterLabelClass} htmlFor="adm-audit-merchant">
                        Merchant id
                      </label>
                      <Field
                        id="adm-audit-merchant"
                        name="merchant_id"
                        className={listFilterInputClass}
                        placeholder="Filter by merchant id"
                      />
                      <ErrorMessage name="merchant_id" component="p" className="mt-1 text-xs text-rose-400" />
                    </div>
                    <div>
                      <label className={listFilterLabelClass} htmlFor="adm-audit-source">
                        Source (e.g. gateway_api, callback)
                      </label>
                      <Field
                        id="adm-audit-source"
                        name="source"
                        className={listFilterInputClass}
                        placeholder="Exact match"
                      />
                      <ErrorMessage name="source" component="p" className="mt-1 text-xs text-rose-400" />
                    </div>
                    <div>
                      <label className={listFilterLabelClass} htmlFor="adm-audit-action">
                        Action contains
                      </label>
                      <Field
                        id="adm-audit-action"
                        name="action"
                        className={listFilterInputClass}
                        placeholder="e.g. deposit_address, callback.payment"
                      />
                      <ErrorMessage name="action" component="p" className="mt-1 text-xs text-rose-400" />
                    </div>
                    <div>
                      <label className={listFilterLabelClass} htmlFor="adm-audit-from">
                        From date
                      </label>
                      <Field id="adm-audit-from" name="created_from" type="date" className={listFilterInputClass} />
                      <ErrorMessage name="created_from" component="p" className="mt-1 text-xs text-rose-400" />
                    </div>
                    <div>
                      <label className={listFilterLabelClass} htmlFor="adm-audit-to">
                        To date
                      </label>
                      <Field id="adm-audit-to" name="created_to" type="date" className={listFilterInputClass} />
                      <ErrorMessage name="created_to" component="p" className="mt-1 text-xs text-rose-400" />
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 gap-3 border-t border-white/10 px-5 py-4">
                  <button type="submit" className={listFilterApplyButtonClass}>
                    Apply
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      resetForm({
                        values: {
                          merchant_id: "",
                          source: "",
                          action: "",
                          created_from: "",
                          created_to: "",
                        },
                      })
                    }
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

      <ListFilterDrawer open={plDrawerOpen} onClose={() => setPlDrawerOpen(false)}>
        {plDrawerOpen ? (
          <Formik
            enableReinitialize
            initialValues={{
              panel: plApplied.panel,
              merchant_id: plApplied.merchant_id,
              actor_id: plApplied.actor_id,
              path: plApplied.path,
              created_from: plApplied.created_from,
              created_to: plApplied.created_to,
            }}
            validationSchema={adminPanelAuditLogsFilterSchema}
            validateOnBlur
            validateOnChange={false}
            onSubmit={(vals, { setSubmitting }) => {
              setPlApplied((a) => ({
                ...a,
                panel: vals.panel,
                merchant_id: vals.merchant_id,
                actor_id: vals.actor_id,
                path: vals.path,
                created_from: vals.created_from,
                created_to: vals.created_to,
              }));
              setPlPage(1);
              setPlDrawerOpen(false);
              setSubmitting(false);
            }}
          >
            {({ resetForm }) => (
              <Form className="flex min-h-0 flex-1 flex-col">
                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                  <div className="space-y-5">
                    <div>
                      <label className={listFilterLabelClass} htmlFor="adm-pl-panel">
                        Panel
                      </label>
                      <Field
                        id="adm-pl-panel"
                        name="panel"
                        as="select"
                        className={listFilterInputClass}
                      >
                        <option value="">Any</option>
                        <option value="admin">Admin</option>
                        <option value="merchant">Merchant</option>
                      </Field>
                      <ErrorMessage name="panel" component="p" className="mt-1 text-xs text-rose-400" />
                    </div>
                    <div>
                      <label className={listFilterLabelClass} htmlFor="adm-pl-merchant">
                        Target merchant id
                      </label>
                      <Field
                        id="adm-pl-merchant"
                        name="merchant_id"
                        className={listFilterInputClass}
                        placeholder="Merchant row id (admin edits or merchant self)"
                      />
                      <ErrorMessage name="merchant_id" component="p" className="mt-1 text-xs text-rose-400" />
                    </div>
                    <div>
                      <label className={listFilterLabelClass} htmlFor="adm-pl-actor">
                        Actor user id
                      </label>
                      <Field
                        id="adm-pl-actor"
                        name="actor_id"
                        className={listFilterInputClass}
                        placeholder="Who performed the action"
                      />
                      <ErrorMessage name="actor_id" component="p" className="mt-1 text-xs text-rose-400" />
                    </div>
                    <div>
                      <label className={listFilterLabelClass} htmlFor="adm-pl-path">
                        Path contains
                      </label>
                      <Field
                        id="adm-pl-path"
                        name="path"
                        className={listFilterInputClass}
                        placeholder="e.g. /merchants/ or /withdrawals"
                      />
                      <ErrorMessage name="path" component="p" className="mt-1 text-xs text-rose-400" />
                    </div>
                    <div>
                      <label className={listFilterLabelClass} htmlFor="adm-pl-from">
                        From date
                      </label>
                      <Field id="adm-pl-from" name="created_from" type="date" className={listFilterInputClass} />
                      <ErrorMessage name="created_from" component="p" className="mt-1 text-xs text-rose-400" />
                    </div>
                    <div>
                      <label className={listFilterLabelClass} htmlFor="adm-pl-to">
                        To date
                      </label>
                      <Field id="adm-pl-to" name="created_to" type="date" className={listFilterInputClass} />
                      <ErrorMessage name="created_to" component="p" className="mt-1 text-xs text-rose-400" />
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 gap-3 border-t border-white/10 px-5 py-4">
                  <button type="submit" className={listFilterApplyButtonClass}>
                    Apply
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      resetForm({
                        values: {
                          panel: "",
                          merchant_id: "",
                          actor_id: "",
                          path: "",
                          created_from: "",
                          created_to: "",
                        },
                      })
                    }
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

      {tab === "gateway" ? (
        <div className="mt-10 w-full space-y-4">
          <div className="data-table-surface w-full">
            <table className="data-table min-w-[960px] w-full">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Source</th>
                  <th>Action</th>
                  <th>Merchant</th>
                  <th>Actor</th>
                  <th>Summary</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {gwRes.isLoading ? (
                  <tr>
                    <td colSpan={7} className="!py-8">
                      <BrandLoader variant="inline" title="" subtitle="Loading…" />
                    </td>
                  </tr>
                ) : null}
                {gwShowEmpty ? (
                  <tr>
                    <td colSpan={7} className="!py-12 text-center text-sm text-white/45">
                      No records found.
                    </td>
                  </tr>
                ) : null}
                {!gwRes.isLoading &&
                  gwLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="whitespace-nowrap text-[11px] text-white/55">
                        {formatLocalDateTime(log.created_at, { fallback: "" })}
                      </td>
                      <td className="font-mono text-xs text-violet-200/90">{log.source}</td>
                      <td className="max-w-[200px] truncate font-mono text-xs text-white/70" title={log.action}>
                        {log.action}
                      </td>
                      <td className="max-w-[180px]">
                        {log.merchant_email ? (
                          <span className="block truncate text-xs text-white/65" title={log.merchant_email}>
                            {log.merchant_email}
                          </span>
                        ) : log.merchant_id ? (
                          <span
                            className="block truncate font-mono text-[11px] text-white/45"
                            title={log.merchant_id}
                          >
                            {log.merchant_id.slice(0, 12)}…
                          </span>
                        ) : (
                          <span className="text-xs text-white/35">—</span>
                        )}
                      </td>
                      <td className="max-w-[160px] text-xs text-white/55">
                        <span className="block truncate" title={log.actor_email || log.actor_id || ""}>
                          {log.actor_type}
                          {log.actor_email ? ` · ${log.actor_email}` : ""}
                          {log.actor_id && !log.actor_email ? ` · ${log.actor_id.slice(0, 8)}…` : ""}
                        </span>
                      </td>
                      <td className="max-w-[min(28rem,40vw)] text-xs text-white/60">
                        <span className="line-clamp-2" title={log.summary}>
                          {log.summary}
                        </span>
                      </td>
                      <td className="align-top">
                        <details className="text-xs">
                          <summary className="cursor-pointer text-violet-300/95 hover:text-violet-200">JSON</summary>
                          <pre className="mt-2 max-h-72 max-w-[min(32rem,85vw)] overflow-auto rounded-lg border border-white/10 bg-black/40 p-2 font-mono text-[10px] leading-relaxed text-white/70">
                            {formatMeta(log.metadata)}
                          </pre>
                        </details>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          <ListPaginationBar
            page={gwPage}
            setPage={setGwPage}
            total={gwTotal}
            pageSize={gwApplied.pageSize}
            setPageSize={(n) => setGwApplied((a) => ({ ...a, pageSize: n }))}
          />
        </div>
      ) : (
        <div className="mt-10 w-full space-y-4">
          <div className="data-table-surface w-full">
            <table className="data-table min-w-[960px] w-full">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Panel</th>
                  <th>Method</th>
                  <th>Path</th>
                  <th>Target merchant</th>
                  <th>Actor</th>
                  <th>Summary</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {plRes.isLoading ? (
                  <tr>
                    <td colSpan={8} className="!py-8">
                      <BrandLoader variant="inline" title="" subtitle="Loading…" />
                    </td>
                  </tr>
                ) : null}
                {plShowEmpty ? (
                  <tr>
                    <td colSpan={8} className="!py-12 text-center text-sm text-white/45">
                      No records found.
                    </td>
                  </tr>
                ) : null}
                {!plRes.isLoading &&
                  plLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="whitespace-nowrap text-[11px] text-white/55">
                        {formatLocalDateTime(log.created_at, { fallback: "" })}
                      </td>
                      <td className="font-mono text-xs text-amber-200/90">{log.panel}</td>
                      <td className="font-mono text-xs text-white/70">{log.method}</td>
                      <td className="max-w-[min(14rem,30vw)] truncate font-mono text-[11px] text-white/60" title={log.path}>
                        {log.path}
                      </td>
                      <td className="max-w-[160px] text-xs text-white/55">
                        {log.target_merchant_email ? (
                          <span className="block truncate" title={log.target_merchant_email}>
                            {log.target_merchant_email}
                          </span>
                        ) : log.target_merchant_id ? (
                          <span
                            className="block truncate font-mono text-[10px] text-white/45"
                            title={log.target_merchant_id}
                          >
                            {log.target_merchant_id.slice(0, 10)}…
                          </span>
                        ) : (
                          <span className="text-white/35">—</span>
                        )}
                      </td>
                      <td className="max-w-[160px] text-xs text-white/55">
                        <span className="block truncate" title={log.actor_email || log.actor_id || ""}>
                          {log.actor_role}
                          {log.actor_email ? ` · ${log.actor_email}` : ""}
                        </span>
                      </td>
                      <td className="max-w-[min(20rem,35vw)] text-xs text-white/60">
                        <span className="line-clamp-2" title={log.summary}>
                          {log.summary}
                        </span>
                      </td>
                      <td className="align-top">
                        <details className="text-xs">
                          <summary className="cursor-pointer text-violet-300/95 hover:text-violet-200">JSON</summary>
                          <pre className="mt-2 max-h-72 max-w-[min(32rem,85vw)] overflow-auto rounded-lg border border-white/10 bg-black/40 p-2 font-mono text-[10px] leading-relaxed text-white/70">
                            {formatMeta(log.metadata)}
                          </pre>
                        </details>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          <ListPaginationBar
            page={plPage}
            setPage={setPlPage}
            total={plTotal}
            pageSize={plApplied.pageSize}
            setPageSize={(n) => setPlApplied((a) => ({ ...a, pageSize: n }))}
          />
        </div>
      )}
    </div>
  );
}
