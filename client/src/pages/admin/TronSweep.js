import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api";
import ConfirmModal from "../../components/ConfirmModal";

export default function AdminTronSweep() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState(null);
  const [confirmOne, setConfirmOne] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const [lastBatch, setLastBatch] = useState(null);
  const [lastOne, setLastOne] = useState(null);

  const targets = useQuery({
    queryKey: ["admin-tron-sweep-targets"],
    queryFn: () => api("/api/v1/admin/tron-sweep/targets"),
  });

  const sweepOneMut = useMutation({
    mutationFn: (walletId) =>
      api("/api/v1/admin/tron-sweep/one", {
        method: "POST",
        json: { wallet_id: walletId },
      }),
    onSuccess: (data) => {
      setLastOne(data);
      void qc.invalidateQueries({ queryKey: ["admin-tron-sweep-targets"] });
    },
  });

  const sweepAllMut = useMutation({
    mutationFn: () => api("/api/v1/admin/tron-sweep/all", { method: "POST", json: {} }),
    onSuccess: (data) => {
      setLastBatch(data);
      void qc.invalidateQueries({ queryKey: ["admin-tron-sweep-targets"] });
    },
  });

  const data = targets.data;
  const wallets = data?.wallets ?? [];
  const configured = Boolean(data?.configured);

  return (
    <div className="w-full">
      <h1 className="font-display text-2xl font-semibold text-white">TRON USDT sweep</h1>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-white/55">
        Move <span className="font-mono text-white/80">USDT · TRC20</span> deposit balances (underlying chain in DB is{" "}
        <span className="font-mono text-white/70">TRON</span>; <span className="font-mono">currency</span> = USDT,{" "}
        <span className="font-mono">network</span> = TRC20) to your main address (
        <span className="font-mono text-sky-200/90">SWEEP_MASTER_TRON</span>). Each deposit address needs enough{" "}
        <span className="text-white/75">TRX</span> for network fees (typically ~12+ TRX per sweep if the account has no
        staked energy). <span className="text-white/45">Sandbox and live wallets both appear here.</span>
      </p>

      {!targets.isLoading && !configured ? (
        <div className="mt-6 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100/95">
          <p className="font-medium text-white">Sweep is not configured</p>
          <p className="mt-1 text-white/70">
            Set <span className="font-mono text-amber-100/90">SWEEP_MASTER_TRON</span> in the server{" "}
            <span className="font-mono">.env</span> to your Trust (or cold) TRON receive address, then restart the API.
          </p>
        </div>
      ) : null}

      {configured ? (
        <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/70">
          <span className="text-white/45">Master (destination): </span>
          <span className="break-all font-mono text-sky-200/90">{data.master_tron_address}</span>
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!configured || !selectedId || sweepOneMut.isPending || sweepAllMut.isPending}
          onClick={() => setConfirmOne(true)}
          className="rounded-xl border border-white/15 px-4 py-2.5 text-sm font-medium text-white/90 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Sweep selected wallet
        </button>
        <button
          type="button"
          disabled={!configured || sweepAllMut.isPending || sweepOneMut.isPending || wallets.length === 0}
          onClick={() => setConfirmAll(true)}
          className="rounded-xl bg-rose-600/90 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Sweep all wallets
        </button>
        {targets.isFetching ? (
          <span className="text-xs text-white/40">Refreshing…</span>
        ) : null}
      </div>

      {lastOne ? (
        <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/75">
          <p className="font-medium text-white">Last single sweep</p>
          {lastOne.skipped ? (
            <p className="mt-1 text-white/60">Skipped: {lastOne.reason}</p>
          ) : (
            <p className="mt-1 break-all font-mono text-xs text-emerald-200/90">
              Tx {lastOne.tx_hash} · amount (atomic) {lastOne.amount_atomic}
            </p>
          )}
        </div>
      ) : null}

      {lastBatch?.summary ? (
        <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/75">
          <p className="font-medium text-white">Last batch</p>
          <p className="mt-1 text-white/60">
            Attempted {lastBatch.summary.attempted} · swept {lastBatch.summary.ok} · skipped{" "}
            {lastBatch.summary.skipped} · failed {lastBatch.summary.failed}
          </p>
        </div>
      ) : null}

      <div className="mt-8 overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.03]">
        <table className="w-full min-w-[900px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-white/10 text-xs font-medium tracking-wide text-white/45 uppercase">
              <th className="px-4 py-3 w-10" />
              <th className="px-4 py-3">Env</th>
              <th className="px-4 py-3">Rail</th>
              <th className="px-4 py-3">Deposit address</th>
              <th className="px-4 py-3">Derivation</th>
              <th className="px-4 py-3">External user</th>
              <th className="px-4 py-3">Merchant</th>
            </tr>
          </thead>
          <tbody>
            {targets.isLoading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-white/45">
                  Loading…
                </td>
              </tr>
            ) : wallets.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-white/45">
                  No <span className="font-mono text-white/55">chain=TRON, currency=USDT, network=TRC20</span> wallets.
                  If you expected rows, run{" "}
                  <span className="font-mono text-white/60">
                    SELECT chain, currency, network FROM wallets;
                  </span>{" "}
                  — values must match exactly (gateway stores USDT / TRC20 and enum{" "}
                  <span className="font-mono">TRON</span>).
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
                  <td className="px-4 py-3">
                    <input
                      type="radio"
                      name="sweep-wallet"
                      checked={selectedId === w.id}
                      onChange={() => setSelectedId(w.id)}
                      className="h-4 w-4 accent-sky-500"
                      aria-label={`Select wallet ${w.address}`}
                    />
                  </td>
                  <td className="px-4 py-3 text-xs font-medium capitalize text-white/70">{w.environment}</td>
                  <td className="px-4 py-3 font-mono text-xs text-white/65">
                    {w.currency} · {w.network}
                    <span className="mt-0.5 block text-[10px] text-white/35">chain {w.chain}</span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-white/85 break-all">{w.address}</td>
                  <td className="px-4 py-3 font-mono text-white/60">{w.derivation_index}</td>
                  <td className="px-4 py-3 text-white/70">{w.external_user_id}</td>
                  <td className="px-4 py-3 text-white/60">{w.merchant_label}</td>
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
        USDT on this deposit address (minus fees) will be sent to{" "}
        <span className="font-mono text-white/85">{data?.master_tron_address}</span>. Ensure this address has TRX for
        fees.
      </ConfirmModal>

      <ConfirmModal
        open={confirmAll}
        title="Sweep all live USDT TRC20 wallets?"
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
        Every listed wallet will be processed in order. Wallets with zero USDT will be skipped. Wallets without enough
        TRX will fail for that row only.
      </ConfirmModal>
    </div>
  );
}
