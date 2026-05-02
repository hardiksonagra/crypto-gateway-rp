import { Link } from "react-router-dom";
import { BrandLoader } from "./BrandLoader.js";

/**
 * Early-return UI for merchant shell pages: session loading, /auth/me failure,
 * gateways off, or portal environment (live/sandbox) incompatible with enabled gateways.
 *
 * @param {{
 *   pageTitle: string,
 *   loaderSubtitle: string,
 *   flagsLoading: boolean,
 *   authMeIsError: boolean,
 *   authMeError: unknown,
 *   liveGatewayEnabled: boolean,
 *   sandboxGatewayEnabled: boolean,
 *   needsPortalSwitch: boolean,
 *   environment: "live" | "sandbox",
 *   merchantApiReady: boolean,
 *   portalListAccess: boolean | undefined,
 *   portalListDeniedMessage: string | null,
 *   wrongPortalRole: boolean,
 * }} props
 * @returns {import("react").ReactNode | null}
 */
export function renderMerchantPortalBlockers({
  pageTitle,
  loaderSubtitle,
  flagsLoading,
  authMeIsError,
  authMeError,
  liveGatewayEnabled,
  sandboxGatewayEnabled,
  needsPortalSwitch,
  environment,
  merchantApiReady,
  portalListAccess,
  portalListDeniedMessage,
  wrongPortalRole,
}) {
  if (flagsLoading) {
    return (
      <BrandLoader
        variant="page"
        title=""
        subtitle={loaderSubtitle}
        aria-label={loaderSubtitle}
      />
    );
  }

  if (authMeIsError) {
    const msg =
      authMeError instanceof Error
        ? authMeError.message
        : String(authMeError ?? "Could not load your account.");
    return (
      <div>
        <h1 className="font-display text-2xl font-semibold text-white">{pageTitle}</h1>
        <p className="mt-4 text-sm text-rose-200/90">{msg}</p>
      </div>
    );
  }

  if (!liveGatewayEnabled && !sandboxGatewayEnabled) {
    return (
      <div>
        <h1 className="font-display text-2xl font-semibold text-white">{pageTitle}</h1>
        <p className="mt-4 text-sm text-rose-200/90">
          Neither live nor sandbox gateway is enabled for your account. Contact support.
        </p>
      </div>
    );
  }

  if (needsPortalSwitch) {
    const target = environment === "sandbox" ? "live" : "sandbox";
    return (
      <div>
        <h1 className="font-display text-2xl font-semibold text-white">{pageTitle}</h1>
        <p className="mt-4 max-w-xl text-sm text-white/70">
          Your portal is set to <strong className="text-white/90">{environment}</strong>, but that
          gateway is disabled for your account.
        </p>
        <p className="mt-3 text-sm text-white/55">
          Open{" "}
          <Link
            to="/profile"
            className="text-sky-300/90 underline decoration-white/25 underline-offset-2 hover:decoration-sky-300/60"
          >
            Profile
          </Link>{" "}
          and switch to <strong className="text-white/80">{target}</strong>, or ask an admin to enable
          the {environment} gateway.
        </p>
      </div>
    );
  }

  if (portalListAccess === false) {
    const msg =
      portalListDeniedMessage ||
      "The merchant portal cannot load data for your current settings. Open Profile to adjust live/sandbox, or contact support.";
    return (
      <div>
        <h1 className="font-display text-2xl font-semibold text-white">{pageTitle}</h1>
        <p className="mt-4 max-w-xl text-sm text-rose-200/90">{msg}</p>
      </div>
    );
  }

  if (wrongPortalRole) {
    return (
      <BrandLoader
        variant="page"
        title=""
        subtitle="Redirecting…"
        aria-label="Redirecting"
      />
    );
  }

  if (!merchantApiReady) {
    return (
      <div>
        <h1 className="font-display text-2xl font-semibold text-white">{pageTitle}</h1>
        <p className="mt-4 text-sm text-rose-200/90">
          Session could not be loaded. Try refreshing the page or sign out and sign in again.
        </p>
      </div>
    );
  }

  return null;
}
