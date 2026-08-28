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
    // Signed OTA web-bundle updates (ADR-0034 amendment).
    LiveUpdate: {
      // The OTA verification PUBLIC key, compiled into the shell. This is the
      // property that makes a remote bundle acceptable at all: an attacker who
      // controls the update host still cannot ship code, because the private
      // half lives only in Doppler factorylm/prd and never leaves CI.
      //
      // It is deliberately a SEPARATE RSA-4096 keypair from the Android upload
      // keystore — compromising one must not grant the other.
      //
      // Changing this value is a NATIVE change: it ships in an APK, never over
      // OTA. The release guard blocks any attempt to do otherwise.
      publicKey:
        "-----BEGIN PUBLIC KEY-----MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAuLU3ebXbdfu76Jpfc6rLCMU0kOsPEcrTj/0hQUrEyThtXJBsEh7Hr2Up058ibAt1lQkikjft+ilf8CMeQ/K4dZeKSuxxiOVkAiDVGKh1PLplSI6RRYT2mK1RzD3KeMaM2Dd42IJ4ql/VSEnCgvhjpEAyTxYQKrecgE3YCLxeOFIP1q06mspdipsoegx3N8znyfWvdhamvxIoXKV+PIQv0AsZdczG8sNOUq+tauVuhIocl0RXyOXw60M5L7N+u81hj1xfDtGHGkjd+8tO+W3SA6EKYqENE9YUs4Zth2gDqLmG9cmdr4AoRjmiq+51aHKiht/g7ots/nILeeUYnnyyb1c4Ga1wphzWrDSi71GH16+WQOqeA3nL2r5TRB4XHFFRA9WoT8diA0hP6gl/rYVvPFNgHaVXD/1UB1MsVC3xZLdkaVkXfqhFvNb15/e/4blcFc3LJPtNpn8w9KxA1o4BDpOmwH2aOWEc4muxESy6ekgzJ9GcbhOyz+f6K6y+CwaTAQpX2HFuVZCxY/YgVUt419k9+vOWqLnbV9rG56UdEy5JzA+lcFcO8/qVPVg6j0WbORDbYkywDfxRO6GNJYtomSB1ow6aU1SBty7EOMzsmCyQhd5K9Gw2J1sl+RybneV6/YqvHkd7gTCySOrMjKA+gaScinwgbKAkSt7vXATKyRECAwEAAQ==-----END PUBLIC KEY-----",
      // MUST be non-zero. The plugin's default is 0, which DISABLES automatic
      // rollback entirely — a bundle that white-screens would simply stay. With
      // a timeout, a bundle that never reaches ready() is reverted to the last
      // known-good one on the next launch.
      readyTimeout: 10000,
      // Channels are chosen at runtime (canary vs production); this is only the
      // floor for a shell that has never been told otherwise.
      defaultChannel: "production",
      httpTimeout: 30000,
    },
    CapacitorHttp: {
      // JSON/text calls go through CapacitorHttp.request explicitly
      // (src/api/client.ts owns the cookie jar). The fetch patch is enabled
      // because multipart uploads (notebook source PDFs, nameplate photos)
      // cannot cross the plugin bridge as FormData — the patch is the one
      // path that rebuilds real multipart natively. Two callers use
      // window.fetch on native, both passing the session Cookie header
      // explicitly from OUR jar: `uploadMultipart` (multipart) and
      // `requestStream` (chat SSE, STRM-1). Known limit: the patch fulfils a
      // request natively and hands the WebView ONE buffered Response and
      // ignores AbortSignal, so on device the SSE body arrives in one chunk.
      // Per-token delivery on device needs the raw WebView fetch, which
      // needs the Hub to CORS-allow the app origin (https://localhost) and
      // the session cookie in the WebView cookie store — the Hub-side
      // CORS + cookie prerequisite, tracked in #3453 (hub-streaming lane).
      // Until then Stop is client-side only on device: the abort never
      // reaches the server. Trust boundary unchanged: packaged bundle only,
      // no remote UI.
      enabled: true,
    },
  },
};

export default config;
