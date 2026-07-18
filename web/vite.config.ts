import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Review Server target URL for dev proxy.
 *
 * The Vite dev server proxies all /api requests to the local Review Server.
 * The Review Server validates both the Host header and the Origin header
 * (for mutating requests) against its bound address and port.
 *
 * `changeOrigin: true` rewrites the Host header to the target, but does NOT
 * rewrite the Origin header. We use a `configure` callback to set the
 * Origin header to match the Review Server's expected origin, so that
 * POST/PUT/PATCH requests from the Vite dev server pass origin validation.
 */
const REVIEW_SERVER_TARGET = "http://127.0.0.1:3210";

export default defineConfig({
  plugins: [react()],
  root: "web",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // Proxy API requests to the local review server during development
    proxy: {
      "/api": {
        target: REVIEW_SERVER_TARGET,
        changeOrigin: true,
        configure: (proxy) => {
          // Rewrite the Origin header to match the Review Server's expected
          // origin. Without this, POST/PUT/PATCH requests from the Vite dev
          // server (e.g., http://127.0.0.1:5173) would be rejected with
          // `origin_rejected` because the Review Server's origin validation
          // requires an exact match against its bound address and port.
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.setHeader("Origin", REVIEW_SERVER_TARGET);
          });
        },
      },
    },
  },
});
