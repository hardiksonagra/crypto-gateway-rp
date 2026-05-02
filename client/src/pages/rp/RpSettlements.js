import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, apiBlobGet } from "../../api";
import { useMerchantPortalEnvironment } from "../../hooks/useMerchantPortalEnvironment.js";
import ListPaginationBar, { DEFAULT_LIST_PAGE_SIZE } from "../../components/ListPaginationBar";
import { PendingSettlementBucketCard } from "../../components/PendingSettlementBucketCard.js";
import { formatTokenAmount } from "../../lib/formatTokenAmount.js";
import { formatLocalDateTime } from "../../lib/formatLocalDateTime.js";
import { BrandLoader } from "../../components/BrandLoader.js";

const DEFAULT_PAGE_SIZE = DEFAULT_LIST_PAGE_SIZE;

export default function RpSettlements() {
  const qc = useQueryClient();
  const {
    environment,
    portalEnvironmentKey,
    flagsLoading,
  } = useMerchantPortalEnvironment();

  const merchantsQ = useQuery({
    queryKey: ["rp-merchants-for-settlements"],
    queryFn: () =>
      api("/api/v1/rp/merchants?page=1&pageSize=100"),
  });

  const [merchantId, setMerchantId] = useState("");

  useEffect(() => {
    const list = merchantsQ.data?.merchants ?? [];
    if (!merchantId && list.length > 0) {
      setMerchantId(String(list[0].id));
    }
  }, [merchantsQ.data, merchantId]);

  const mid = merchantId.trim();
  const hasMerchant = /^\d+$/.test(mid);
  const merchantOptions = merchantsQ.data?.merchants ?? [];
  const selected = merchantOptions.find((m) => String(m.id) === merchantId);

  const gatewayOkForSelected =
    selected &&
    ((environment === "live" && selected.live_gateway_enabled !== false) ||
      (environment === "sandbox" && selected.sandbox_gateway_enabled !== false));

  const envQueryEnabled = hasMerchant && !flagsLoading && Boolean(gatewayOkForSelected);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [proofErr, setProofErr] = useState(null);

  function invalidateSettlementQueries() {
    void qc.invalidateQueries({ queryKey: ["rp-settlements-pending", portalEnvironmentKey, mid] });
    void qc.invalidateQueries({ queryKey: ["rp-settlements", portalEnvironmentKey, mid, page, pageSize] });
  }

  const pendingQ = useQuery({
    queryKey: ["rp-settlements-pending", portalEnvironmentKey, mid],
    queryFn: () => {
      const p = new URLSearchParams({ merchant_id: mid });
      return api(`/api/v1/rp/settlements/pending-preview?${p}`);
    },
    enabled: envQueryEnabled,
  });

  const listQ = useQuery({
    queryKey: ["rp-settlements", portalEnvironmentKey, mid, page, pageSize],
    queryFn: () => {
      const p = new URLSearchParams({
        merchant_id: mid,
        page: String(page),
        pageSize: String(pageSize),
      });
      return api(`/api/v1/rp/settlements?${p}`);
    },
    enabled: envQueryEnabled,
  });

  const total = listQ.data?.total ?? 0;
  const rows = listQ.data?.settlements ?? [];
  const buckets = pendingQ.data?.buckets ?? [];

  async function openProof(id) {
    setProofErr(null);
    try {
      const blob = await apiBlobGet(`/api/v1/rp/settlements/${id}/proof`);
      const u = URL.createObjectURL(blob);
      window.open(u, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(u), 60_000);
    } catch (e) {
      setProofErr(String(e));
    }
  }

  if (flagsLoading || merchantsQ.isLoading) {
    return (
      <BrandLoader
        variant="page"
        title=""
        subtitle="Loading settlements…"
        aria-label="Loading settlements"
      />
    );
  }

  if (merchantsQ.isError) {
    return (
      <div>
        <h1 className="font-display text-2xl font-semibold text-white">Settlements</h1>
        <p className="mt-4 text-sm text-rose-200/90">{String(merchantsQ.error)}</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-white">Settlements</h1>
      <p className="mt-2 text-sm text-white/50">
        Pick a merchant you manage. Estimates use <span className="text-white/70">MDR only</span> (no platform
        settlement fee on partner merchants). You can record a payout with a proof attachment the same way as the
        admin console; data follows your portal environment and that merchant&apos;s gateway flags.
      </p>

      <div className="mt-6 max-w-xl">
        <label className="mb-1 block text-xs font-medium text-white/60" htmlFor="rp-settle-merchant">
          Merchant
        </label>
        <select
          id="rp-settle-merchant"
          className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
          value={merchantId}
          onChange={(e) => {
            setMerchantId(e.target.value);
            setPage(1);
          }}
        >
          <option value="">— Select —</option>
          {merchantOptions.map((m) => (
            <option key={m.id} value={String(m.id)}>
              {m.email}
              {m.display_name ? ` (${m.display_name})` : ""}
            </option>
          ))}
        </select>
      </div>

      {!hasMerchant ? (
        <p className="mt-8 text-sm text-white/45">
          {merchantOptions.length === 0 ? (
            <>
              No merchants yet.{" "}
              <Link to="/rp/merchants/new" className="text-sky-300/90 underline-offset-2 hover:underline">
                Create one
              </Link>
              .
            </>
          ) : (
            "Select a merchant to load settlement data."
          )}
        </p>
      ) : selected && !gatewayOkForSelected ? (
        <p className="mt-8 text-sm text-rose-200/90">
          {environment === "live"
            ? "Live gateway is disabled for this merchant — enable it on the merchant record or switch your portal to Sandbox in Profile."
            : "Sandbox gateway is disabled for this merchant — enable it or switch to Live in Profile."}
        </p>
      ) : (
        <>
          <h2 className="mt-8 text-sm font-semibold tracking-wide text-white/40 uppercase">
            Next settlement (estimate)
          </h2>
          <p className="mt-1 text-xs text-white/40">
            MDR on gross only; net is gross minus MDR. Minimum is in token units. Upload proof when you record a
            batch — it is stored on the settlement and opens from the history table.
          </p>
          {pendingQ.isLoading ? (
            <div className="mt-2">
              <BrandLoader
                variant="section"
                title=""
                subtitle="Loading next settlement estimate…"
                aria-label="Loading settlement preview"
              />
            </div>
          ) : pendingQ.isError ? (
            <p className="mt-2 text-sm text-rose-400">{String(pendingQ.error)}</p>
          ) : buckets.length === 0 ? (
            <p className="mt-2 text-sm text-white/45">Nothing queued for settlement.</p>
          ) : (
            <div className="mt-4 flex w-full flex-col gap-4">
              {buckets.map((b) => (
                <PendingSettlementBucketCard
                  key={`${b.chain}-${b.token_symbol}-${b.token_decimals}`}
                  variant="rp"
                  b={b}
                  merchantEmail={pendingQ.data?.merchant_email}
                  merchantDisplayName={pendingQ.data?.merchant_display_name ?? null}
                  merchantId={mid}
                  onSettled={invalidateSettlementQueries}
                />
              ))}
            </div>
          )}

          {proofErr ? <p className="mt-6 text-sm text-rose-400">{proofErr}</p> : null}

          <h2 className="mt-10 text-sm font-semibold tracking-wide text-white/40 uppercase">
            Paid to merchant (recorded)
          </h2>
          <div className="data-table-surface mt-3">
            <table className="data-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Asset</th>
                  <th>Txs</th>
                  <th>Settled amount</th>
                  <th>Proof</th>
                </tr>
              </thead>
              <tbody>
                {listQ.isLoading ? (
                  <tr>
                    <td colSpan={5} className="!py-8">
                      <BrandLoader variant="inline" title="" subtitle="Loading…" />
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="!py-12 text-center text-sm text-white/45">
                      No settlements in this environment.
                    </td>
                  </tr>
                ) : (
                  rows.map((s) => (
                    <tr key={s.id}>
                      <td className="whitespace-nowrap text-xs text-white/45">
                        {formatLocalDateTime(s.created_at)}
                      </td>
                      <td className="text-xs text-white/70">
                        {s.chain} {s.token_symbol}
                      </td>
                      <td className="font-mono text-xs text-white/70">{s.transaction_count ?? 0}</td>
                      <td className="font-mono text-xs text-emerald-200/90">
                        {formatTokenAmount(s.net_amount, s.token_decimals)}
                      </td>
                      <td>
                        {s.has_proof ? (
                          <button
                            type="button"
                            onClick={() => void openProof(s.id)}
                            className="text-xs text-sky-300/90 hover:text-sky-200"
                          >
                            View
                          </button>
                        ) : (
                          <span className="text-xs text-white/35">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <ListPaginationBar
            page={page}
            setPage={setPage}
            pageSize={pageSize}
            setPageSize={setPageSize}
            total={total}
          />
        </>
      )}
    </div>
  );
}
