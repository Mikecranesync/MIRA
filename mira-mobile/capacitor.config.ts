import type { CapacitorConfig } from "@capacitor/cli";

// ADR-0034 trust boundary, as amended 2026-08-24 ("Amendment: signed OTA web bundles"):
// the packaged bundle is the trusted RECOVERY bundle, and the shell may additionally run a
// signed, checksum-verified, native-compatible web bundle fetched from a FactoryLM HTTPS
// endpoint into app-private storage.
// - NO server.url (never point the WebView at a remote origin) — UNCHANGED
// - NO allowNavigation (external content opens in the system browser) — UNCHANGED
// - androidScheme https so the WebView origin is stable/secure
// - OTA does NOT change any of the above: LiveUpdate unpacks to app-private storage and the
//   WebView keeps serving from the LOCAL origin. It carries web assets only, never native code.
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
