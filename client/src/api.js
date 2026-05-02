const TOKEN_KEY = "cpg_token";
/** Saved while an admin uses “Log in as merchant”; restored on “Back to admin”. */
const IMPERSONATION_ADMIN_TOKEN_KEY = "cpg_impersonation_admin_token";
/** Saved while an RP uses “Log in as merchant”; restored on “Back to partner”. */
const IMPERSONATION_RP_TOKEN_KEY = "cpg_impersonation_rp_token";

const API_BASE = String(import.meta.env.VITE_API_ORIGIN ?? "").replace(/\/$/, "");

export function apiUrl(path) {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  if (!API_BASE) return path;
  return `${API_BASE}${path}`;
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(t) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

export function getImpersonationAdminToken() {
  return localStorage.getItem(IMPERSONATION_ADMIN_TOKEN_KEY);
}

/** @param {string | null | undefined} t */
export function setImpersonationAdminToken(t) {
  if (t) localStorage.setItem(IMPERSONATION_ADMIN_TOKEN_KEY, t);
  else localStorage.removeItem(IMPERSONATION_ADMIN_TOKEN_KEY);
}

export function clearImpersonationAdminToken() {
  localStorage.removeItem(IMPERSONATION_ADMIN_TOKEN_KEY);
}

export function getImpersonationRpToken() {
  return localStorage.getItem(IMPERSONATION_RP_TOKEN_KEY);
}

/** @param {string | null | undefined} t */
export function setImpersonationRpToken(t) {
  if (t) localStorage.setItem(IMPERSONATION_RP_TOKEN_KEY, t);
  else localStorage.removeItem(IMPERSONATION_RP_TOKEN_KEY);
}

export function clearImpersonationRpToken() {
  localStorage.removeItem(IMPERSONATION_RP_TOKEN_KEY);
}

/**
 * True when the request never reached JSON (TCP/DNS) or the server signaled overload / maintenance.
 * Used so a brief API outage (e.g. PM2 restart) does not treat the user as signed out.
 * @param {unknown} e
 * @returns {boolean}
 */
export function isTransientApiFailure(e) {
  if (e && typeof e === "object" && "isNetworkError" in e && e.isNetworkError) {
    return true;
  }
  const status =
    e && typeof e === "object" && "status" in e ? Number(/** @type {{ status?: unknown }} */ (e).status) : NaN;
  return (
    status === 408 ||
    status === 425 ||
    status === 429 ||
    (Number.isFinite(status) && status >= 500)
  );
}

/**
 * Definitive portal auth rejection (bad/expired JWT, wrong role, etc.).
 * @param {unknown} e
 * @returns {boolean}
 */
export function isAuthSessionFailure(e) {
  const status =
    e && typeof e === "object" && "status" in e ? Number(/** @type {{ status?: unknown }} */ (e).status) : NaN;
  return status === 401 || status === 403;
}

/**
 * @param {string} text
 * @returns {unknown}
 */
function tryParseJsonResponse(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { error: "invalid_json_response" };
  }
}

export async function api(path, init) {
  const headers = {
    ...(init?.headers && typeof init.headers === "object" ? init.headers : {}),
  };
  if (init?.json !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const tok = getToken();
  if (tok) headers["Authorization"] = `Bearer ${tok}`;
  let res;
  try {
    res = await fetch(apiUrl(path), {
      ...init,
      headers,
      body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
    });
  } catch (cause) {
    const msg =
      cause && typeof cause === "object" && "message" in cause && String(cause.message).trim()
        ? String(cause.message).trim()
        : "Network request failed";
    const out = new Error(msg);
    out.isNetworkError = true;
    throw out;
  }
  const text = await res.text();
  const data = tryParseJsonResponse(text);
  if (!res.ok) {
    const err = data && typeof data === "object" ? data : {};
    if (res.status === 401 && err?.error === "account_deactivated") {
      setToken(null);
      const p = String(path);
      if (typeof window !== "undefined" && !p.includes("/auth/login")) {
        const path = typeof window.location?.pathname === "string" ? window.location.pathname : "";
        const dest = path.startsWith("/control")
          ? "/control/login"
          : path.startsWith("/rp")
            ? "/rp/login"
            : "/login";
        window.location.assign(dest);
      }
    }
    const msg =
      typeof err?.message === "string" && err.message.trim()
        ? err.message.trim()
        : null;
    const out = new Error(msg ?? err?.error ?? err?.detail ?? res.statusText);
    out.status = res.status;
    if (typeof err?.error === "string") out.errorCode = err.error;
    throw out;
  }
  return data;
}

/**
 * Multipart POST (e.g. settlement proof). Do not set Content-Type — browser sets boundary.
 * @param {string} path
 * @param {FormData} formData
 * @param {RequestInit} [init]
 */
export async function apiForm(path, formData, init = {}) {
  const headers = {
    ...(init.headers && typeof init.headers === "object" ? init.headers : {}),
  };
  const tok = getToken();
  if (tok) headers.Authorization = `Bearer ${tok}`;
  let res;
  try {
    res = await fetch(apiUrl(path), {
      ...init,
      method: init.method ?? "POST",
      headers,
      body: formData,
    });
  } catch (cause) {
    const msg =
      cause && typeof cause === "object" && "message" in cause && String(cause.message).trim()
        ? String(cause.message).trim()
        : "Network request failed";
    const out = new Error(msg);
    out.isNetworkError = true;
    throw out;
  }
  const text = await res.text();
  const data = tryParseJsonResponse(text);
  if (!res.ok) {
    const err = data && typeof data === "object" ? data : {};
    const msg =
      typeof err?.message === "string" && err.message.trim()
        ? err.message.trim()
        : null;
    const out = new Error(msg ?? err?.error ?? err?.detail ?? res.statusText);
    out.status = res.status;
    if (typeof err?.error === "string") out.errorCode = err.error;
    throw out;
  }
  return data;
}

/**
 * Authenticated GET returning a Blob (e.g. settlement proof image).
 * @param {string} path
 */
export async function apiBlobGet(path) {
  const headers = {};
  const tok = getToken();
  if (tok) headers.Authorization = `Bearer ${tok}`;
  let res;
  try {
    res = await fetch(apiUrl(path), { headers });
  } catch (cause) {
    const msg =
      cause && typeof cause === "object" && "message" in cause && String(cause.message).trim()
        ? String(cause.message).trim()
        : "Network request failed";
    const out = new Error(msg);
    out.isNetworkError = true;
    throw out;
  }
  if (!res.ok) {
    const text = await res.text();
    let msg = res.statusText;
    const j = tryParseJsonResponse(text);
    if (j && typeof j === "object") {
      if (typeof j.message === "string" && j.message.trim()) msg = j.message.trim();
      else if (typeof j.error === "string") msg = j.error;
    }
    const out = new Error(msg);
    out.status = res.status;
    if (j && typeof j === "object" && typeof j.error === "string") out.errorCode = j.error;
    throw out;
  }
  return res.blob();
}
