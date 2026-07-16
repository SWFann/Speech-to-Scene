import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

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
        target: "http://127.0.0.1:3210",
        changeOrigin: true,
      },
    },
  },
});
