import { useState } from "react";
import { useMerchantPortalEnvironment } from "../hooks/useMerchantPortalEnvironment.js";

const btn =
  "rounded-lg px-3 py-1.5 text-xs font-semibold tracking-wide uppercase transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white/25";
const active = "bg-white/15 text-white";
const inactive = "text-white/45 hover:bg-white/5 hover:text-white/75";
const disabled = "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-white/45";

/**
 * Live / sandbox toggle (Profile). Persists via PATCH /api/v1/merchant/portal-environment.
 */
export default function MerchantPortalEnvBar({ className = "" }) {
  const {
    environment,
    setEnvironment,
    liveGatewayEnabled,
    sandboxGatewayEnabled,
    flagsLoading,
  } = useMerchantPortalEnvironment();
  const [saving, setSaving] = useState(null);
  const [saveError, setSaveError] = useState(null);

  async function pick(next) {
    if (next === environment || saving) return;
    setSaveError(null);
    setSaving(next);
    try {
      await setEnvironment(next);
    } catch (e) {
      setSaveError(String(e?.message ?? e));
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className={className}>
      <div
        className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-black/20 p-1"
        role="group"
        aria-label="Portal data environment"
      >
        <button
          type="button"
          disabled={
            flagsLoading || !liveGatewayEnabled || Boolean(saving)
          }
          className={`${btn} ${environment === "live" ? active : inactive} ${!liveGatewayEnabled ? disabled : ""}`}
          onClick={() => pick("live")}
        >
          {saving === "live" ? "…" : "Live"}
        </button>
        <button
          type="button"
          disabled={
            flagsLoading || !sandboxGatewayEnabled || Boolean(saving)
          }
          className={`${btn} ${environment === "sandbox" ? active : inactive} ${!sandboxGatewayEnabled ? disabled : ""}`}
          onClick={() => pick("sandbox")}
        >
          {saving === "sandbox" ? "…" : "Sandbox"}
        </button>
      </div>
      {saveError ? (
        <p className="mt-2 text-xs text-rose-300/90">{saveError}</p>
      ) : null}
    </div>
  );
}
