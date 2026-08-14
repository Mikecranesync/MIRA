import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev-browser convenience only: proxy /api → prod so `vite dev` works without
// CORS. The packaged app never uses this — it talks to the Hub via native HTTP
// (see src/api.ts). ADR-0034 trust boundary: no remote content in the shell.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "https://app.factorylm.com",
        changeOrigin: true,
        cookieDomainRewrite: "localhost",
      },
    },
  },
  build: { outDir: "dist", sourcemap: false },
});
