import { useState } from "react";
import { Formik, Form, Field, ErrorMessage } from "formik";
import * as yup from "yup";
import { decryptGatewayXTokenBrowser } from "../../lib/gatewayXTokenBrowser.js";

const decodeFormSchema = yup.object({
  merchant_api_secret: yup.string().trim().required("Merchant API key is required"),
  x_token: yup.string().trim().required("Encoded string (X-Token) is required"),
});

const initialValues = { merchant_api_secret: "", x_token: "" };

function mapDecryptError(code) {
  if (code === "invalid_base64") return "Invalid base64 — paste the full X-Token string.";
  if (code === "invalid_x_token_blob") return "Blob is too short to be a valid X-Token.";
  if (code === "decrypt_failed")
    return "Decryption failed — wrong API key, corrupted token, or not a gateway X-Token.";
  if (code === "web_crypto_unavailable")
    return "Web Crypto is not available (use HTTPS or localhost).";
  return code || "Something went wrong.";
}

/**
 * @param {string} plain
 * @returns {{ kind: "json"; value: unknown } | { kind: "text"; value: string }}
 */
function parseDecodedPlaintext(plain) {
  try {
    return { kind: "json", value: JSON.parse(plain) };
  } catch {
    return { kind: "text", value: plain };
  }
}

export default function DecodeGatewayData() {
  const [decoded, setDecoded] = useState(
    /** @type {{ kind: "json"; pretty: string } | { kind: "text"; text: string } | null} */ (null),
  );
  const [formError, setFormError] = useState(/** @type {string | null} */ (null));

  return (
    <div className="w-full space-y-6">
      <div>
        <h1 className="font-display text-xl font-bold sm:text-2xl" style={{ color: "var(--text-1)" }}>
          Decode gateway data
        </h1>
      </div>

      <div
        className="w-full rounded-2xl p-4 sm:p-5 lg:p-6"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
      >
        <Formik
          initialValues={initialValues}
          validationSchema={decodeFormSchema}
          onSubmit={async (values, { setSubmitting }) => {
            setFormError(null);
            setDecoded(null);
            try {
              const plain = await decryptGatewayXTokenBrowser(
                values.merchant_api_secret,
                values.x_token,
              );
              const parsed = parseDecodedPlaintext(plain);
              if (parsed.kind === "json") {
                setDecoded({
                  kind: "json",
                  pretty: JSON.stringify(parsed.value, null, 2),
                });
              } else {
                setDecoded({ kind: "text", text: parsed.value });
              }
            } catch (e) {
              const code = e instanceof Error ? e.message : String(e);
              setFormError(mapDecryptError(code));
            } finally {
              setSubmitting(false);
            }
          }}
        >
          {({ isSubmitting }) => (
            <Form className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="lg:col-span-2 space-y-1.5">
                <label
                  htmlFor="decode-merchant-api-secret"
                  className="text-xs font-bold uppercase tracking-wider"
                  style={{ color: "var(--text-3)" }}
                >
                  Merchant gateway API key
                </label>
                <Field
                  id="decode-merchant-api-secret"
                  name="merchant_api_secret"
                  type="password"
                  autoComplete="off"
                  className="w-full rounded-xl border px-3 py-2.5 font-mono text-sm outline-none ring-violet-500/30 focus:ring-2"
                  style={{
                    borderColor: "var(--border)",
                    background: "var(--bg-surface2)",
                    color: "var(--text-1)",
                  }}
                  placeholder="Same secret used to build X-Token (SHA-256 → AES-256-GCM)"
                />
                <ErrorMessage name="merchant_api_secret" component="p" className="text-xs text-red-500" />
              </div>

              <div className="lg:col-span-2 space-y-1.5">
                <label
                  htmlFor="decode-x-token"
                  className="text-xs font-bold uppercase tracking-wider"
                  style={{ color: "var(--text-3)" }}
                >
                  Encoded string (X-Token)
                </label>
                <Field
                  as="textarea"
                  id="decode-x-token"
                  name="x_token"
                  rows={4}
                  className="w-full resize-y rounded-xl border px-3 py-2.5 font-mono text-xs outline-none ring-violet-500/30 focus:ring-2 sm:text-sm"
                  style={{
                    borderColor: "var(--border)",
                    background: "var(--bg-surface2)",
                    color: "var(--text-1)",
                  }}
                  placeholder="Base64( IV || auth tag || ciphertext )"
                />
                <ErrorMessage name="x_token" component="p" className="text-xs text-red-500" />
              </div>

              {formError ? (
                <p className="lg:col-span-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
                  {formError}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-3 lg:col-span-2">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="rounded-xl bg-gradient-to-r from-[#5a6fff] to-[#9b59ff] px-5 py-2.5 text-sm font-semibold text-white shadow-md transition-opacity disabled:opacity-50"
                >
                  {isSubmitting ? "Decoding…" : "Decode"}
                </button>
              </div>
            </Form>
          )}
        </Formik>
      </div>

      {decoded ? (
        <div
          className="w-full rounded-2xl p-4 sm:p-5 lg:p-6"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
        >
          <h2 className="font-display text-base font-bold" style={{ color: "var(--text-1)" }}>
            Decoded payload
          </h2>
          {decoded.kind === "json" ? (
            <pre
              className="mt-3 max-h-[min(70vh,32rem)] overflow-auto rounded-xl border p-3 text-xs leading-relaxed sm:text-sm"
              style={{
                borderColor: "var(--border)",
                background: "var(--bg-surface2)",
                color: "var(--text-1)",
              }}
            >
              {decoded.pretty}
            </pre>
          ) : (
            <>
              <p className="mt-2 text-sm" style={{ color: "var(--text-2)" }}>
                Plaintext is not valid JSON — showing raw UTF-8 string:
              </p>
              <pre
                className="mt-2 max-h-[min(70vh,32rem)] overflow-auto whitespace-pre-wrap break-all rounded-xl border p-3 text-xs leading-relaxed sm:text-sm"
                style={{
                  borderColor: "var(--border)",
                  background: "var(--bg-surface2)",
                  color: "var(--text-1)",
                }}
              >
                {decoded.text}
              </pre>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
