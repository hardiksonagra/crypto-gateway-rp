import { Formik, Form, Field, ErrorMessage } from "formik";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
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
import {
  CHAIN_VALUES,
  merchantDetailTransactionsFilterSchema,
  merchantDetailUsersFilterSchema,
  merchantDetailWalletsFilterSchema,
} from "../../admin/merchantSchemas";
import { formatTokenAmount } from "../../lib/formatTokenAmount.js";

const DEFAULT_PAGE_SIZE = DEFAULT_LIST_PAGE_SIZE;
const TX_STATUS_OPTIONS = ["pending", "success", "failed"];

const MERCHANT_DETAIL_TABS = [
  { id: "details", label: "Details" },
  { id: "transactions", label: "Transactions" },
  { id: "wallets", label: "Wallets" },
  { id: "users", label: "Users" },
];

export default function MerchantDetail() {
  const { id: merchantId } = useParams();
  const [tab, setTab] = useState("details");

  const merchantQ = useQuery({
    queryKey: ["admin-merchant", merchantId],
    enabled: Boolean(merchantId),
    queryFn: () => api(`/api/v1/admin/merchants/${merchantId}`),
  });

  const [txPage, setTxPage] = useState(1);
  const [txDrawer, setTxDrawer] = useState(false);
  const [txApplied, setTxApplied] = useState({
    chain: "",
    status: "",
    token_symbol: "",
    address: "",
    pageSize: DEFAULT_PAGE_SIZE,
  });

  const [walPage, setWalPage] = useState(1);
  const [walDrawer, setWalDrawer] = useState(false);
  const [walApplied, setWalApplied] = useState({
    chain: "",
    address: "",
    currency: "",
    network: "",
    q: "",
    created_from: "",
    created_to: "",
    pageSize: DEFAULT_PAGE_SIZE,
  });

  const [userPage, setUserPage] = useState(1);
  const [userDrawer, setUserDrawer] = useState(false);
  const [userApplied, setUserApplied] = useState({
    q: "",
    created_from: "",
    created_to: "",
    pageSize: DEFAULT_PAGE_SIZE,
  });

  const listsEnabled = Boolean(merchantId) && merchantQ.isSuccess;
  const txsEnabled = listsEnabled && tab === "transactions";
  const walletsEnabled = listsEnabled && tab === "wallets";
  const usersEnabled = listsEnabled && tab === "users";

  const txsQ = useQuery({
    queryKey: [
      "admin-merchant-txs",
      merchantId,
      txPage,
      txApplied.pageSize,
      txApplied.chain,
      txApplied.status,
      txApplied.token_symbol,
      txApplied.address,
    ],
    enabled: txsEnabled,
    queryFn: () => {
      const p = new URLSearchParams({
        page: String(txPage),
        pageSize: String(txApplied.pageSize),
        merchant_id: String(merchantId),
      });
      if (txApplied.chain) p.set("chain", txApplied.chain);
      if (txApplied.status) p.set("status", txApplied.status);
      if (txApplied.token_symbol.trim()) p.set("token_symbol", txApplied.token_symbol.trim());
      if (txApplied.address.trim()) p.set("address", txApplied.address.trim());
      return api(`/api/v1/admin/transactions?${p}`);
    },
  });

  const walletsQ = useQuery({
    queryKey: [
      "admin-merchant-wallets",
      merchantId,
      walPage,
      walApplied.pageSize,
      walApplied.chain,
      walApplied.address,
      walApplied.currency,
      walApplied.network,
      walApplied.q,
      walApplied.created_from,
      walApplied.created_to,
    ],
    enabled: walletsEnabled,
    queryFn: () => {
      const p = new URLSearchParams({
        page: String(walPage),
        pageSize: String(walApplied.pageSize),
        merchant_id: String(merchantId),
      });
      if (walApplied.chain) p.set("chain", walApplied.chain);
      if (walApplied.address.trim()) p.set("address", walApplied.address.trim());
      if (walApplied.currency.trim()) p.set("currency", walApplied.currency.trim());
      if (walApplied.network.trim()) p.set("network", walApplied.network.trim());
      if (walApplied.q.trim()) p.set("q", walApplied.q.trim());
      if (walApplied.created_from) p.set("created_from", walApplied.created_from);
      if (walApplied.created_to) p.set("created_to", walApplied.created_to);
      return api(`/api/v1/admin/wallets?${p}`);
    },
  });

  const usersQ = useQuery({
    queryKey: [
      "admin-merchant-users",
      merchantId,
      userPage,
      userApplied.pageSize,
      userApplied.q,
      userApplied.created_from,
      userApplied.created_to,
    ],
    enabled: usersEnabled,
    queryFn: () => {
      const p = new URLSearchParams({
        page: String(userPage),
        pageSize: String(userApplied.pageSize),
        merchant_id: String(merchantId),
      });
      if (userApplied.q.trim()) p.set("q", userApplied.q.trim());
      if (userApplied.created_from) p.set("created_from", userApplied.created_from);
      if (userApplied.created_to) p.set("created_to", userApplied.created_to);
      return api(`/api/v1/admin/users?${p}`);
    },
  });

  if (!merchantId) {
    return <p className="text-white/50">Missing merchant id.</p>;
  }

  if (merchantQ.isLoading) {
    return <p className="text-white/50">Loading…</p>;
  }

  if (merchantQ.isError || !merchantQ.data) {
    return (
      <div>
        <Link to="/admin/merchants" className="text-sm text-white/60 hover:text-white">
          ← Merchants
        </Link>
        <p className="mt-4 text-rose-400">Merchant not found.</p>
      </div>
    );
  }

  const m = merchantQ.data;
  const txs = txsQ.data?.transactions ?? [];
  const txsTotal = txsQ.data?.total ?? 0;
  const wallets = walletsQ.data?.wallets ?? [];
  const walletsTotal = walletsQ.data?.total ?? 0;
  const users = usersQ.data?.users ?? [];
  const usersTotal = usersQ.data?.total ?? 0;

  const txHasFilters =
    Boolean(txApplied.chain || txApplied.status || txApplied.token_symbol.trim() || txApplied.address.trim()) ||
    txApplied.pageSize !== DEFAULT_PAGE_SIZE;
  const txCanReset = txPage > 1 || txHasFilters;

  const walHasFilters =
    Boolean(
      walApplied.chain ||
        walApplied.address.trim() ||
        walApplied.currency.trim() ||
        walApplied.network.trim() ||
        walApplied.q.trim() ||
        walApplied.created_from ||
        walApplied.created_to,
    ) || walApplied.pageSize !== DEFAULT_PAGE_SIZE;
  const walCanReset = walPage > 1 || walHasFilters;

  const userHasFilters =
    Boolean(userApplied.q.trim() || userApplied.created_from || userApplied.created_to) ||
    userApplied.pageSize !== DEFAULT_PAGE_SIZE;
  const userCanReset = userPage > 1 || userHasFilters;

  return (
    <div className="w-full max-w-none">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to="/admin/merchants" className="text-sm text-white/50 hover:text-white">
            ← Merchants
          </Link>
          <h1 className="mt-3 font-display text-2xl font-semibold text-white">Merchant</h1>
          <p className="mt-1 font-mono text-sm text-white/70">{m.email}</p>
          {m.display_name ? (
            <p className="text-sm text-white/55">{m.display_name}</p>
          ) : null}
        </div>
        {m.deleted_at ? null : (
          <Link
            to={`/admin/merchants/${merchantId}/edit`}
            className="inline-flex items-center gap-2 rounded-xl border border-white/12 bg-white/5 px-4 py-2.5 text-sm font-medium text-white/80 transition-colors hover:border-white/20 hover:bg-white/10"
          >
            Edit merchant
          </Link>
        )}
      </div>

      {m.deleted_at ? (
        <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100/90">
          This merchant is <strong className="text-white/90">soft-deleted</strong>{" "}
          (<span className="font-mono">deleted_at</span> is set). Login, gateway,
          and edits are disabled. Data is retained in the database.
        </div>
      ) : null}

      <div className="glass w-full overflow-hidden rounded-2xl">
        <div
          className="flex flex-wrap gap-1 border-b border-white/10 bg-black/15 px-2 pt-2"
          role="tablist"
          aria-label="Merchant sections"
        >
          {MERCHANT_DETAIL_TABS.map((t) => {
            const selected = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={selected}
                id={`merchant-tab-${t.id}`}
                aria-controls={`merchant-panel-${t.id}`}
                onClick={() => setTab(t.id)}
                className={`-mb-px rounded-t-lg px-4 py-2.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/25 ${
                  selected
                    ? "border border-b-0 border-white/15 bg-white/[0.08] text-white"
                    : "border border-transparent text-white/55 hover:border-white/10 hover:bg-white/[0.04] hover:text-white/85"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="p-6 lg:p-8">
          <div
            id="merchant-panel-details"
            role="tabpanel"
            aria-labelledby="merchant-tab-details"
            hidden={tab !== "details"}
          >
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div>
                <p className="text-[10px] font-semibold tracking-wide text-white/40 uppercase">Status</p>
                <p className="mt-1 text-sm text-white/80">
                  {m.deleted_at
                    ? "Soft-deleted"
                    : m.is_active
                      ? "Active"
                      : "Inactive"}
                </p>
              </div>
              {m.deleted_at ? (
                <div className="lg:col-span-2">
                  <p className="text-[10px] font-semibold tracking-wide text-white/40 uppercase">
                    deleted_at
                  </p>
                  <p className="mt-1 font-mono text-sm text-white/70">
                    {String(m.deleted_at).slice(0, 19)}
                  </p>
                </div>
              ) : null}
              <div>
                <p className="text-[10px] font-semibold tracking-wide text-white/40 uppercase">Created</p>
                <p className="mt-1 font-mono text-sm text-white/70">
                  {m.created_at ? String(m.created_at).slice(0, 19) : "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-semibold tracking-wide text-white/40 uppercase">End users (live)</p>
                <p className="mt-1 text-sm text-white/80">{m.end_users_live ?? 0}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold tracking-wide text-white/40 uppercase">End users (sandbox)</p>
                <p className="mt-1 text-sm text-white/80">{m.end_users_sandbox ?? 0}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold tracking-wide text-white/40 uppercase">Live gateway</p>
                <p className="mt-1 text-sm text-white/80">{m.live_gateway_enabled !== false ? "On" : "Off"}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold tracking-wide text-white/40 uppercase">Sandbox gateway</p>
                <p className="mt-1 text-sm text-white/80">{m.sandbox_gateway_enabled !== false ? "On" : "Off"}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold tracking-wide text-white/40 uppercase">
                  Portal environment
                </p>
                <p className="mt-1 text-sm text-white/80 capitalize">
                  {m.portal_environment === "sandbox" ? "Sandbox" : "Live"}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-semibold tracking-wide text-white/40 uppercase">
                  Gateway API key hint
                </p>
                <p className="mt-1 font-mono text-sm text-white/70">…{m.api_key_hint ?? "—"}</p>
                {m.api_key_hint &&
                m.sandbox_api_key_hint &&
                m.api_key_hint !== m.sandbox_api_key_hint ? (
                  <p className="mt-1 text-xs text-amber-200/80">
                    Sandbox hint differs (legacy). Regenerate the gateway key in Edit merchant to unify.
                  </p>
                ) : null}
              </div>
              <div className="lg:col-span-2">
                <p className="text-[10px] font-semibold tracking-wide text-white/40 uppercase">Callback URL</p>
                <p className="mt-1 break-all font-mono text-xs text-white/60">{m.callback_url || "—"}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold tracking-wide text-white/40 uppercase">Default chains</p>
                <p className="mt-1 text-sm text-white/70">
                  {(m.default_chains ?? []).length ? m.default_chains.join(", ") : "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-semibold tracking-wide text-white/40 uppercase">Default pair</p>
                <p className="mt-1 text-sm text-white/70">
                  {m.default_currency && m.default_network
                    ? `${m.default_currency} · ${m.default_network}`
                    : "—"}
                </p>
              </div>
              <div className="lg:col-span-2">
                <p className="text-[10px] font-semibold tracking-wide text-white/40 uppercase">Deposit rails</p>
                <p className="mt-1 text-xs text-white/60">
                  {m.supported_deposit_rails?.length
                    ? m.supported_deposit_rails.map((k) => k.split("|").join(" · ")).join(", ")
                    : "—"}
                </p>
              </div>
            </div>
          </div>

          <div
            id="merchant-panel-transactions"
            role="tabpanel"
            aria-labelledby="merchant-tab-transactions"
            hidden={tab !== "transactions"}
          >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm text-white/45">Incoming deposits for this merchant.</p>
          </div>
          <ListFilterToolbar
            onOpenDrawer={() => setTxDrawer(true)}
            onReset={() => {
              setTxApplied({
                chain: "",
                status: "",
                token_symbol: "",
                address: "",
                pageSize: DEFAULT_PAGE_SIZE,
              });
              setTxPage(1);
              setTxDrawer(false);
            }}
            canReset={txCanReset}
          />
        </div>

        {txHasFilters ? (
          <ListActiveFiltersChips>
            {txApplied.chain ? (
              <span className="filter-chip">
                <span className="filter-chip-label">Chain</span>
                <span>{txApplied.chain}</span>
                <button
                  type="button"
                  className={listFilterChipCloseClass}
                  onClick={() => {
                    setTxApplied((a) => ({ ...a, chain: "" }));
                    setTxPage(1);
                  }}
                  aria-label="Remove chain filter"
                >
                  ×
                </button>
              </span>
            ) : null}
            {txApplied.status ? (
              <span className="filter-chip">
                <span className="filter-chip-label">Status</span>
                <span>{txApplied.status}</span>
                <button
                  type="button"
                  className={listFilterChipCloseClass}
                  onClick={() => {
                    setTxApplied((a) => ({ ...a, status: "" }));
                    setTxPage(1);
                  }}
                  aria-label="Remove status filter"
                >
                  ×
                </button>
              </span>
            ) : null}
            {txApplied.token_symbol.trim() ? (
              <span className="filter-chip max-w-full">
                <span className="filter-chip-label">Token</span>
                <span className="truncate font-mono">{txApplied.token_symbol}</span>
                <button
                  type="button"
                  className={listFilterChipCloseClass}
                  onClick={() => {
                    setTxApplied((a) => ({ ...a, token_symbol: "" }));
                    setTxPage(1);
                  }}
                  aria-label="Remove token filter"
                >
                  ×
                </button>
              </span>
            ) : null}
            {txApplied.address.trim() ? (
              <span className="inline-flex max-w-full items-center gap-1 rounded-xl border border-white/20 bg-white/[0.08] px-2.5 py-1.5 pl-3 text-xs text-white/85">
                <span className="text-[10px] font-semibold tracking-wide text-white/50 uppercase">Address</span>
                <span
                  className="max-w-[min(240px,50vw)] truncate font-mono text-[10px]"
                  title={txApplied.address}
                >
                  {txApplied.address}
                </span>
                <button
                  type="button"
                  className={listFilterChipCloseClass}
                  onClick={() => {
                    setTxApplied((a) => ({ ...a, address: "" }));
                    setTxPage(1);
                  }}
                  aria-label="Remove address filter"
                >
                  ×
                </button>
              </span>
            ) : null}
            {txApplied.pageSize !== DEFAULT_PAGE_SIZE ? (
              <span className="filter-chip">
                <span className="filter-chip-label">Page size</span>
                <span className="font-mono text-white/65">{txApplied.pageSize}</span>
                <button
                  type="button"
                  className={listFilterChipCloseClass}
                  onClick={() => {
                    setTxApplied((a) => ({ ...a, pageSize: DEFAULT_PAGE_SIZE }));
                    setTxPage(1);
                  }}
                  aria-label="Reset page size"
                >
                  ×
                </button>
              </span>
            ) : null}
          </ListActiveFiltersChips>
        ) : null}

        <ListFilterDrawer open={txDrawer} onClose={() => setTxDrawer(false)}>
          {txDrawer ? (
            <Formik
              enableReinitialize
              initialValues={{
                chain: txApplied.chain,
                status: txApplied.status,
                token_symbol: txApplied.token_symbol,
                address: txApplied.address,
              }}
              validationSchema={merchantDetailTransactionsFilterSchema}
              validateOnBlur
              validateOnChange={false}
              onSubmit={(vals, { setSubmitting }) => {
                setTxApplied((a) => ({
                  ...a,
                  chain: vals.chain,
                  status: vals.status,
                  token_symbol: vals.token_symbol,
                  address: vals.address,
                }));
                setTxPage(1);
                setTxDrawer(false);
                setSubmitting(false);
              }}
            >
              {({ resetForm }) => (
                <Form className="flex min-h-0 flex-1 flex-col">
                  <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                    <div className="space-y-5">
                      <div>
                        <label className={listFilterLabelClass} htmlFor="md-tx-chain">
                          Chain
                        </label>
                        <Field id="md-tx-chain" name="chain" as="select" className={listFilterInputClass}>
                          <option value="">All chains</option>
                          {CHAIN_VALUES.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </Field>
                        <ErrorMessage
                          name="chain"
                          component="p"
                          className="mt-1 text-xs text-rose-400"
                        />
                      </div>
                      <div>
                        <label className={listFilterLabelClass} htmlFor="md-tx-status">
                          Status
                        </label>
                        <Field id="md-tx-status" name="status" as="select" className={listFilterInputClass}>
                          <option value="">All status</option>
                          {TX_STATUS_OPTIONS.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </Field>
                        <ErrorMessage
                          name="status"
                          component="p"
                          className="mt-1 text-xs text-rose-400"
                        />
                      </div>
                      <div>
                        <label className={listFilterLabelClass} htmlFor="md-tx-token">
                          Token symbol
                        </label>
                        <Field
                          id="md-tx-token"
                          name="token_symbol"
                          className={listFilterInputClass}
                          placeholder="e.g. USDT"
                        />
                        <ErrorMessage
                          name="token_symbol"
                          component="p"
                          className="mt-1 text-xs text-rose-400"
                        />
                      </div>
                      <div>
                        <label className={listFilterLabelClass} htmlFor="md-tx-addr">
                          Deposit address
                        </label>
                        <Field
                          id="md-tx-addr"
                          name="address"
                          className={listFilterInputClass}
                          placeholder="0x… or partial"
                        />
                        <ErrorMessage
                          name="address"
                          component="p"
                          className="mt-1 text-xs text-rose-400"
                        />
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
                        resetForm({ values: { chain: "", status: "", token_symbol: "", address: "" } })
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

        <div className="mt-6 space-y-4">
          <div className="data-table-surface">
            <table className="data-table min-w-[820px]">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Chain</th>
                  <th>Token</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>User</th>
                  <th>Tx</th>
                </tr>
              </thead>
              <tbody>
                {txsQ.isLoading ? (
                  <tr>
                    <td colSpan={7} className="!py-12 text-center text-sm text-white/40">
                      Loading…
                    </td>
                  </tr>
                ) : null}
                {!txsQ.isLoading && txs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="!py-12 text-center text-sm text-white/45">
                      No record found.
                    </td>
                  </tr>
                ) : null}
                {!txsQ.isLoading &&
                  txs.map((t) => (
                    <tr key={t.id}>
                      <td className="text-xs text-white/45">{t.created_at.slice(0, 19)}</td>
                      <td>{t.chain}</td>
                      <td>{t.token_symbol}</td>
                      <td className="font-mono text-xs">
                        <span className="text-white/90">
                          {formatTokenAmount(t.amount, t.token_decimals)}
                        </span>
                        <span className="mt-0.5 block text-[10px] text-white/35">
                          raw {t.amount}
                        </span>
                      </td>
                      <td className="text-xs">{t.status}</td>
                      <td className="max-w-[120px] truncate font-mono text-xs">{t.external_user_id}</td>
                      <td className="max-w-[140px] truncate font-mono text-[10px] text-white/50">
                        {t.tx_hash}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <ListPaginationBar
            page={txPage}
            setPage={setTxPage}
            total={txsTotal}
            pageSize={txApplied.pageSize}
            setPageSize={(n) => setTxApplied((a) => ({ ...a, pageSize: n }))}
          />
        </div>
          </div>

          <div
            id="merchant-panel-wallets"
            role="tabpanel"
            aria-labelledby="merchant-tab-wallets"
            hidden={tab !== "wallets"}
          >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm text-white/45">Deposit addresses per end user.</p>
          </div>
          <ListFilterToolbar
            onOpenDrawer={() => setWalDrawer(true)}
            onReset={() => {
              setWalApplied({
                chain: "",
                address: "",
                currency: "",
                network: "",
                q: "",
                created_from: "",
                created_to: "",
                pageSize: DEFAULT_PAGE_SIZE,
              });
              setWalPage(1);
              setWalDrawer(false);
            }}
            canReset={walCanReset}
          />
        </div>

        {walHasFilters ? (
          <ListActiveFiltersChips>
            {walApplied.chain ? (
              <span className="filter-chip">
                <span className="filter-chip-label">Chain</span>
                <span>{walApplied.chain}</span>
                <button
                  type="button"
                  className={listFilterChipCloseClass}
                  onClick={() => {
                    setWalApplied((a) => ({ ...a, chain: "" }));
                    setWalPage(1);
                  }}
                  aria-label="Remove chain filter"
                >
                  ×
                </button>
              </span>
            ) : null}
            {walApplied.address.trim() ? (
              <span className="filter-chip max-w-full">
                <span className="filter-chip-label">Address</span>
                <span className="truncate font-mono text-[10px]" title={walApplied.address}>
                  {walApplied.address}
                </span>
                <button
                  type="button"
                  className={listFilterChipCloseClass}
                  onClick={() => {
                    setWalApplied((a) => ({ ...a, address: "" }));
                    setWalPage(1);
                  }}
                  aria-label="Remove address filter"
                >
                  ×
                </button>
              </span>
            ) : null}
            {walApplied.currency.trim() ? (
              <span className="filter-chip">
                <span className="filter-chip-label">Currency</span>
                <span className="font-mono">{walApplied.currency}</span>
                <button
                  type="button"
                  className={listFilterChipCloseClass}
                  onClick={() => {
                    setWalApplied((a) => ({ ...a, currency: "" }));
                    setWalPage(1);
                  }}
                  aria-label="Remove currency filter"
                >
                  ×
                </button>
              </span>
            ) : null}
            {walApplied.network.trim() ? (
              <span className="filter-chip">
                <span className="filter-chip-label">Network</span>
                <span className="font-mono">{walApplied.network}</span>
                <button
                  type="button"
                  className={listFilterChipCloseClass}
                  onClick={() => {
                    setWalApplied((a) => ({ ...a, network: "" }));
                    setWalPage(1);
                  }}
                  aria-label="Remove network filter"
                >
                  ×
                </button>
              </span>
            ) : null}
            {walApplied.q.trim() ? (
              <span className="filter-chip max-w-full">
                <span className="filter-chip-label">User</span>
                <span className="truncate font-mono text-white/65" title={walApplied.q}>
                  {walApplied.q}
                </span>
                <button
                  type="button"
                  className={listFilterChipCloseClass}
                  onClick={() => {
                    setWalApplied((a) => ({ ...a, q: "" }));
                    setWalPage(1);
                  }}
                  aria-label="Remove user filter"
                >
                  ×
                </button>
              </span>
            ) : null}
            {walApplied.created_from ? (
              <span className="inline-flex items-center gap-1 rounded-xl border border-white/20 bg-white/[0.08] px-2.5 py-1.5 pl-3 text-xs text-white/85">
                <span className="text-[10px] font-semibold tracking-wide text-white/50 uppercase">From</span>
                <span className="font-mono">{walApplied.created_from}</span>
                <button
                  type="button"
                  className={listFilterChipCloseClass}
                  onClick={() => {
                    setWalApplied((a) => ({ ...a, created_from: "" }));
                    setWalPage(1);
                  }}
                  aria-label="Remove from date"
                >
                  ×
                </button>
              </span>
            ) : null}
            {walApplied.created_to ? (
              <span className="inline-flex items-center gap-1 rounded-xl border border-white/20 bg-white/[0.08] px-2.5 py-1.5 pl-3 text-xs text-white/85">
                <span className="text-[10px] font-semibold tracking-wide text-white/50 uppercase">To</span>
                <span className="font-mono">{walApplied.created_to}</span>
                <button
                  type="button"
                  className={listFilterChipCloseClass}
                  onClick={() => {
                    setWalApplied((a) => ({ ...a, created_to: "" }));
                    setWalPage(1);
                  }}
                  aria-label="Remove to date"
                >
                  ×
                </button>
              </span>
            ) : null}
            {walApplied.pageSize !== DEFAULT_PAGE_SIZE ? (
              <span className="filter-chip">
                <span className="filter-chip-label">Page size</span>
                <span className="font-mono text-white/65">{walApplied.pageSize}</span>
                <button
                  type="button"
                  className={listFilterChipCloseClass}
                  onClick={() => {
                    setWalApplied((a) => ({ ...a, pageSize: DEFAULT_PAGE_SIZE }));
                    setWalPage(1);
                  }}
                  aria-label="Reset page size"
                >
                  ×
                </button>
              </span>
            ) : null}
          </ListActiveFiltersChips>
        ) : null}

        <ListFilterDrawer open={walDrawer} onClose={() => setWalDrawer(false)}>
          {walDrawer ? (
            <Formik
              enableReinitialize
              initialValues={{
                chain: walApplied.chain,
                address: walApplied.address,
                currency: walApplied.currency,
                network: walApplied.network,
                q: walApplied.q,
                created_from: walApplied.created_from,
                created_to: walApplied.created_to,
              }}
              validationSchema={merchantDetailWalletsFilterSchema}
              validateOnBlur
              validateOnChange={false}
              onSubmit={(vals, { setSubmitting }) => {
                setWalApplied((a) => ({
                  ...a,
                  chain: vals.chain,
                  address: vals.address,
                  currency: vals.currency,
                  network: vals.network,
                  q: vals.q,
                  created_from: vals.created_from,
                  created_to: vals.created_to,
                }));
                setWalPage(1);
                setWalDrawer(false);
                setSubmitting(false);
              }}
            >
              {({ resetForm }) => (
                <Form className="flex min-h-0 flex-1 flex-col">
                  <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                    <div className="space-y-5">
                      <div>
                        <label className={listFilterLabelClass} htmlFor="md-wal-chain">
                          Chain
                        </label>
                        <Field id="md-wal-chain" name="chain" as="select" className={listFilterInputClass}>
                          <option value="">All chains</option>
                          {CHAIN_VALUES.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </Field>
                        <ErrorMessage
                          name="chain"
                          component="p"
                          className="mt-1 text-xs text-rose-400"
                        />
                      </div>
                      <div>
                        <label className={listFilterLabelClass} htmlFor="md-wal-addr">
                          Address
                        </label>
                        <Field
                          id="md-wal-addr"
                          name="address"
                          className={listFilterInputClass}
                          placeholder="Full or partial"
                        />
                        <ErrorMessage
                          name="address"
                          component="p"
                          className="mt-1 text-xs text-rose-400"
                        />
                      </div>
                      <div>
                        <label className={listFilterLabelClass} htmlFor="md-wal-cur">
                          Currency
                        </label>
                        <Field
                          id="md-wal-cur"
                          name="currency"
                          className={listFilterInputClass}
                          placeholder="e.g. USDT"
                        />
                        <ErrorMessage
                          name="currency"
                          component="p"
                          className="mt-1 text-xs text-rose-400"
                        />
                      </div>
                      <div>
                        <label className={listFilterLabelClass} htmlFor="md-wal-net">
                          Network
                        </label>
                        <Field
                          id="md-wal-net"
                          name="network"
                          className={listFilterInputClass}
                          placeholder="e.g. TRC20"
                        />
                        <ErrorMessage
                          name="network"
                          component="p"
                          className="mt-1 text-xs text-rose-400"
                        />
                      </div>
                      <div>
                        <label className={listFilterLabelClass} htmlFor="md-wal-q">
                          User (id / external_user_id)
                        </label>
                        <Field
                          id="md-wal-q"
                          name="q"
                          className={listFilterInputClass}
                          placeholder="Filter by user"
                        />
                        <ErrorMessage name="q" component="p" className="mt-1 text-xs text-rose-400" />
                      </div>
                      <div>
                        <label className={listFilterLabelClass} htmlFor="md-wal-from">
                          Created from
                        </label>
                        <Field
                          id="md-wal-from"
                          name="created_from"
                          type="date"
                          className={listFilterInputClass}
                        />
                        <ErrorMessage
                          name="created_from"
                          component="p"
                          className="mt-1 text-xs text-rose-400"
                        />
                      </div>
                      <div>
                        <label className={listFilterLabelClass} htmlFor="md-wal-to">
                          Created to
                        </label>
                        <Field
                          id="md-wal-to"
                          name="created_to"
                          type="date"
                          className={listFilterInputClass}
                        />
                        <ErrorMessage
                          name="created_to"
                          component="p"
                          className="mt-1 text-xs text-rose-400"
                        />
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
                            chain: "",
                            address: "",
                            currency: "",
                            network: "",
                            q: "",
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

        <div className="mt-6 space-y-4">
          <div className="data-table-surface">
            <table className="data-table min-w-[900px]">
              <thead>
                <tr>
                  <th>Address</th>
                  <th>Chain</th>
                  <th>Currency</th>
                  <th>Network</th>
                  <th>External user</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {walletsQ.isLoading ? (
                  <tr>
                    <td colSpan={6} className="!py-12 text-center text-sm text-white/40">
                      Loading…
                    </td>
                  </tr>
                ) : null}
                {!walletsQ.isLoading && wallets.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="!py-12 text-center text-sm text-white/45">
                      No record found.
                    </td>
                  </tr>
                ) : null}
                {!walletsQ.isLoading &&
                  wallets.map((w) => (
                    <tr key={w.id}>
                      <td className="max-w-[200px] truncate font-mono text-[10px] text-white/70">
                        {w.address}
                      </td>
                      <td>{w.chain}</td>
                      <td className="font-mono text-xs">{w.currency}</td>
                      <td className="font-mono text-xs">{w.network}</td>
                      <td className="max-w-[140px] truncate font-mono text-xs">{w.external_user_id}</td>
                      <td className="text-xs text-white/45">{w.created_at.slice(0, 10)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <ListPaginationBar
            page={walPage}
            setPage={setWalPage}
            total={walletsTotal}
            pageSize={walApplied.pageSize}
            setPageSize={(n) => setWalApplied((a) => ({ ...a, pageSize: n }))}
          />
        </div>
          </div>

          <div
            id="merchant-panel-users"
            role="tabpanel"
            aria-labelledby="merchant-tab-users"
            hidden={tab !== "users"}
          >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm text-white/45">Gateway identities for this merchant.</p>
          </div>
          <ListFilterToolbar
            onOpenDrawer={() => setUserDrawer(true)}
            onReset={() => {
              setUserApplied({
                q: "",
                created_from: "",
                created_to: "",
                pageSize: DEFAULT_PAGE_SIZE,
              });
              setUserPage(1);
              setUserDrawer(false);
            }}
            canReset={userCanReset}
          />
        </div>

        {userHasFilters ? (
          <ListActiveFiltersChips>
            {userApplied.q.trim() ? (
              <span className="filter-chip max-w-full">
                <span className="filter-chip-label">Search</span>
                <span className="truncate font-mono text-white/65" title={userApplied.q}>
                  {userApplied.q}
                </span>
                <button
                  type="button"
                  className={listFilterChipCloseClass}
                  onClick={() => {
                    setUserApplied((a) => ({ ...a, q: "" }));
                    setUserPage(1);
                  }}
                  aria-label="Remove search filter"
                >
                  ×
                </button>
              </span>
            ) : null}
            {userApplied.created_from ? (
              <span className="inline-flex items-center gap-1 rounded-xl border border-white/20 bg-white/[0.08] px-2.5 py-1.5 pl-3 text-xs text-white/85">
                <span className="text-[10px] font-semibold tracking-wide text-white/50 uppercase">From</span>
                <span className="font-mono">{userApplied.created_from}</span>
                <button
                  type="button"
                  className={listFilterChipCloseClass}
                  onClick={() => {
                    setUserApplied((a) => ({ ...a, created_from: "" }));
                    setUserPage(1);
                  }}
                  aria-label="Remove from date"
                >
                  ×
                </button>
              </span>
            ) : null}
            {userApplied.created_to ? (
              <span className="inline-flex items-center gap-1 rounded-xl border border-white/20 bg-white/[0.08] px-2.5 py-1.5 pl-3 text-xs text-white/85">
                <span className="text-[10px] font-semibold tracking-wide text-white/50 uppercase">To</span>
                <span className="font-mono">{userApplied.created_to}</span>
                <button
                  type="button"
                  className={listFilterChipCloseClass}
                  onClick={() => {
                    setUserApplied((a) => ({ ...a, created_to: "" }));
                    setUserPage(1);
                  }}
                  aria-label="Remove to date"
                >
                  ×
                </button>
              </span>
            ) : null}
            {userApplied.pageSize !== DEFAULT_PAGE_SIZE ? (
              <span className="filter-chip">
                <span className="filter-chip-label">Page size</span>
                <span className="font-mono text-white/65">{userApplied.pageSize}</span>
                <button
                  type="button"
                  className={listFilterChipCloseClass}
                  onClick={() => {
                    setUserApplied((a) => ({ ...a, pageSize: DEFAULT_PAGE_SIZE }));
                    setUserPage(1);
                  }}
                  aria-label="Reset page size"
                >
                  ×
                </button>
              </span>
            ) : null}
          </ListActiveFiltersChips>
        ) : null}

        <ListFilterDrawer open={userDrawer} onClose={() => setUserDrawer(false)}>
          {userDrawer ? (
            <Formik
              enableReinitialize
              initialValues={{
                q: userApplied.q,
                created_from: userApplied.created_from,
                created_to: userApplied.created_to,
              }}
              validationSchema={merchantDetailUsersFilterSchema}
              validateOnBlur
              validateOnChange={false}
              onSubmit={(vals, { setSubmitting }) => {
                setUserApplied((a) => ({
                  ...a,
                  q: vals.q,
                  created_from: vals.created_from,
                  created_to: vals.created_to,
                }));
                setUserPage(1);
                setUserDrawer(false);
                setSubmitting(false);
              }}
            >
              {({ resetForm }) => (
                <Form className="flex min-h-0 flex-1 flex-col">
                  <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                    <div className="space-y-5">
                      <div>
                        <label className={listFilterLabelClass} htmlFor="md-user-q">
                          Search (id / external_user_id)
                        </label>
                        <Field id="md-user-q" name="q" className={listFilterInputClass} placeholder="Type to filter…" />
                        <ErrorMessage name="q" component="p" className="mt-1 text-xs text-rose-400" />
                      </div>
                      <div>
                        <label className={listFilterLabelClass} htmlFor="md-user-from">
                          Created from
                        </label>
                        <Field
                          id="md-user-from"
                          name="created_from"
                          type="date"
                          className={listFilterInputClass}
                        />
                        <ErrorMessage
                          name="created_from"
                          component="p"
                          className="mt-1 text-xs text-rose-400"
                        />
                      </div>
                      <div>
                        <label className={listFilterLabelClass} htmlFor="md-user-to">
                          Created to
                        </label>
                        <Field
                          id="md-user-to"
                          name="created_to"
                          type="date"
                          className={listFilterInputClass}
                        />
                        <ErrorMessage
                          name="created_to"
                          component="p"
                          className="mt-1 text-xs text-rose-400"
                        />
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
                        resetForm({ values: { q: "", created_from: "", created_to: "" } })
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

        <div className="mt-6 space-y-4">
          <div className="data-table-surface">
            <table className="data-table min-w-[520px]">
              <thead>
                <tr>
                  <th>External id</th>
                  <th>Wallets</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {usersQ.isLoading ? (
                  <tr>
                    <td colSpan={3} className="!py-12 text-center text-sm text-white/40">
                      Loading…
                    </td>
                  </tr>
                ) : null}
                {!usersQ.isLoading && users.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="!py-12 text-center text-sm text-white/45">
                      No record found.
                    </td>
                  </tr>
                ) : null}
                {!usersQ.isLoading &&
                  users.map((u) => (
                    <tr key={u.id}>
                      <td className="font-mono text-xs text-white/75">{u.external_user_id}</td>
                      <td>{u.wallets_count}</td>
                      <td className="text-xs text-white/45">{u.created_at.slice(0, 10)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <ListPaginationBar
            page={userPage}
            setPage={setUserPage}
            total={usersTotal}
            pageSize={userApplied.pageSize}
            setPageSize={(n) => setUserApplied((a) => ({ ...a, pageSize: n }))}
          />
        </div>
          </div>
        </div>
      </div>
    </div>
  );
}
