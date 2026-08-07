import { Formik, Form, Field, ErrorMessage } from "formik";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation } from "react-router-dom";
import { api, apiBlobGet } from "../../api";
import { adminSettlementsFilterSchema } from "../../admin/merchantSchemas";
import ListPaginationBar, {
  DEFAULT_LIST_PAGE_SIZE,
} from "../../components/ListPaginationBar";
import { PendingSettlementBucketCard } from "../../components/PendingSettlementBucketCard.js";
import { PayoutPreviewBucketCard } from "../../components/PayoutPreviewBucketCard.js";
import { formatTokenAmount } from "../../lib/formatTokenAmount.js";
import { formatLocalDateTime } from "../../lib/formatLocalDateTime.js";
import { BrandLoader } from "../../components/BrandLoader.js";
import { resellerPartnerLabel, resellerPartnerTitle } from "../../lib/resellerPartnerLabel.js";

const DEFAULT_PAGE_SIZE = DEFAULT_LIST_PAGE_SIZE;

const filterInput =
  "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-white/20 focus:ring-1";

const labelCls = "mb-1 block text-xs font-medium text-white/60";

export default function AdminSettlements() {
  const { pathname } = useLocation();
  const tab = pathname.endsWith("/pay-out-settlements") ? "payout" : "payin";
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [proofErr, setProofErr] = useState(null);
  const [applied, setApplied] = useState({ merchantEmail: "" });
  const qc = useQueryClient();

  const hasFilter = Boolean(applied.merchantEmail.trim());

  const pendingQ = useQuery({
    queryKey: ["admin-settlements-pending", applied.merchantEmail],
    queryFn: () => {
      const p = new URLSearchParams({
        merchant_email: applied.merchantEmail.trim(),
      });
      return api(`/api/v1/admin/settlements/pending-preview?${p}`);
    },
    enabled: hasFilter && tab === "payin",
  });

  const listQ = useQuery({
    queryKey: ["admin-settlements", page, pageSize, applied.merchantEmail],
    queryFn: () => {
      const p = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        merchant_email: applied.merchantEmail.trim(),
      });
      return api(`/api/v1/admin/settlements?${p}`);
    },
    enabled: hasFilter && tab === "payin",
  });

  const payoutPreviewQ = useQuery({
    queryKey: ["admin-settlements-payout-preview", applied.merchantEmail],
    queryFn: () => {
      const p = new URLSearchParams({
        merchant_email: applied.merchantEmail.trim(),
      });
      return api(`/api/v1/admin/settlements/payout-preview?${p}`);
    },
    enabled: hasFilter && tab === "payout",
  });

  const total = listQ.data?.total ?? 0;
  const rows = listQ.data?.settlements ?? [];
  const buckets = pendingQ.data?.buckets ?? [];
  const pendingMerchantEmail = pendingQ.data?.merchant_email;
  const pendingMerchantDisplayName = pendingQ.data?.merchant_display_name;
  const pendingRpRow = {
    reseller_partner_display_name: pendingQ.data?.reseller_partner_display_name,
    reseller_partner_email: pendingQ.data?.reseller_partner_email,
  };

  function invalidateSettlementQueries() {
    void qc.invalidateQueries({
      queryKey: ["admin-settlements", page, pageSize, applied.merchantEmail],
    });
    void qc.invalidateQueries({
      queryKey: ["admin-settlements-pending", applied.merchantEmail],
    });
    void qc.invalidateQueries({
      queryKey: ["admin-settlements-payout-preview", applied.merchantEmail],
    });
  }

  async function openProof(id) {
    setProofErr(null);
    try {
      const blob = await apiBlobGet(`/api/v1/admin/settlements/${id}/proof`);
      const u = URL.createObjectURL(blob);
      window.open(u, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(u), 60_000);
    } catch (e) {
      setProofErr(String(e));
    }
  }

  return (
    <div className="w-full max-w-none">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-white">
            {tab === "payout" ? "Payout settlements" : "Transactions settlements"}
          </h1>
        </div>
      </div>

      <div className="glass mt-6 w-full rounded-2xl p-4 lg:p-6">
        <Formik
          initialValues={{ merchant_email: "" }}
          validationSchema={adminSettlementsFilterSchema}
          validateOnBlur
          validateOnChange={false}
          onSubmit={(values, { setSubmitting }) => {
            setApplied({
              merchantEmail: values.merchant_email.trim(),
            });
            setPage(1);
            setSubmitting(false);
          }}
        >
          {() => (
            <Form className="flex flex-wrap items-end gap-4">
              <div className="min-w-[min(100%,24rem)] flex-1">
                <label className={labelCls} htmlFor="merchant_email">
                  Merchant email
                </label>
                <Field
                  id="merchant_email"
                  name="merchant_email"
                  type="email"
                  className={filterInput}
                  placeholder="merchant@example.com"
                  autoComplete="email"
                />
                <ErrorMessage
                  name="merchant_email"
                  component="p"
                  className="mt-1 text-xs text-rose-400"
                />
              </div>
              <button
                type="submit"
                className="btn-primary rounded-lg px-4 py-2 text-sm"
              >
                Load merchant
              </button>
            </Form>
          )}
        </Formik>
      </div>

      {hasFilter ? (
        <>
          {tab === "payin" ? (
            <>
              <h2 className="mt-8 text-sm font-semibold tracking-wide text-white/40 uppercase">
                Next settlement batches (unsettled transactions)
              </h2>
              {!pendingQ.isLoading && !pendingQ.isError && pendingMerchantEmail ? (
                <p className="mt-2 text-sm text-white/75">
                  <span className="text-white/45">Merchant</span>{" "}
                  <span className="font-mono text-white/90">
                    {pendingMerchantEmail}
                  </span>
                  {pendingMerchantDisplayName?.trim() ? (
                    <span className="text-white/55">
                      {" "}
                      · {pendingMerchantDisplayName.trim()}
                    </span>
                  ) : null}
                  {resellerPartnerLabel(pendingRpRow) !== "—" ? (
                    <span className="text-white/55" title={resellerPartnerTitle(pendingRpRow)}>
                      {" "}
                      · RP <span className="text-white/80">{resellerPartnerLabel(pendingRpRow)}</span>
                    </span>
                  ) : null}
                </p>
              ) : null}
              <p className="mt-1 text-xs text-white/40">
                MDR applies to gross; settlement fee applies to the amount after MDR
                (RP-linked merchants use MDR only — no platform settlement fee).
                Net is what reduces the merchant&apos;s portal balance when you
                settle. Minimum settlement on the merchant is in{" "}
                <span className="font-medium text-white/70">token units</span> (e.g.
                3000 USDT), converted per asset using decimals. Proof is required;
                &quot;Settle batch&quot; only when net (smallest units) is strictly
                above that threshold, or min is 0 and net is positive. Change email
                and Load again anytime.
              </p>
              {pendingQ.isLoading ? (
                <div className="mt-3">
                  <BrandLoader
                    variant="section"
                    title=""
                    subtitle="Loading settlement preview…"
                    className="min-h-0 py-6"
                    aria-label="Loading settlement preview"
                  />
                </div>
              ) : pendingQ.isError ? (
                <p className="mt-3 text-sm text-rose-400">
                  {String(pendingQ.error)}
                </p>
              ) : buckets.length === 0 ? (
                <p className="mt-3 text-sm text-white/45">
                  No pending unsettled live volume for this merchant.
                </p>
              ) : (
                <div className="mt-4 flex w-full flex-col gap-4">
                  {buckets.map((b) => (
                    <PendingSettlementBucketCard
                      key={`${b.chain}-${b.token_symbol}-${b.token_decimals}`}
                      variant="admin"
                      b={b}
                      merchantEmail={pendingMerchantEmail ?? undefined}
                      merchantDisplayName={pendingMerchantDisplayName}
                      merchantId={pendingQ.data?.merchant_id ?? ""}
                      onSettled={invalidateSettlementQueries}
                    />
                  ))}
                </div>
              )}

              {proofErr ? (
                <p className="mt-6 text-sm text-rose-400">{proofErr}</p>
              ) : null}

              <h2 className="mt-10 text-sm font-semibold tracking-wide text-white/40 uppercase">
                Settlement history
              </h2>
              <div className="data-table-surface mt-3">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Merchant</th>
                      <th>RP</th>
                      <th>Asset</th>
                      <th>Txs</th>
                      <th>Gross</th>
                      <th>MDR</th>
                      <th>Settle fee</th>
                      <th>Net</th>
                      <th>Proof</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listQ.isLoading ? (
                      <tr>
                        <td colSpan={10} className="!py-8">
                          <BrandLoader variant="inline" title="" subtitle="Loading…" />
                        </td>
                      </tr>
                    ) : rows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={10}
                          className="!py-12 text-center text-sm text-white/45"
                        >
                          No live settlements recorded for this merchant yet.
                        </td>
                      </tr>
                    ) : (
                      rows.map((s) => {
                        const rpLab = resellerPartnerLabel(s);
                        return (
                          <tr key={s.id}>
                            <td className="whitespace-nowrap text-xs text-white/45">
                              {formatLocalDateTime(s.created_at)}
                            </td>
                            <td
                              className="max-w-[200px] truncate text-sm text-white/80"
                              title={s.merchant_email}
                            >
                              {s.merchant_email}
                            </td>
                            <td
                              className="max-w-[140px] truncate text-xs text-white/55"
                              title={resellerPartnerTitle(s)}
                            >
                              {rpLab !== "—" ? (
                                <span className="text-white/75">{rpLab}</span>
                              ) : (
                                <span className="text-white/35">—</span>
                              )}
                            </td>
                            <td className="text-xs text-white/70">
                              {s.chain} {s.token_symbol}
                            </td>
                            <td className="font-mono text-xs text-white/70">
                              {s.transaction_count ?? 0}
                            </td>
                            <td className="font-mono text-xs text-white/85">
                              {formatTokenAmount(s.gross_amount, s.token_decimals)}
                            </td>
                            <td className="font-mono text-xs text-white/70">
                              {formatTokenAmount(s.mdr_amount, s.token_decimals)}
                            </td>
                            <td className="font-mono text-xs text-white/70">
                              {formatTokenAmount(
                                s.settlement_fee_amount,
                                s.token_decimals,
                              )}
                            </td>
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
                        );
                      })
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
                Pending / processing payout gross per asset is totaled. Recipients receive the full gross on-chain;{" "}
                <span className="font-medium text-white/65">payout MDR</span> is an RP/admin billing reference only (not
                deducted here). Deposit settlement % and min settlement do not apply. Terminal payouts:{" "}
                <span className="font-medium text-white/70">Payout</span> with merchant filter.
              </p>
              {payoutPreviewQ.isLoading ? (
                <div className="mt-3">
                  <BrandLoader
                    variant="section"
                    title=""
                    subtitle="Loading payout preview…"
                    className="min-h-0 py-6"
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
                    <p className="mt-3 text-sm text-white/45">
                      No pending or processing payouts for this merchant.
                    </p>
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
      ) : null}

      {!hasFilter ? (
        <>
          <h2 className="mt-10 text-sm font-semibold tracking-wide text-white/40 uppercase">
            Settlement history
          </h2>
          <div className="data-table-surface mt-3">
            <table className="data-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Merchant</th>
                  <th>RP</th>
                  <th>Asset</th>
                  <th>Txs</th>
                  <th>Gross</th>
                  <th>MDR</th>
                  <th>Settle fee</th>
                  <th>Net</th>
                  <th>Proof</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td
                    colSpan={10}
                    className="!py-12 text-center text-sm text-white/45"
                  >
                    Enter a merchant email and click Load merchant.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
