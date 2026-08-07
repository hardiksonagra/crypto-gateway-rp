import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api, apiBlobGet } from "../../api";
import { useMerchantPortalEnvironment } from "../../hooks/useMerchantPortalEnvironment.js";
import ListPaginationBar, { DEFAULT_LIST_PAGE_SIZE } from "../../components/ListPaginationBar";
import { PendingSettlementBucketCard } from "../../components/PendingSettlementBucketCard.js";
import { PayoutPreviewBucketCard } from "../../components/PayoutPreviewBucketCard.js";
import { formatTokenAmount } from "../../lib/formatTokenAmount.js";
import { formatLocalDateTime } from "../../lib/formatLocalDateTime.js";
import { BrandLoader } from "../../components/BrandLoader.js";

const DEFAULT_PAGE_SIZE = DEFAULT_LIST_PAGE_SIZE;

export default function RpSettlements() {
  const { pathname } = useLocation();
  const tab = pathname.endsWith("/pay-out-settlements") ? "payout" : "payin";
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
    void qc.invalidateQueries({ queryKey: ["rp-settlements-payout-preview", portalEnvironmentKey, mid] });
  }

  const pendingQ = useQuery({
    queryKey: ["rp-settlements-pending", portalEnvironmentKey, mid],
    queryFn: () => {
      const p = new URLSearchParams({ merchant_id: mid });
      return api(`/api/v1/rp/settlements/pending-preview?${p}`);
    },
    enabled: envQueryEnabled && tab === "payin",
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
    enabled: envQueryEnabled && tab === "payin",
  });

  const payoutPreviewQ = useQuery({
    queryKey: ["rp-settlements-payout-preview", portalEnvironmentKey, mid],
    queryFn: () => {
      const p = new URLSearchParams({ merchant_id: mid });
      return api(`/api/v1/rp/settlements/payout-preview?${p}`);
    },
    enabled: envQueryEnabled && tab === "payout",
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
        <h1 className="font-display text-2xl font-semibold text-white">
          {tab === "payout" ? "Payout settlements" : "Transactions settlements"}
        </h1>
        <p className="mt-4 text-sm text-rose-200/90">{String(merchantsQ.error)}</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-white">
        {tab === "payout" ? "Payout settlements" : "Transactions settlements"}
      </h1>

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
          {tab === "payin" ? (
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
          ) : (
            <>
              <h2 className="mt-8 text-sm font-semibold tracking-wide text-white/40 uppercase">
                Pending payouts (volume + RP reference)
              </h2>
              <p className="mt-1 text-xs text-white/40">
                Totals pending / processing gross per asset. Recipients get the full gross on-chain;{" "}
                <span className="font-medium text-white/65">payout MDR</span> is your billing reference rate only (same
                as when a payout is created — not deducted from send amount). Deposit settlement % and min settlement do
                not apply. Rows also appear under <span className="font-medium text-white/70">Payout</span>.
              </p>
              {payoutPreviewQ.isLoading ? (
                <div className="mt-3">
                  <BrandLoader
                    variant="section"
                    title=""
                    subtitle="Loading payout preview…"
                    aria-label="Loading payout preview"
                  />
                </div>
              ) : payoutPreviewQ.isError ? (
                <p className="mt-3 text-sm text-rose-400">{String(payoutPreviewQ.error)}</p>
              ) : (
                <>
                  {payoutPreviewQ.data?.fee_rates ? (
                    <p className="mt-3 text-sm text-white/75">
                      Payout MDR reference rate:{" "}
                      <span className="font-mono text-white/85">{payoutPreviewQ.data.fee_rates.payout_mdr_percent}%</span>{" "}
                      of gross (informational; not deducted from send amount)
                    </p>
                  ) : null}
                  {(payoutPreviewQ.data?.buckets ?? []).length === 0 ? (
                    <p className="mt-3 text-sm text-white/45">No pending or processing payouts.</p>
                  ) : (
                    <div className="mt-4 flex w-full flex-col gap-4">
                      {(payoutPreviewQ.data?.buckets ?? []).map((b) => (
                        <PayoutPreviewBucketCard
                          key={`${b.chain}-${b.token_symbol}-${b.token_decimals}`}
                          b={b}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
