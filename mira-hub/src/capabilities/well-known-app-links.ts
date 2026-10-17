/**
 * Public Digital Asset Links / Universal Links payloads.
 *
 * Android (`assetlinks.json`) and iOS (`apple-app-site-association`) fetch
 * these WITHOUT a session cookie. Hub middleware's unauthenticated branch
 * otherwise 307s every unknown path to /login, which fails App Link
 * verification (docs/plans/2026-08-23-conveyor-localization-and-live-data-plan.md
 * I8). Nginx exact-match locations exist in
 * deployment/nginx-app-factorylm.conf but are not what serves prod today —
 * the Hub has to answer 200 JSON itself.
 *
 * Pure and edge-safe — middleware imports this. Keep the bodies identical to
 * deployment/well-known/* (asserted by well-known-app-links.test.ts) so a
 * later nginx copy does not silently diverge.
 */

export const ASSETLINKS_PATH = "/.well-known/assetlinks.json";
export const APPLE_APP_SITE_ASSOCIATION_PATH =
  "/.well-known/apple-app-site-association";

// Source of truth for fingerprints: deployment/well-known/assetlinks.json
export const ASSET_LINKS = [
  {
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: "com.factorylm.mira",
      sha256_cert_fingerprints: [
        "67:71:B2:30:82:E3:34:60:50:47:7F:B3:3F:2A:14:93:07:4F:39:83:55:D9:E0:8B:05:73:62:1D:E5:7E:35:4D",
        "23:95:B9:60:50:C5:10:A5:C7:87:46:5B:83:25:6F:38:1B:1F:F5:E4:83:3D:2F:A8:8D:B7:35:79:29:3F:92:A9",
      ],
    },
  },
] as const;

// Source of truth: deployment/well-known/apple-app-site-association
// REPLACE_TEAM_ID is the documented Phase-5 placeholder.
export const APPLE_APP_SITE_ASSOCIATION = {
  applinks: {
    apps: [] as string[],
    details: [
      {
        appIDs: ["REPLACE_TEAM_ID.com.factorylm.mira"],
        components: [
          {
            "/": "/m/*",
            comment:
              "Asset QR deep links — factorylm.com/m/<TAG> opens the FactoryLM app",
          },
        ],
      },
    ],
  },
} as const;

/** Strip a single trailing slash so trailingSlash: true still hits these files. */
export function normalizeWellKnownPath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

/** JSON body for a public App/Universal Links well-known path, or null. */
export function wellKnownAppLinkBody(pathname: string): unknown | null {
  switch (normalizeWellKnownPath(pathname)) {
    case ASSETLINKS_PATH:
      return ASSET_LINKS;
    case APPLE_APP_SITE_ASSOCIATION_PATH:
      return APPLE_APP_SITE_ASSOCIATION;
    default:
      return null;
  }
}
