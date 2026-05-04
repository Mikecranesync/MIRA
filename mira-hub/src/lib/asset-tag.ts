// mira-hub/src/lib/asset-tag.ts
//
// `assetTag` is user-controlled and flows downstream into a filesystem path
// in mira-ingest (`PHOTOS_DIR / asset_tag`). Without validation, a value like
// "../../etc" traverses out of PHOTOS_DIR. The hub validates first; mira-ingest
// belt-and-suspenders re-validates.
//
// Whitelist: 1–64 chars of letters, digits, underscore, dash. No dots (rules
// out "." / ".." / hidden files), no slashes, no spaces, no Unicode.

export const ASSET_TAG_REGEX = /^[A-Za-z0-9_-]{1,64}$/;

export interface AssetTagValidation {
  ok: boolean;
  value: string | null;
  reason?: string;
}

/**
 * Normalize and validate an `assetTag` value from a request body.
 *
 * Returns `{ok: true, value: null}` for absent/empty/whitespace input —
 * uploaders may legitimately omit it (mira-ingest stores those photos under
 * "unassigned").
 *
 * Returns `{ok: true, value: <trimmed>}` for valid values.
 *
 * Returns `{ok: false, reason: ...}` for any value present but rejected.
 */
export function validateAssetTag(raw: unknown): AssetTagValidation {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "string") {
    return { ok: false, value: null, reason: "asset_tag_must_be_string" };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  if (!ASSET_TAG_REGEX.test(trimmed)) {
    return {
      ok: false,
      value: null,
      reason: "asset_tag_invalid: must match /^[A-Za-z0-9_-]{1,64}$/",
    };
  }
  return { ok: true, value: trimmed };
}
