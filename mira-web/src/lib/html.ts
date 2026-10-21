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
