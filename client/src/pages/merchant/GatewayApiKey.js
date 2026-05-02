import { useEffect, useState } from "react";
import { api } from "../../api";
import ConfirmModal from "../../components/ConfirmModal.js";
import { BrandLoader } from "../../components/BrandLoader.js";

/** Hidden state — password-style mask. */
const API_KEY_MASK = "***** ***** ***** *****";

function EyeIcon({ className }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className={className}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
      />
    </svg>
  );
}

function EyeSlashIcon({ className }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className={className}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"
      />
    </svg>
  );
}

export default function GatewayApiKey() {
  const [apiKeyInfo, setApiKeyInfo] = useState(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [copyState, setCopyState] = useState("idle");
  const [confirmRegenOpen, setConfirmRegenOpen] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api("/api/v1/auth/me")
      .then((u) => {
        if (cancelled) return;
        const secret =
          typeof u.apiKey === "string" && u.apiKey.trim()
            ? u.apiKey.trim()
            : null;
        const hint =
          typeof u.apiKeyHint === "string" && u.apiKeyHint.trim()
            ? u.apiKeyHint.trim()
            : null;
        const cipherPresent = u.api_key_cipher_present === true;
        setApiKeyInfo({ secret, hint, cipherPresent });
      })
      .catch(() => {
        if (!cancelled) setApiKeyInfo({ secret: null, hint: null, cipherPresent: false });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <BrandLoader
        variant="section"
        title=""
        subtitle="Loading API key…"
        aria-label="Loading API key"
      />
    );
  }

  const keyRow = apiKeyInfo ?? { secret: null, hint: null, cipherPresent: false };
  const canCopyFullKey = Boolean(keyRow.secret);
  const apiKeyDisplayed = showApiKey
    ? (keyRow.secret ?? (keyRow.hint ? `****************${keyRow.hint}` : "—"))
    : API_KEY_MASK;

  async function copyFullKey() {
    if (!keyRow.secret) return;
    try {
      await navigator.clipboard.writeText(keyRow.secret);
      setCopyState("ok");
      setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("err");
      setTimeout(() => setCopyState("idle"), 2500);
    }
  }

  async function confirmRegenerate() {
    setRegenError(null);
    setRegenerating(true);
    try {
      const data = await api("/api/v1/merchant/gateway-api-key/regenerate", {
        method: "POST",
        json: {},
      });
      const secret =
        typeof data?.api_key === "string" && data.api_key.trim()
          ? data.api_key.trim()
          : null;
      const hint =
        typeof data?.api_key_hint === "string" && data.api_key_hint.trim()
          ? data.api_key_hint.trim()
          : null;
      setApiKeyInfo({
        secret,
        hint,
        cipherPresent: Boolean(secret),
      });
      setShowApiKey(true);
      setConfirmRegenOpen(false);
    } catch (e) {
      setRegenError(String(e).replace(/^Error:\s*/, "") || "Could not regenerate.");
    } finally {
      setRegenerating(false);
    }
  }

  const btnBase =
    "flex shrink-0 items-center justify-center rounded-lg border border-white/10 bg-black/30 px-3 text-sm font-medium transition";

  return (
    <div className="w-full">
      <ConfirmModal
        open={confirmRegenOpen}
        title="Regenerate API key?"
        danger
        confirmLabel={regenerating ? "Regenerating…" : "Regenerate"}
        cancelLabel="Cancel"
        isLoading={regenerating}
        onCancel={() => !regenerating && setConfirmRegenOpen(false)}
        onConfirm={confirmRegenerate}
      >
        <p>
          Your current key will stop working immediately for live and sandbox gateway calls. Update every server
          and secret store with the new key before continuing traffic.
        </p>
      </ConfirmModal>

      <h1 className="font-display text-2xl font-semibold text-white">API key</h1>

      <div className="glass mt-8 w-full rounded-2xl p-6 lg:p-8">
        <label
          className="text-xs text-white/50"
          htmlFor="merchant-gateway-api-key-display"
        >
          Gateway API key
        </label>
        <p className="mt-1 text-xs text-white/35">
          Do not expose in browsers or mobile apps. If it leaks, regenerate here or ask an admin (Edit merchant).
        </p>
        <div className="mt-2 flex flex-wrap items-stretch gap-2">
          <div
            id="merchant-gateway-api-key-display"
            className="min-h-[42px] min-w-0 flex-1 select-all rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-white/70 break-all content-center"
          >
            {apiKeyDisplayed}
          </div>
          <button
            type="button"
            onClick={() => setShowApiKey((v) => !v)}
            className={`${btnBase} w-11 text-white/55 hover:border-white/20 hover:bg-white/5 hover:text-white`}
            aria-label={showApiKey ? "Hide API key" : "Show API key"}
            title={showApiKey ? "Hide" : "Show"}
          >
            {showApiKey ? (
              <EyeSlashIcon className="h-5 w-5" />
            ) : (
              <EyeIcon className="h-5 w-5" />
            )}
          </button>
          <button
            type="button"
            onClick={copyFullKey}
            disabled={!canCopyFullKey}
            className={`${btnBase} text-white/80 hover:border-white/20 hover:bg-white/5 disabled:cursor-not-allowed disabled:border-white/5 disabled:text-white/25`}
            title={
              canCopyFullKey
                ? "Copy full key to clipboard"
                : "Full key is not available until an admin saves an encrypted copy (regenerate once)"
            }
          >
            {copyState === "ok" ? "Copied" : copyState === "err" ? "Failed" : "Copy"}
          </button>
          <button
            type="button"
            onClick={() => {
              setRegenError(null);
              setConfirmRegenOpen(true);
            }}
            className={`${btnBase} border-rose-500/30 bg-rose-950/25 text-rose-100/90 hover:border-rose-400/40 hover:bg-rose-950/40`}
          >
            Regenerate
          </button>
        </div>
        {regenError ? (
          <p className="mt-2 text-xs text-rose-300/90">{regenError}</p>
        ) : null}
        {showApiKey && !keyRow.secret && keyRow.hint && !keyRow.cipherPresent ? (
          <p className="mt-2 text-xs text-amber-200/80">
            This account still has only a hash + hint from before encrypted storage. The full secret cannot be
            recovered. Ask an admin to open <span className="font-medium text-white/80">Edit merchant</span>{" "}
            and use <span className="font-medium text-white/80">Regenerate API key</span> once — after that the
            full key is stored encrypted and you can show and copy it here.
          </p>
        ) : null}
        {showApiKey && !keyRow.secret && keyRow.hint && keyRow.cipherPresent ? (
          <p className="mt-2 text-xs text-amber-200/80">
            Encrypted key is on file but could not be decrypted (server key/config). Contact support.
          </p>
        ) : null}
        {showApiKey && !keyRow.secret && !keyRow.hint ? (
          <p className="mt-2 text-xs text-amber-200/80">
            No API key on file. Ask an admin to create or regenerate a gateway API key.
          </p>
        ) : null}
      </div>
    </div>
  );
}
