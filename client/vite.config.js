import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import viteCompression from "vite-plugin-compression";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const monorepoRoot = path.resolve(__dirname, "..");

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, monorepoRoot, "");
  const apiPort = env.PORT?.trim() || "3000";
  const target = `http://127.0.0.1:${apiPort}`;
  /**
   * Empty = browser uses same origin as the page (`/api/...`).
   * In dev, Vite proxies `/api` → `PORT` (see `server` below), so do **not** default to
   * `http://localhost:${PORT}` — that bypasses the proxy and breaks when port 3000 serves
   * something other than the gateway API (e.g. static preview). Set `VITE_API_ORIGIN` in
   * `.env` only when the API is on another absolute URL.
   */
  const viteApiOrigin = (env.VITE_API_ORIGIN?.trim().replace(/\/+$/, "") || "").trim();

  return {
    define: {
      "import.meta.env.VITE_API_ORIGIN": JSON.stringify(viteApiOrigin),
    },
    // Production omits React Babel; parse JSX in `.js` via esbuild before import analysis.
    esbuild: {
      include: /\/src\/.*\.js$/,
      exclude: [],
      loader: "jsx",
      jsx: "automatic",
    },
    plugins: [
      react(),
      tailwindcss(),
      viteCompression({
        algorithm: "gzip",
        ext: ".gz",
        threshold: 1024,
      }),
      viteCompression({
        algorithm: "brotliCompress",
        ext: ".br",
        threshold: 1024,
      }),
    ],
    build: {
      sourcemap: false,
    },
    server: {
      port: 5173,
      proxy: {
        "/api": { target, changeOrigin: true },
        "/health": { target, changeOrigin: true },
      },
    },
  };
});
