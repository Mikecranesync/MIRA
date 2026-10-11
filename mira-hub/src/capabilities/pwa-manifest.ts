import type { MetadataRoute } from "next";

// The web app manifest that lets a technician add MIRA to a phone home screen
// from the browser (#4363). There is no store listing yet (#3881), so this is
// the crew's only "app".
//
// Every URL here is a literal string the browser resolves against the origin,
// so it must carry the deployment's basePath ("/hub" in prod, "" on staging —
// same derivation as next.config.ts). start_url is the app root on purpose:
// where the root lands is hub-landing.ts's decision (#3880), not this file's.
//
// No service worker: Chrome dropped the fetch-handler requirement for install
// (108 mobile / 112 desktop), and the root layout's sw-killer unregisters every
// worker on load (legacy Open WebUI cleanup), so shipping one would be dead code.

export const PWA_ICONS = [
  { file: "pwa-icon-192.png", sizes: "192x192", purpose: "any" },
  { file: "pwa-icon-512.png", sizes: "512x512", purpose: "any" },
  { file: "pwa-icon-maskable-512.png", sizes: "512x512", purpose: "maskable" },
  // iOS ignores manifest icons for add-to-home; layout.tsx links this one.
  { file: "apple-touch-icon.png", sizes: "180x180", purpose: "any" },
] as const;

export function pwaManifest(basePath: string): MetadataRoute.Manifest {
  const root = `${basePath}/`;
  return {
    name: "MIRA by FactoryLM",
    short_name: "MIRA",
    description: "AI maintenance assistant for the plant floor",
    start_url: root,
    scope: root,
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#2563EB",
    icons: PWA_ICONS.filter((i) => i.file !== "apple-touch-icon.png").map((i) => ({
      src: `${basePath}/${i.file}`,
      sizes: i.sizes,
      type: "image/png",
      purpose: i.purpose,
    })),
  };
}
