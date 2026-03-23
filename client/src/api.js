const TOKEN_KEY = "cpg_token";

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
    throw new Error(err?.error ?? err?.detail ?? res.statusText);
  }
  return data;
}
