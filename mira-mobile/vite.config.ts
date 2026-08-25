import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nativeFingerprint } from "./scripts/native-fingerprint.mjs";

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
  // The native compatibility fingerprint is computed from package.json at BUILD
  // time and baked into the bundle, so it always describes the dependency set
  // that actually produced these assets. A hand-maintained constant would drift
  // the moment someone added a plugin and forgot — and the failure mode of that
  // drift is a bundle accepted onto a shell that cannot run it.
  define: {
    __FLM_NATIVE_FINGERPRINT__: JSON.stringify(nativeFingerprint()),
  },
  build: { outDir: "dist", sourcemap: false },
});
