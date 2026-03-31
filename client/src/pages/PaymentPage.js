import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import QRCode from "react-qr-code";
import { apiUrl } from "../api";
import { BrandMark } from "../components/BrandMark.js";

/**
 * @param {number} totalSec
 * @returns {string}
 */
function formatCountdown(totalSec) {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function PaymentPage() {
  const { token } = useParams();
  const [session, setSession] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [remainSec, setRemainSec] = useState(null);
  const [copyState, setCopyState] = useState("idle");
  const [paidNoReturnUrl, setPaidNoReturnUrl] = useState(false);
  const didRedirect = useRef(false);
  const redirectUrlRef = useRef(null);

  const assignRedirect = useCallback((url) => {
    if (!url || didRedirect.current) return;
    try {
      window.location.assign(url);
      didRedirect.current = true;
    } catch {
      /* allow poll to retry if navigation was blocked */
    }
  }, []);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      setLoadError("Missing payment link.");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          apiUrl(`/api/v1/gateway/payment-session/${encodeURIComponent(token)}`),
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            typeof data?.error === "string" ? data.error : "Could not load payment details.",
          );
        }
        if (!cancelled) setSession(data);
      } catch (e) {
        if (!cancelled) setLoadError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const expiresAt = session?.deposit_scan_expires_at ?? null;
  const redirectUrl =
    typeof session?.redirect_url === "string" && session.redirect_url.trim()
      ? session.redirect_url.trim()
      : null;
  redirectUrlRef.current = redirectUrl;

  useEffect(() => {
    if (!expiresAt) {
      setRemainSec(null);
      return;
    }
    const tick = () => {
      const end = new Date(expiresAt).getTime();
      setRemainSec(Math.max(0, Math.floor((end - Date.now()) / 1000)));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  useEffect(() => {
    if (!token || !session || paidNoReturnUrl) return;
    let cancelled = false;
    async function check() {
      try {
        const res = await fetch(
          apiUrl(`/api/v1/gateway/payment-session/${encodeURIComponent(token)}/poll`),
        );
        if (!res.ok) return;
        const data = await res.json().catch(() => ({}));
        if (cancelled || didRedirect.current) return;
        if (!data?.has_successful_deposit) return;
        const url = redirectUrlRef.current;
        if (url) assignRedirect(url);
        else setPaidNoReturnUrl(true);
      } catch {
        /* ignore transient errors */
      }
    }
    const id = setInterval(check, 2000);
    check();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [token, session, assignRedirect, paidNoReturnUrl]);

  const ttlNote = useMemo(() => {
    const m = session?.deposit_scan_ttl_minutes;
    if (typeof m !== "number" || m <= 0) return null;
    return m;
  }, [session?.deposit_scan_ttl_minutes]);

  const showTimer = expiresAt != null && ttlNote != null;
  const timerDone = showTimer && remainSec !== null && remainSec <= 0;

  useEffect(() => {
    if (!redirectUrl || !timerDone) return;
    assignRedirect(redirectUrl);
  }, [redirectUrl, timerDone, assignRedirect]);

  const onCopy = useCallback(async () => {
    if (!session?.address) return;
    try {
      await navigator.clipboard.writeText(session.address);
      setCopyState("ok");
      setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("fail");
      setTimeout(() => setCopyState("idle"), 2500);
    }
  }, [session?.address]);

  if (loading) {
    return (
      <div className="mesh-bg flex min-h-screen items-center justify-center px-4">
        <p className="text-sm text-white/55">Loading payment details…</p>
      </div>
    );
  }

  if (loadError || !session) {
    return (
      <div className="mesh-bg flex min-h-screen items-center justify-center px-4">
        <div className="glass max-w-md rounded-2xl p-8 text-center">
          <h1 className="font-display text-lg font-semibold text-white">Link unavailable</h1>
          <p className="mt-2 text-sm text-white/55">
            {loadError ?? "This payment link is invalid or has expired."}
          </p>
        </div>
      </div>
    );
  }

  const { address, chain, currency, network } = session;

  return (
    <div className="mesh-bg flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="glass w-full max-w-lg rounded-2xl p-6 sm:p-8">
        {paidNoReturnUrl && (
          <div className="mb-4 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-center">
            <p className="text-sm font-medium text-emerald-100/95">Payment received</p>
            <p className="mt-1 text-xs text-white/55">
              This checkout had no return URL. You can close this page.
            </p>
          </div>
        )}
        {!redirectUrl && !paidNoReturnUrl && (
          <p className="mb-4 rounded-xl border border-amber-400/25 bg-amber-500/8 px-3 py-2 text-center text-xs text-amber-100/85">
            No return URL was provided for this link, so you will not be redirected automatically after
            payment.
          </p>
        )}
        <div className="text-center">
          <div className="mb-5 flex justify-center">
            <BrandMark variant="full" className="mx-auto max-h-9 max-w-[200px]" />
          </div>
          <p className="font-display text-[10px] font-bold tracking-[0.2em] text-white/45 uppercase">
            Send {currency}
          </p>
          <p className="mt-1 text-sm text-white/50">
            {network} · {chain}
          </p>
        </div>

        {showTimer && (
          <div
            className={`mt-6 rounded-xl border px-4 py-3 text-center ${
              timerDone
                ? "border-amber-500/30 bg-amber-500/10"
                : "border-white/10 bg-white/[0.04]"
            }`}
          >
            <p className="text-[10px] font-semibold tracking-wide text-white/40 uppercase">
              Deposit scan window
            </p>
            {timerDone ? (
              <p className="mt-1 text-sm text-amber-100/90">
                {redirectUrl
                  ? "Redirecting…"
                  : "This window has ended. If you already sent funds, contact the merchant."}
              </p>
            ) : (
              <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-white">
                {remainSec != null ? formatCountdown(remainSec) : "—"}
              </p>
            )}
          </div>
        )}

        <div className="mt-6 flex flex-col items-center gap-4">
          <p className="w-full break-all text-center font-mono text-sm leading-relaxed text-white/85">
            {address}
          </p>
          <button
            type="button"
            onClick={onCopy}
            className="rounded-xl border border-white/15 bg-white/10 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/25"
          >
            {copyState === "ok" ? "Copied" : copyState === "fail" ? "Copy failed" : "Copy address"}
          </button>
          <div className="rounded-2xl border border-white/10 bg-white p-3">
            <QRCode value={address} size={200} level="M" />
          </div>
        </div>

        <p className="mt-8 text-center text-xs text-white/35">
          Send only {currency} on {network}. Wrong asset or network may result in loss of funds.
        </p>
      </div>
    </div>
  );
}
