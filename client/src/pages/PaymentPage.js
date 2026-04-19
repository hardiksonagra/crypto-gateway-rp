import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import QRCode from "react-qr-code";
import { apiUrl } from "../api";
import { BrandMark } from "../components/BrandMark.js";
import { BrandLoader } from "../components/BrandLoader.js";
import { paymentQrEncodedValue } from "../lib/payment-qr-uri.js";

/**
 * @param {number} totalSec
 * @returns {string}
 */
function formatCountdown(totalSec) {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * @param {unknown} d
 * @returns {d is Record<string, unknown>}
 */
function isValidPaymentSessionPayload(d) {
  if (!d || typeof d !== "object") return false;
  const o = /** @type {Record<string, unknown>} */ (d);
  const addr = typeof o.address === "string" ? o.address.trim() : "";
  const chain = typeof o.chain === "string" ? o.chain.trim() : "";
  const currency = typeof o.currency === "string" ? o.currency.trim() : "";
  const network = typeof o.network === "string" ? o.network.trim() : "";
  return Boolean(addr && chain && currency && network);
}

export default function PaymentPage() {
  const { token } = useParams();
  const [session, setSession] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [remainSec, setRemainSec] = useState(null);
  const [copyState, setCopyState] = useState("idle");
  const [paidNoReturnUrl, setPaidNoReturnUrl] = useState(false);
  const [underpaidNotice, setUnderpaidNotice] = useState(false);
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
          apiUrl(
            `/api/v1/gateway/payment-session/${encodeURIComponent(token)}`,
          ),
        );
        const text = await res.text();
        let data = {};
        if (!res.ok) {
          try {
            data = JSON.parse(text);
          } catch {
            /* ignore */
          }
          throw new Error(
            typeof data?.error === "string"
              ? data.error
              : "Could not load payment details.",
          );
        }
        try {
          data = JSON.parse(text);
        } catch {
          const head = text.trimStart().slice(0, 20).toLowerCase();
          if (head.startsWith("<!doctype") || head.startsWith("<html")) {
            throw new Error(
              "Payment API URL is not configured for this site. Rebuild the client with VITE_API_ORIGIN set to your public API base URL (no trailing slash), e.g. https://api.cryptovapay.com — see docs/split-services.md — then redeploy the portal.",
            );
          }
          throw new Error("Could not load payment details.");
        }
        if (!isValidPaymentSessionPayload(data)) {
          throw new Error(
            "Invalid payment session response. Check that VITE_API_ORIGIN points at the gateway API, not the static portal host.",
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
          apiUrl(
            `/api/v1/gateway/payment-session/${encodeURIComponent(token)}/poll`,
          ),
        );
        if (!res.ok) return;
        const data = await res.json().catch(() => ({}));
        if (cancelled || didRedirect.current) return;
        if (data?.has_successful_deposit) {
          setUnderpaidNotice(false);
          const url = redirectUrlRef.current;
          if (url) assignRedirect(url);
          else setPaidNoReturnUrl(true);
          return;
        }
        if (data?.has_underpaid_deposit) setUnderpaidNotice(true);
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

  const qrPayload = useMemo(() => {
    if (!session || !isValidPaymentSessionPayload(session)) return "";
    return paymentQrEncodedValue({
      address: session.address,
      chain: session.chain,
      currency: session.currency,
      network: session.network,
      expected_amount_atomic: session.expected_amount_atomic,
      expected_amount_decimal: session.expected_amount_decimal,
    });
  }, [session]);

  const qrPrefillsAmount =
    Boolean(session) &&
    isValidPaymentSessionPayload(session) &&
    qrPayload !== String(session.address ?? "").trim();

  if (loading) {
    return (
      <div className="mesh-bg flex min-h-screen items-center justify-center px-4">
        <BrandLoader
          variant="page"
          title=""
          subtitle="Loading payment details…"
          aria-label="Loading payment details"
        />
      </div>
    );
  }

  if (loadError || !session) {
    return (
      <div className="mesh-bg flex min-h-screen items-center justify-center px-4">
        <div className="glass max-w-md rounded-2xl p-8 text-center">
          <h1 className="font-display text-lg font-semibold text-white">
            Link unavailable
          </h1>
          <p className="mt-2 text-sm text-white/55">
            {loadError ?? "This payment link is invalid or has expired."}
          </p>
        </div>
      </div>
    );
  }

  const { address, chain, currency, network } = session;
  const expectedDecimal =
    typeof session?.expected_amount_decimal === "string" &&
    session.expected_amount_decimal.trim()
      ? session.expected_amount_decimal.trim()
      : null;

  return (
    <div className="mesh-bg flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="glass w-full max-w-lg rounded-2xl p-6 sm:p-8">
        {underpaidNotice && !paidNoReturnUrl && (
          <div className="mb-4 rounded-xl border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-center">
            <p className="text-sm font-medium text-rose-100/95">
              Insufficient amount received
            </p>
            <p className="mt-1 text-xs text-white/55">
              Send the remaining {currency} to this same address on {network} so
              the total matches the amount due.
            </p>
          </div>
        )}
        {paidNoReturnUrl && (
          <div className="mb-4 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-center">
            <p className="text-sm font-medium text-emerald-100/95">
              Payment received
            </p>
            <p className="mt-1 text-xs text-white/55">
              This checkout had no return URL. You can close this page.
            </p>
          </div>
        )}
        {!redirectUrl && !paidNoReturnUrl && (
          <p className="mb-4 rounded-xl border border-amber-400/25 bg-amber-500/8 px-3 py-2 text-center text-xs text-amber-100/85">
            No return URL was provided for this link, so you will not be
            redirected automatically after payment.
          </p>
        )}
        <div className="text-center">
          <div className="mb-5 flex justify-center">
            <BrandMark
              variant="full"
              className="mx-auto max-h-[4.5rem] max-w-[400px]"
            />
          </div>
          <p className="font-display text-[10px] font-bold tracking-[0.2em] text-white/45 uppercase">
            Send {currency}
          </p>
          <p className="mt-1 text-sm text-white/50">
            {network} · {chain}
          </p>
          {expectedDecimal != null && (
            <p className="mt-4 rounded-xl border border-sky-400/25 bg-sky-500/10 px-4 py-3 font-sans text-sm font-semibold tracking-wide text-sky-100/95">
              Amount due:{" "}
              <span className="tabular-nums">{expectedDecimal}</span> {currency}
            </p>
          )}
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
            {copyState === "ok"
              ? "Copied"
              : copyState === "fail"
                ? "Copy failed"
                : "Copy address"}
          </button>
          <div className="rounded-2xl border border-white/10 bg-white p-3">
            <QRCode value={qrPayload} size={200} level="M" />
          </div>
        </div>

        <p className="mt-8 text-center text-xs text-white/35">
          Send only {currency} on {network}. Wrong asset or network may result
          in loss of funds.
        </p>
      </div>
    </div>
  );
}
