// Asset-tag extraction — implements the TAG-001 cross-surface grammar
// contract (docs/contracts/asset-tag-grammar.json; canonical definition:
// mira-hub/src/lib/asset-tag.ts ASSET_TAG_REGEX + scan-target.ts resolution).
//
// Mobile adds exactly two sanctioned behaviors on top of the Hub grammar:
//   1. Deep-link trust filter — an absolute-URL input resolves only from the
//      canonical app origin (determined by build flavor: app.factorylm.com for
//      production, app-staging.factorylm.com for staging) or the app's own
//      custom scheme (factorylm:// for production, factorylmstaging:// for
//      staging). Foreign origins never resolve; the Hub, an authed web app,
//      has no such concern.
//   2. The custom scheme itself — the OS delivers it only to this app,
//      so it is resolved here by explicit prefix (never via URL parsing:
//      WHATWG parsers read a non-special scheme's 'm' as the host, which is
//      why the Hub resolver returns null for it).
//
// The trust decision is made on the PARSED, NORMALIZED URL — never on raw
// string prefixes. Scheme and host are case-insensitive per RFC 3986 (and
// the URL parser normalizes them), so HTTPS://APP.FACTORYLM.COM and an
// explicit :443 default port are the same trusted origin; a raw
// case-sensitive startsWith rejected all of these while the Hub accepted
// them — the exact divergence CU-P1's adversarial review (Gate 7) caught.
// Path and tag stay case-sensitive, matching the Hub.
//
// Everything else — the tag alphabet (NO dots: '.'/'..' traversal defense),
// 1–64 length, percent-decoding, /m/ path forms — MUST match the Hub
// byte-for-byte. Locked by tag-grammar-contract.test.ts (corpus) and
// tag-grammar-shadow.test.ts (side-by-side execution against the real Hub
// resolver, which reuses isTrustedDeepLink below so the shadow's sanctioned
// divergence and the implementation can never drift apart silently).
// Change the contract file, not just this file.

import { resolveDeepLinkConfig } from "../plugins/build-config";

const ASSET_TAG_REGEX = /^[A-Za-z0-9_-]{1,64}$/;

// Flavor-specific trust configuration, initialized on first use
let TRUSTED_ORIGIN: { protocol: string; host: string } | null = null;
let APP_SCHEME_PREFIX: RegExp | null = null;
let configPromise: Promise<void> | null = null;

async function initTrustConfig(): Promise<void> {
  if (TRUSTED_ORIGIN !== null && APP_SCHEME_PREFIX !== null) return;
  if (configPromise !== null) return configPromise;

  configPromise = resolveDeepLinkConfig()
    .then(({ host, scheme }) => {
      TRUSTED_ORIGIN = { protocol: "https:", host };
      APP_SCHEME_PREFIX = new RegExp(`^${scheme}:\\/\\/m\\/`, "i");
    })
    .catch((e: unknown) => {
      // Fail closed: with no flavor config NOTHING is a trusted deep link
      // (isTrustedDeepLink returns false while uninitialized). Never fall back
      // to another environment's origin. Reset so a later init can retry.
      configPromise = null;
      console.warn("[tags] deep-link trust config unavailable; rejecting all links", e);
    });

  return configPromise;
}

/** The deep-link trust rule, on the normalized URL. Exported so the shadow
 * suite sanctions divergence with the SAME rule the implementation uses. */
export function isTrustedDeepLink(input: string): boolean {
  // Synchronous check requires config to be initialized first
  if (TRUSTED_ORIGIN === null || APP_SCHEME_PREFIX === null) {
    // Not initialized yet - reject as untrusted (fail-closed)
    return false;
  }

  const s = input.trim();
  if (APP_SCHEME_PREFIX.test(s)) return true;
  try {
    const url = new URL(s);
    return url.protocol === TRUSTED_ORIGIN.protocol && url.host === TRUSTED_ORIGIN.host;
  } catch {
    return false;
  }
}

/** Initialize the trust configuration. Must be called before any tag extraction. */
/** Test seam: forget flavor trust so the next init re-resolves. */
export function __resetTagParserForTests(): void {
  TRUSTED_ORIGIN = null;
  APP_SCHEME_PREFIX = null;
  configPromise = null;
}

export async function initTagParser(): Promise<void> {
  await initTrustConfig();
}

export function extractAssetTag(input: string): string | null {
  const s = input.trim();
  if (!s) return null;

  if (/^[a-z]+:\/\//i.test(s)) {
    // Absolute URL: trust filter first — foreign origins never resolve.
    if (!isTrustedDeepLink(s)) return null;

    // Custom scheme: <scheme>://m/<TAG> — resolved by prefix
    // (scheme case-insensitive; the tag itself stays case-sensitive).
    if (APP_SCHEME_PREFIX !== null) {
      const appScheme = s.match(APP_SCHEME_PREFIX);
      if (appScheme) {
        const raw = s.slice(appScheme[0].length).split(/[?#]/)[0].replace(/\/$/, "");
        const candidate = safeDecode(raw);
        return ASSET_TAG_REGEX.test(candidate) ? candidate : null;
      }
    }

    // https app URL — mirror Hub scan-target.ts exactly.
    try {
      const url = new URL(s);
      const match = url.pathname.match(/\/m\/([^/?#]+)/);
      if (!match) return null;
      const candidate = safeDecode(match[1]);
      return ASSET_TAG_REGEX.test(candidate) ? candidate : null;
    } catch {
      return null;
    }
  }

  // Path form: "/m/<TAG>" or "m/<TAG>" — mirror Hub scan-target.ts.
  const pathMatch = s.match(/^\/?m\/([^/?#]+)/);
  if (pathMatch) {
    const candidate = safeDecode(pathMatch[1]);
    return ASSET_TAG_REGEX.test(candidate) ? candidate : null;
  }

  // Raw tag.
  return ASSET_TAG_REGEX.test(s) ? s : null;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
