// Resolve a raw QR-scan payload to an asset tag we can route to.
//
// QR labels we generate encode `https://app.factorylm.com/m/<TAG>` (see the
// qr-onboarding skill), so the URL form is the common case. We also accept
// a `/m/<TAG>` path-only string and — as a fallback for hand-typed input or
// older stickers — a raw tag that satisfies ASSET_TAG_REGEX.

import { ASSET_TAG_REGEX } from "./asset-tag";

export function extractAssetTag(raw: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();

  try {
    const url = new URL(trimmed);
    const match = url.pathname.match(/\/m\/([^/?#]+)/);
    if (match) {
      const candidate = safeDecode(match[1]);
      return ASSET_TAG_REGEX.test(candidate) ? candidate : null;
    }
    return null;
  } catch {
    // not a URL, fall through to path/raw forms
  }

  const pathMatch = trimmed.match(/^\/?m\/([^/?#]+)/);
  if (pathMatch) {
    const candidate = safeDecode(pathMatch[1]);
    return ASSET_TAG_REGEX.test(candidate) ? candidate : null;
  }

  return ASSET_TAG_REGEX.test(trimmed) ? trimmed : null;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// Only an internal absolute path (no scheme, no protocol-relative "//", no query)
// is an acceptable post-scan return target — guards against open-redirect.
const SAFE_RETURN_PATH = /^\/(?!\/)[A-Za-z0-9/_-]*$/;

// Build the navigation target after a successful scan.
//   default        -> the asset's mobile page, /m/<TAG>
//   with returnTo  -> <returnTo>?assetTag=<TAG>, so the surface that opened the
//                     scanner (e.g. the New Work Order wizard) can preselect the
//                     scanned asset.
// An unsafe/missing `returnTo` falls back to the default.
export function buildScanRoute(returnTo: string | null | undefined, tag: string): string {
  const enc = encodeURIComponent(tag);
  if (returnTo && SAFE_RETURN_PATH.test(returnTo)) {
    return `${returnTo}?assetTag=${enc}`;
  }
  return `/m/${enc}`;
}
