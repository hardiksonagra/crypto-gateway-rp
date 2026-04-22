import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { api, getToken, isAuthSessionFailure, isTransientApiFailure } from "../api";
import { BrandLoader } from "./BrandLoader.js";

/**
 * When a valid session exists, keep users off sign-in / forgot-password flows.
 * Password reset from email (`?token=`) is still shown even if a session exists.
 * @param {{ children: import("react").ReactNode }} props
 */
export function AuthEntryGate({ children }) {
  const location = useLocation();
  const resetToken = new URLSearchParams(location.search).get("token")?.trim();
  const allowResetWithLink =
    location.pathname === "/reset-password" && Boolean(resetToken);

  const [phase, setPhase] = useState(() => {
    if (allowResetWithLink) return "anonymous";
    return getToken() ? "checking" : "anonymous";
  });

  useEffect(() => {
    if (allowResetWithLink) {
      setPhase("anonymous");
      return;
    }
    const token = getToken();
    if (!token) {
      setPhase("anonymous");
      return;
    }
    let cancelled = false;
    let timeoutId = 0;

    const run = async () => {
      try {
        const u = await api("/api/v1/auth/me");
        if (cancelled) return;
        if (u?.role === "ADMIN") setPhase("admin");
        else if (u?.role === "MERCHANT") setPhase("merchant");
        else setPhase("anonymous");
      } catch (e) {
        if (cancelled) return;
        if (isTransientApiFailure(e)) {
          timeoutId = window.setTimeout(run, 3000);
          return;
        }
        if (isAuthSessionFailure(e)) {
          setPhase("anonymous");
          return;
        }
        timeoutId = window.setTimeout(run, 5000);
      }
    };

    void run();
    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [allowResetWithLink, location.pathname, location.search]);

  if (allowResetWithLink) {
    return children;
  }

  if (phase === "checking") {
    return (
      <div className="mesh-bg flex min-h-screen items-center justify-center px-4">
        <BrandLoader
          variant="page"
          title=""
          subtitle="Checking your session…"
          aria-label="Checking authentication"
        />
      </div>
    );
  }

  if (phase === "admin") {
    return <Navigate to="/control" replace />;
  }
  if (phase === "merchant") {
    return <Navigate to="/" replace />;
  }

  return children;
}
