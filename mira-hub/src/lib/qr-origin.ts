/**
 * The one origin a printed QR sticker may encode.
 *
 * A sticker is a physical, permanent object: `012_qr_permanent_binding.sql`
 * makes the tag an asset's lifelong handle, and the label goes on the machine
 * with adhesive. Getting the origin wrong is therefore not a bug you fix by
 * redeploying — it is a bug you fix by walking the plant with a scraper.
 *
 * The print page used to encode `window.location.origin`, so printing from
 * localhost or a staging host produced labels the in-app scanner **silently
 * refuses**: `mira-mobile/src/lib/tags.ts` pins
 * `TRUSTED_ORIGIN = { protocol: "https:", host: "app.factorylm.com" }` and
 * `isTrustedDeepLink` rejects everything else. Nothing at print time said so.
 *
 * `tools/qr-label-pdf.py` already hardcodes the correct base, so the two
 * producers disagreed. This is the shared constant that ends the disagreement;
 * `qr-origin.test.ts` pins it against the mobile scanner's own declaration so
 * the two cannot drift apart silently.
 */

/** Canonical production origin. Never derive this from the browser. */
export const QR_CANONICAL_ORIGIN = "https://app.factorylm.com";

/** The exact string a sticker for `tag` must encode. */
export function qrUrlForTag(tag: string): string {
  return `${QR_CANONICAL_ORIGIN}/m/${tag}`;
}

/**
 * True when the page doing the printing is not the canonical origin. The label
 * is still correct — it always encodes production — but the operator deserves
 * to know they are printing production stickers from somewhere else.
 */
export function isOffCanonicalOrigin(currentOrigin: string | null | undefined): boolean {
  if (!currentOrigin) return false; // SSR: nothing to compare, nothing to warn about
  return currentOrigin !== QR_CANONICAL_ORIGIN;
}
