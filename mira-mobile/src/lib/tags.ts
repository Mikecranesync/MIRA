// Asset-tag extraction — implements the TAG-001 cross-surface grammar
// contract (docs/contracts/asset-tag-grammar.json; canonical definition:
// mira-hub/src/lib/asset-tag.ts ASSET_TAG_REGEX + scan-target.ts resolution).
//
// Mobile adds exactly two sanctioned behaviors on top of the Hub grammar:
//   1. Deep-link trust filter — an absolute-URL input resolves only from
//      https://app.factorylm.com/m/ or factorylm://m/ (foreign origins never
//      resolve; the Hub, an authed web app, has no such concern).
//   2. The factorylm:// scheme itself — the OS delivers it only to this app,
//      so it is resolved here by explicit prefix (never via URL parsing:
//      WHATWG parsers read a non-special scheme's 'm' as the host, which is
//      why the Hub resolver returns null for it).
// Everything else — the tag alphabet (NO dots: '.'/'..' traversal defense),
// 1–64 length, percent-decoding, /m/ path forms — MUST match the Hub
// byte-for-byte. Locked by tag-grammar-contract.test.ts (corpus) and
// tag-grammar-shadow.test.ts (side-by-side execution against the real Hub
// resolver). Change the contract file, not just this file.

const ASSET_TAG_REGEX = /^[A-Za-z0-9_-]{1,64}$/;

const TRUSTED_URL_PREFIXES = ["https://app.factorylm.com/m/", "factorylm://m/"];

export function extractAssetTag(input: string): string | null {
  const s = input.trim();
  if (!s) return null;

  if (/^[a-z]+:\/\//i.test(s)) {
    // Absolute URL: trust filter first — foreign origins never resolve.
    if (!TRUSTED_URL_PREFIXES.some((p) => s.startsWith(p))) return null;

    // factorylm://m/<TAG> — the app's own scheme, resolved by prefix.
    if (s.startsWith("factorylm://m/")) {
      const raw = s.slice("factorylm://m/".length).split(/[?#]/)[0].replace(/\/$/, "");
      const candidate = safeDecode(raw);
      return ASSET_TAG_REGEX.test(candidate) ? candidate : null;
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
