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
