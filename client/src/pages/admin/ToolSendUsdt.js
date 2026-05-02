import { Formik, Form, Field, ErrorMessage } from "formik";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiUrl, getToken } from "../../api";
import { usePanelApiPrefix } from "../../hooks/usePanelApiPrefix.js";
import ConfirmModal from "../../components/ConfirmModal";
import {
  toolSendUsdtInitialValues,
  toolSendUsdtSchema,
} from "../../admin/toolSendUsdtSchemas.js";

const input =
  "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-white/20 focus:ring-1";
const label = "mb-1 block text-xs font-medium text-white/60";

/**
 * USDT send tool: Control (`/control/tool-send-usdt`) or Merchant (`/tool-send-usdt`, from-address must be your deposit wallet).
 * Sends the **full on-chain USDT balance** from a gateway deposit wallet (`from_address`) to `to_address` (same rail).
 */
export default function ToolSendUsdt() {
  const { apiPrefix } = usePanelApiPrefix();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(
    /** @type {{ from_address: string, to_address: string } | null} */ (null),
  );
  const [serverResult, setServerResult] = useState(/** @type {unknown} */ (null));

  const sendMut = useMutation({
    mutationFn: async (body) => {
      const tok = getToken();
      const res = await fetch(apiUrl(`${apiPrefix}/tool/send-usdt`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
        },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { error: "bad_response", message: text.slice(0, 400) };
      }
      return { data, httpOk: res.ok };
    },
    onSuccess: ({ data }) => {
      setServerResult(data);
      setConfirmOpen(false);
      setPending(null);
    },
    onError: (e) => {
      setServerResult({
        ok: false,
        error: "request_failed",
        message: e instanceof Error ? e.message : String(e),
      });
      setConfirmOpen(false);
      setPending(null);
    },
  });

  return (
    <div className="w-full">
      <h1 className="font-display text-2xl font-semibold text-white">Send USDT (tool)</h1>

      <div className="glass mt-8 w-full rounded-2xl p-6 lg:p-8">
        <Formik
          initialValues={toolSendUsdtInitialValues}
          validationSchema={toolSendUsdtSchema}
          validateOnBlur
          validateOnChange={false}
          onSubmit={(values, { setSubmitting }) => {
            setServerResult(null);
            setPending({
              from_address: values.from_address.trim(),
              to_address: values.to_address.trim(),
            });
            setConfirmOpen(true);
            setSubmitting(false);
          }}
        >
          {({ isSubmitting }) => (
            <Form className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="lg:col-span-2">
                <label className={label} htmlFor="tool-from">
                  From address (gateway deposit wallet)
                </label>
                <Field id="tool-from" name="from_address" type="text" autoComplete="off" className={input} />
                <ErrorMessage name="from_address" component="p" className="mt-1 text-xs text-rose-400/90" />
              </div>
              <div className="lg:col-span-2">
                <label className={label} htmlFor="tool-to">
                  To address
                </label>
                <Field id="tool-to" name="to_address" type="text" autoComplete="off" className={input} />
                <ErrorMessage name="to_address" component="p" className="mt-1 text-xs text-rose-400/90" />
              </div>
              <div className="flex flex-wrap items-center gap-3 lg:col-span-2">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="rounded-xl bg-rose-600/90 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Review & send
                </button>
              </div>
            </Form>
          )}
        </Formik>
      </div>

      {serverResult ? (
        <div
          className="mt-6 w-full rounded-2xl border border-white/10 p-5 text-sm text-white/80"
          style={{ background: "var(--bg-surface, rgba(255,255,255,0.04))" }}
        >
          <p className="font-medium text-white">Last result</p>
          <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-white/70">
            {JSON.stringify(serverResult, null, 2)}
          </pre>
        </div>
      ) : null}

      <ConfirmModal
        open={confirmOpen}
        title="Send full USDT balance?"
        danger
        confirmLabel="Send on-chain"
        isLoading={sendMut.isPending}
        onCancel={() => {
          if (!sendMut.isPending) {
            setConfirmOpen(false);
            setPending(null);
          }
        }}
        onConfirm={() => {
          if (!pending) return;
          setServerResult(null);
          sendMut.mutate(pending);
        }}
      >
        {pending ? (
          <div className="space-y-2 text-sm text-white/75">
            <p>
              <span className="text-white/50">From</span>{" "}
              <span className="font-mono text-xs break-all text-white/90">{pending.from_address}</span>
            </p>
            <p>
              <span className="text-white/50">To</span>{" "}
              <span className="font-mono text-xs break-all text-white/90">{pending.to_address}</span>
            </p>
            <p className="text-rose-300/90">This cannot be undone. Ensure addresses and chain are correct.</p>
          </div>
        ) : null}
      </ConfirmModal>
    </div>
  );
}
