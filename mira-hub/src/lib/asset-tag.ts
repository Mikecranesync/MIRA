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

// Crockford base32 (no I/L/O/U) — readable when printed on a label, no
// case-confusion when typed back in by hand.
const BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Generate a permanent asset tag. Format: `{prefix}-{8 base32 chars}`,
 * where the prefix defaults to "EQ" but can be derived from the
 * manufacturer for human readability (e.g. "AB-9X4K2P7Q" for Allen-Bradley).
 *
 * The result conforms to ASSET_TAG_REGEX so it round-trips through every
 * existing validator. Collision space is 32^8 ≈ 1.1 × 10^12 per prefix —
 * the unique partial index on (tenant_id, equipment_number) catches the
 * astronomically rare clash and the caller retries.
 */
export function generateAssetTag(opts: { manufacturer?: string | null } = {}): string {
  const prefix = derivePrefix(opts.manufacturer ?? null);
  let suffix = "";
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  for (let i = 0; i < 8; i++) suffix += BASE32[buf[i] % 32];
  return `${prefix}-${suffix}`;
}

function derivePrefix(manufacturer: string | null): string {
  if (!manufacturer) return "EQ";
  const cleaned = manufacturer
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 4);
  return cleaned.length >= 2 ? cleaned : "EQ";
}

