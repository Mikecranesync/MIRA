import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import {
  nativeFingerprint,
  packagedBuildMinimum,
} from "./scripts/native-fingerprint.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const packagesRoot = path.resolve(here, "../packages");
const nodeModules = path.resolve(here, "node_modules");

// Dev-browser convenience only: proxy /api → prod so `vite dev` works without
// CORS. The packaged app never uses this — it talks to the Hub via native HTTP
// (see src/api.ts). ADR-0034 trust boundary: no remote content in the shell.
export default defineConfig({
  plugins: [react()],
  // FLM-UI-4000 shared shell (packages/factorylm-*): reached by PATH, not by a
  // dependency. `mira-mobile/package.json` is native-owned for the OTA guard
  // (scripts/ota-guard.mjs NATIVE_PATHS) — adding file: deps there would make
  // every unified-shell change ineligible for over-the-air delivery. Vite
  // resolves these at build time, so the code still lands in the web bundle.
  // React is pinned to THIS app's copy (React 18) so the peer-dependent
  // packages never pull a second React from their own toolchain directories.
  // `@assistant-ui/react` is pinned to THIS app's copy for the same reason as
  // React: the shared package (`@factorylm/ui`) imports it, and resolved from
  // `packages/factorylm-ui/src` it would walk up into the Bun workspace tree
  // (React 19) or into nothing at all on a checkout without `bun install`.
  // ADR-0037 pins one version (0.15.17) across mobile, lab and Hub by convention.
  resolve: {
    dedupe: ["react", "react-dom", "@assistant-ui/react"],
    alias: [
      { find: /^@factorylm\/(theme|interaction|ui)$/, replacement: path.join(packagesRoot, "factorylm-$1", "src", "index.ts") },
      { find: /^@factorylm\/(theme|interaction|ui)\/(.+)$/, replacement: path.join(packagesRoot, "factorylm-$1", "src", "$2") },
      { find: /^@assistant-ui\/react$/, replacement: path.join(nodeModules, "@assistant-ui", "react") },
      { find: /^react$/, replacement: path.join(nodeModules, "react") },
      { find: /^react\/(.+)$/, replacement: path.join(nodeModules, "react", "$1") },
      { find: /^react-dom$/, replacement: path.join(nodeModules, "react-dom") },
      { find: /^react-dom\/(.+)$/, replacement: path.join(nodeModules, "react-dom", "$1") },
    ],
  },
  server: {
    fs: { allow: [path.resolve(here, "..")] },
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
    __FLM_PACKAGED_BUILD_MINIMUM__: JSON.stringify(packagedBuildMinimum()),
  },
  build: { outDir: "dist", sourcemap: false },
});
