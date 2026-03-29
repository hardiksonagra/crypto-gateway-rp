import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "../../api";
import { GATEWAY_TRON_USDT_ONLY } from "../../admin/depositRailOptions.js";
import ConfirmModal from "../../components/ConfirmModal";

const FILTER_ALL = "all";

const SWEEP_FILTERS_FULL = [
  { value: FILTER_ALL, label: "All rails" },
  { value: "tron_usdt", label: "USDT · TRC20" },
  { value: "tron_trx", label: "TRX · TRON" },
  { value: "evm_usdt_eth", label: "USDT · ERC20" },
  { value: "evm_usdt_bnb", label: "USDT · BEP20" },
  { value: "solana_usdt", label: "USDT · SPL" },
];

const SWEEP_FILTERS = GATEWAY_TRON_USDT_ONLY
  ? [
      { value: FILTER_ALL, label: "All (TRC20)" },
      { value: "tron_usdt", label: "USDT · TRC20" },
    ]
  : SWEEP_FILTERS_FULL;

export default function AdminUnifiedSweep() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState(FILTER_ALL);
  const [selectedId, setSelectedId] = useState(null);
  const [confirmOne, setConfirmOne] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const [lastBatch, setLastBatch] = useState(null);
  const [lastOne, setLastOne] = useState(null);

  const targets = useQuery({
    queryKey: ["admin-sweep-targets"],
    queryFn: () => api("/api/v1/admin/sweep/targets"),
  });

  const sweepOneMut = useMutation({
    mutationFn: (walletId) =>
      api("/api/v1/admin/sweep/one", {
        method: "POST",
        json: { wallet_id: walletId },
      }),
    onSuccess: (data) => {
      setLastOne(data);
      void qc.invalidateQueries({ queryKey: ["admin-sweep-targets"] });
    },
  });

  const sweepAllMut = useMutation({
    mutationFn: () => api("/api/v1/admin/sweep/all", { method: "POST", json: {} }),
    onSuccess: (data) => {
      setLastBatch(data);
      void qc.invalidateQueries({ queryKey: ["admin-sweep-targets"] });
    },
  });

  const allWallets = targets.data?.wallets ?? [];
  const wallets = useMemo(() => {
    if (filter === FILTER_ALL) return allWallets;
    return allWallets.filter((w) => w.sweep_kind === filter);
  }, [allWallets, filter]);

  const selectedRow = useMemo(
    () => allWallets.find((w) => w.id === selectedId) ?? null,
    [allWallets, selectedId],
  );

  return (
    <div className="w-full">
      <h1 className="font-display text-2xl font-semibold text-white">Consolidate (sweep)</h1>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-white/55">
        One list of every gateway deposit wallet that can be consolidated. The server picks the correct sweep from each
        row&apos;s <span className="font-mono text-white/65">currency</span>,{" "}
        <span className="font-mono text-white/65">network</span>, and <span className="font-mono text-white/65">chain</span>
        . Set the matching <span className="font-mono text-white/60">SWEEP_MASTER_*</span> values in{" "}
        <span className="font-mono">.env</span> (e.g. <span className="font-mono text-white/60">SWEEP_MASTER_TRON</span>{" "}
        for USDT TRC20). Sandbox and live wallets both appear here.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-white/60">
          <span className="text-white/45">Filter</span>
          <select
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setSelectedId(null);
            }}
            className="rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2 text-sm text-white/90 outline-none focus:border-sky-500/50"
          >
            {SWEEP_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={
            !selectedRow?.sweep_configured ||
            !selectedId ||
            sweepOneMut.isPending ||
            sweepAllMut.isPending
          }
          onClick={() => setConfirmOne(true)}
          className="rounded-xl border border-white/15 px-4 py-2.5 text-sm font-medium text-white/90 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Sweep selected wallet
        </button>
        <button
          type="button"
          disabled={sweepAllMut.isPending || sweepOneMut.isPending || allWallets.length === 0}
          onClick={() => setConfirmAll(true)}
          className="rounded-xl bg-rose-600/90 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {GATEWAY_TRON_USDT_ONLY ? "Sweep all (TRC20)" : "Sweep all (all rails)"}
        </button>
        {targets.isFetching ? <span className="text-xs text-white/40">Refreshing…</span> : null}
      </div>

      {lastOne ? (
        <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/75">
          <p className="font-medium text-white">Last single sweep</p>
          {lastOne.sweep_label ? (
            <p className="mt-0.5 text-xs text-white/50">Rail: {lastOne.sweep_label}</p>
          ) : null}
          {lastOne.skipped ? (
            <p className="mt-1 text-white/60">Skipped: {lastOne.reason}</p>
          ) : lastOne.ok !== false && lastOne.tx_hash ? (
            <p className="mt-1 break-all font-mono text-xs text-emerald-200/90">
              Tx {lastOne.tx_hash}
              {lastOne.amount_atomic != null ? ` · amount (atomic) ${lastOne.amount_atomic}` : ""}
            </p>
          ) : null}
        </div>
      ) : null}

      {lastBatch?.summary ? (
        <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/75">
          <p className="font-medium text-white">Last batch (all rails)</p>
          <p className="mt-1 text-white/60">
            Attempted {lastBatch.summary.attempted} · swept {lastBatch.summary.ok} · skipped{" "}
            {lastBatch.summary.skipped} · failed {lastBatch.summary.failed}
          </p>
          {lastBatch.unconfigured?.length ? (
            <div className="mt-3 border-t border-white/10 pt-3 text-xs text-amber-200/85">
              <p className="font-medium text-amber-100/95">Masters not set (those rails were skipped entirely)</p>
              <ul className="mt-1 list-inside list-disc text-white/55">
                {lastBatch.unconfigured.map((u) => (
                  <li key={u.sweep_kind}>
                    {u.sweep_label} — set <span className="font-mono text-white/70">{u.master_env}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-8 overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.03]">
        <table className="w-full min-w-[1100px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-white/10 text-xs font-medium tracking-wide text-white/45 uppercase">
              <th className="px-3 py-3 w-10" />
              <th className="px-3 py-3">Env</th>
              <th className="px-3 py-3">Sweep</th>
              <th className="px-3 py-3">Master</th>
              <th className="px-3 py-3">Rail</th>
              <th className="px-3 py-3">Deposit address</th>
              <th className="px-3 py-3">Deriv</th>
              <th className="px-3 py-3">External user</th>
              <th className="px-3 py-3">Merchant</th>
            </tr>
          </thead>
          <tbody>
            {targets.isLoading ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-white/45">
                  Loading…
                </td>
              </tr>
            ) : wallets.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-white/45">
                  No sweepable wallets for this filter.
                </td>
              </tr>
            ) : (
              wallets.map((w) => (
                <tr
                  key={w.id}
                  className={`border-b border-white/5 transition hover:bg-white/[0.04] ${
                    selectedId === w.id ? "bg-sky-500/10" : ""
                  }`}
                >
                  <td className="px-3 py-3">
                    <input
                      type="radio"
                      name="unified-sweep-wallet"
                      checked={selectedId === w.id}
                      onChange={() => setSelectedId(w.id)}
                      className="h-4 w-4 accent-sky-500"
                      aria-label={`Select wallet ${w.address}`}
                    />
                  </td>
                  <td className="px-3 py-3 text-xs font-medium capitalize text-white/70">{w.environment}</td>
                  <td className="px-3 py-3 text-xs text-white/75">
                    <span className="font-medium text-white/85">{w.sweep_label}</span>
                    <span className="mt-0.5 block font-mono text-[10px] text-white/35">{w.sweep_kind}</span>
                  </td>
                  <td className="px-3 py-3 text-xs">
                    {w.sweep_configured ? (
                      <span className="text-emerald-200/90">Ready</span>
                    ) : (
                      <span className="text-amber-200/90" title={w.master_env ?? ""}>
                        Set {w.master_env ?? "env"}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 font-mono text-xs text-white/65">
                    {w.currency} · {w.network}
                    <span className="mt-0.5 block text-[10px] text-white/35">chain {w.chain}</span>
                  </td>
                  <td className="px-3 py-3 font-mono text-xs text-white/85 break-all">{w.address}</td>
                  <td className="px-3 py-3 font-mono text-white/60">{w.derivation_index}</td>
                  <td className="px-3 py-3 text-white/70">{w.external_user_id}</td>
                  <td className="px-3 py-3 text-white/60">{w.merchant_label}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {(sweepOneMut.isError || sweepAllMut.isError) && (
        <p className="mt-4 text-sm text-rose-300/90">
          {sweepOneMut.error?.message || sweepAllMut.error?.message || "Request failed"}
        </p>
      )}

      <ConfirmModal
        open={confirmOne}
        title="Sweep selected wallet?"
        danger
        confirmLabel="Sweep now"
        isLoading={sweepOneMut.isPending}
        onCancel={() => !sweepOneMut.isPending && setConfirmOne(false)}
        onConfirm={() => {
          if (!selectedId) return;
          sweepOneMut.mutate(selectedId, {
            onSettled: () => {
              setConfirmOne(false);
            },
          });
        }}
      >
        {selectedRow?.sweep_configured ? (
          <>
            Rail <span className="font-mono text-white/85">{selectedRow.sweep_label}</span> — funds go to the master you
            configured (<span className="font-mono text-white/70">{selectedRow.master_env}</span>). Ensure fee balances
            on-chain (e.g. TRX for TRC20, ETH/BNB for ERC20/BEP20, SOL for SPL) where applicable.
          </>
        ) : (
          <>This rail is not configured.</>
        )}
      </ConfirmModal>

      <ConfirmModal
        open={confirmAll}
        title="Sweep all rails?"
        danger
        confirmLabel="Sweep all"
        isLoading={sweepAllMut.isPending}
        onCancel={() => !sweepAllMut.isPending && setConfirmAll(false)}
        onConfirm={() => {
          sweepAllMut.mutate(undefined, {
            onSettled: () => {
              setConfirmAll(false);
            },
          });
        }}
      >
        Runs every configured consolidate sweep in sequence (TRON USDT, TRX, Ethereum USDT, BNB USDT, Solana USDT).
        Rails without a master address in <span className="font-mono">.env</span> are skipped entirely; individual
        wallets may still skip (zero balance) or fail (fees).
      </ConfirmModal>
    </div>
  );
}
