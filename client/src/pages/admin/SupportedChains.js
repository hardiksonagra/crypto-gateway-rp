import { Formik, Form, Field } from "formik";
import * as Yup from "yup";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { BrandLoader } from "../../components/BrandLoader.js";

const card =
  "flex flex-col gap-2 rounded-xl border border-white/10 bg-black/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between";

/**
 * @typedef {{ chain: string, label: string, hint: string, active: boolean }} ChainRow
 */

/**
 * @param {string[]} chainIds
 */
function validationSchemaForChains(chainIds) {
  const shape = {};
  for (const id of chainIds) {
    shape[id] = Yup.boolean();
  }
  return Yup.object(shape);
}

/**
 * @param {Record<string, unknown>} values
 * @param {ChainRow[]} chainsList
 */
function validateAtLeastOneChain(values, chainsList) {
  if (!chainsList?.length) return {};
  if (!chainsList.some((c) => values[c.chain] === true)) {
    return { _form: "At least one chain must stay active." };
  }
  return {};
}

export default function SupportedChains() {
  const [chains, setChains] = useState(/** @type {ChainRow[] | null} */ (null));
  const [loadError, setLoadError] = useState(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const r = await api("/api/v1/admin/supported-chains");
      setChains(r.chains ?? []);
    } catch (e) {
      setLoadError(String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const initialValues = useMemo(() => {
    if (!chains?.length) return {};
    return Object.fromEntries(chains.map((c) => [c.chain, c.active]));
  }, [chains]);

  const validationSchema = useMemo(() => {
    if (!chains?.length) return Yup.object({});
    return validationSchemaForChains(chains.map((c) => c.chain));
  }, [chains]);

  if (loadError) {
    return (
      <div className="w-full max-w-none">
        <h1
          className="font-display text-2xl font-bold"
          style={{ color: "var(--text-1)" }}
        >
          Supported chains
        </h1>
        <p className="mt-4 text-sm text-rose-400">{loadError}</p>
      </div>
    );
  }

  if (!chains) {
    return (
      <div className="w-full max-w-none">
        <h1
          className="font-display text-2xl font-bold"
          style={{ color: "var(--text-1)" }}
        >
          Supported chains
        </h1>
        <BrandLoader
          variant="section"
          title=""
          subtitle="Loading…"
          className="mt-4"
          aria-label="Loading supported chains"
        />
      </div>
    );
  }

  return (
    <div className="w-full max-w-none">
      <h1 className="font-display text-2xl font-bold" style={{ color: "var(--text-1)" }}>
        Supported chains
      </h1>
      <p className="mt-1 text-sm" style={{ color: "var(--text-2)" }}>
        Turn chains off to stop deposit scanning, gateway deposit addresses, and balance probes on that network.
        Merchants cannot assign rails on disabled chains.
      </p>
      <p className="mt-2 max-w-3xl text-sm text-white/55 text-pretty">
        Changes apply after save. Restart{" "}
        <span className="font-mono text-white/80">
          crypto-gateway-worker-erc20
        </span>{" "}
        /{" "}
        <span className="font-mono text-white/80">
          crypto-gateway-worker-trc20
        </span>{" "}
        and deposit-scan crons so the
        scanner picks up updates immediately.
      </p>

      <div className="glass mt-8 w-full rounded-2xl p-6 lg:p-8">
        <Formik
          enableReinitialize
          initialValues={initialValues}
          validationSchema={validationSchema}
          validate={(values) => validateAtLeastOneChain(values, chains)}
          validateOnBlur
          validateOnChange={false}
          onSubmit={async (values, { setStatus, setSubmitting }) => {
            setStatus(undefined);
            try {
              const payload = Object.fromEntries(
                chains.map((c) => [c.chain, Boolean(values[c.chain])]),
              );
              const r = await api("/api/v1/admin/supported-chains", {
                method: "PUT",
                json: payload,
              });
              setChains(r.chains ?? chains);
            } catch (e) {
              setStatus(String(e));
            } finally {
              setSubmitting(false);
            }
          }}
        >
          {({ isSubmitting, status, errors }) => (
            <Form className="space-y-6">
              {errors._form ? (
                <p className="text-sm text-rose-400" role="alert">
                  {errors._form}
                </p>
              ) : null}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {chains.map((c) => (
                  <div key={c.chain} className={card}>
                    <div>
                      <p className="text-sm font-semibold text-white" id={`${c.chain}-label`}>
                        {c.label}{" "}
                        <span className="font-mono text-xs font-normal text-white/50">({c.chain})</span>
                      </p>
                      <p className="mt-0.5 text-xs text-white/45">{c.hint}</p>
                    </div>
                    <label className="flex cursor-pointer items-center gap-2 sm:shrink-0">
                      <span className="text-xs text-white/50">Active</span>
                      <Field
                        aria-labelledby={`${c.chain}-label`}
                        name={c.chain}
                        type="checkbox"
                        className="h-4 w-4 rounded border border-white/20 bg-black/40 text-indigo-500 focus:ring-indigo-400/40"
                      />
                    </label>
                  </div>
                ))}
              </div>

              {status ? (
                <p className="text-sm text-rose-400" role="alert">
                  {status}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-3 lg:col-span-2">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="rounded-lg bg-white/90 px-4 py-2 text-sm font-medium text-black hover:bg-white disabled:opacity-50"
                >
                  {isSubmitting ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => void load()}
                  className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/80 hover:bg-white/5"
                >
                  Reload
                </button>
              </div>
            </Form>
          )}
        </Formik>
      </div>
    </div>
  );
}
