const TOKEN_KEY = "cpg_token";
/** Saved while an admin uses “Log in as merchant”; restored on “Back to admin”. */
const IMPERSONATION_ADMIN_TOKEN_KEY = "cpg_impersonation_admin_token";

const API_BASE = String(import.meta.env.VITE_API_ORIGIN ?? "").replace(/\/$/, "");

function apiUrl(path) {
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

export async function api(path, init) {
  const headers = {
    ...(init?.headers && typeof init.headers === "object" ? init.headers : {}),
  };
  if (init?.json !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const tok = getToken();
  if (tok) headers["Authorization"] = `Bearer ${tok}`;
  const res = await fetch(apiUrl(path), {
    ...init,
    headers,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = data;
    if (res.status === 401 && err?.error === "account_deactivated") {
      setToken(null);
      const p = String(path);
      if (typeof window !== "undefined" && !p.includes("/auth/login")) {
        window.location.assign("/login");
      }
    }
    const msg =
      typeof err?.message === "string" && err.message.trim()
        ? err.message.trim()
        : null;
    throw new Error(msg ?? err?.error ?? err?.detail ?? res.statusText);
  }
  return data;
}
