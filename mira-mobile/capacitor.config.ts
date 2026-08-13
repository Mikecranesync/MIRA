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
      // We call CapacitorHttp.request explicitly in src/api.ts; do NOT patch
      // window.fetch globally (keeps the boundary between app code and any
      // future embedded content explicit).
      enabled: false,
    },
  },
};

export default config;
