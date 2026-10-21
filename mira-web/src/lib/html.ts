/**
 * HTML escape used by mira-web renderers (same 5-entity map as
 * drive-commander-renderer / admin routes).
 */
export function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * JSON.stringify for a <script type="application/ld+json"> payload.
 * Escapes <, >, &, U+2028, and U+2029 so the blob cannot break out of
 * the script tag or a surrounding HTML context.
 */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
