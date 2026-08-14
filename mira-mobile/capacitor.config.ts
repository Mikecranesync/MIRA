import type { CapacitorConfig } from "@capacitor/cli";

// ADR-0034 trust boundary: static packaged bundle ONLY.
// - NO server.url (never load remote content into the shell)
// - NO allowNavigation (external content opens in the system browser)
// - androidScheme https so the WebView origin is stable/secure
const config: CapacitorConfig = {
  appId: "com.factorylm.mira",
  appName: "FactoryLM",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
  plugins: {
    CapacitorHttp: {
      // JSON/text calls go through CapacitorHttp.request explicitly
      // (src/api/client.ts owns the cookie jar). The fetch patch is enabled
      // ONLY because multipart uploads (notebook source PDFs, nameplate
      // photos) cannot cross the plugin bridge as FormData — the patch is the
      // one path that rebuilds real multipart natively. Upload calls pass the
      // session Cookie header explicitly; nothing else uses window.fetch on
      // native. Trust boundary unchanged: packaged bundle only, no remote UI.
      enabled: true,
    },
  },
};

export default config;
