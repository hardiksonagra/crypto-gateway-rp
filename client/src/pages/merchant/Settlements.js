import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, apiBlobGet } from "../../api";
import { useMerchantPortalEnvironment } from "../../hooks/useMerchantPortalEnvironment.js";
import ListPaginationBar, { DEFAULT_LIST_PAGE_SIZE } from "../../components/ListPaginationBar";
import { PendingSettlementBucketCard } from "../../components/PendingSettlementBucketCard.js";
import { formatTokenAmount } from "../../lib/formatTokenAmount.js";
import { formatLocalDateTime } from "../../lib/formatLocalDateTime.js";
import { BrandLoader } from "../../components/BrandLoader.js";

const DEFAULT_PAGE_SIZE = DEFAULT_LIST_PAGE_SIZE;

export default function MerchantSettlements() {
  const {
    environment,
    portalEnvironmentKey,
    liveGatewayEnabled,
    sandboxGatewayEnabled,
    flagsLoading,
  } = useMerchantPortalEnvironment();

  const envQueryEnabled =
    !flagsLoading &&
    ((environment === "live" && liveGatewayEnabled) ||
      (environment === "sandbox" && sandboxGatewayEnabled));

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [proofErr, setProofErr] = useState(null);

  const pendingQ = useQuery({
    queryKey: ["m-settlements-pending", portalEnvironmentKey],
    queryFn: () => api("/api/v1/merchant/settlements/pending-preview"),
    enabled: envQueryEnabled,
  });

  const meQ = useQuery({
    queryKey: ["auth-me"],
    queryFn: () => api("/api/v1/auth/me"),
    enabled: envQueryEnabled,
    staleTime: 60_000,
  });

  const q = useQuery({
    queryKey: ["m-settlements", portalEnvironmentKey, page, pageSize],
    queryFn: () => {
      const p = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      return api(`/api/v1/merchant/settlements?${p}`);
    },
    enabled: envQueryEnabled,
  });

  const total = q.data?.total ?? 0;
  const rows = q.data?.settlements ?? [];
  const buckets = pendingQ.data?.buckets ?? [];

  async function openProof(id) {
    setProofErr(null);
    try {
      const blob = await apiBlobGet(`/api/v1/merchant/settlements/${id}/proof`);
      const u = URL.createObjectURL(blob);
      window.open(u, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(u), 60_000);
    } catch (e) {
      setProofErr(String(e));
    }
  }

  if (flagsLoading) {
    return (
      <BrandLoader
        variant="page"
        title=""
        subtitle="Loading settlements…"
        aria-label="Loading settlements"
      />
    );
  }

  if (!liveGatewayEnabled && !sandboxGatewayEnabled) {
    return (
      <div>
        <h1 className="font-display text-2xl font-semibold text-white">Settlements</h1>
        <p className="mt-4 text-sm text-rose-200/90">
          Neither live nor sandbox gateway is enabled for your account. Contact support.
        </p>
      </div>
    );
  }

  if (!envQueryEnabled) {
    return (
      <BrandLoader
        variant="page"
        title=""
        subtitle="Preparing settlements…"
        aria-label="Preparing settlements"
      />
    );
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-white">Settlements</h1>
      <p className="mt-2 text-sm text-white/50">
        Estimated next batch and payouts already recorded for this environment. View only.
      </p>

      <h2 className="mt-8 text-sm font-semibold tracking-wide text-white/40 uppercase">
        Next settlement (estimate)
      </h2>
      <p className="mt-1 text-xs text-white/40">
        Same breakdown as the operator console: MDR on gross, settlement fee on amount after MDR, then
        estimated net. Your minimum is in token units; settlement is recorded by an admin when eligible.
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
              variant="merchant"
              b={b}
              merchantEmail={meQ.data?.email}
              merchantDisplayName={meQ.data?.displayName ?? null}
            />
          ))}
        </div>
      )}

      {proofErr ? <p className="mt-6 text-sm text-rose-400">{proofErr}</p> : null}

      <h2 className="mt-10 text-sm font-semibold tracking-wide text-white/40 uppercase">
        Paid to you (recorded)
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
            {q.isLoading ? (
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
    </div>
  );
}
