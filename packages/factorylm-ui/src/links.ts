/**
 * Addresses a host puts on a part (`VisualObservation.previewUrl`,
 * `SourceReference.href`) end up in `href`/`src`. Only three shapes are
 * allowed through: a same-site path ("/x", never protocol-relative "//x"), an
 * absolute http(s) URL, or a `blob:` object URL a native host made from bytes
 * it fetched itself. Anything else (`javascript:`, `data:`, …) is refused.
 */
export function openableUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  // A browser rewrites a backslash to "/" and drops tabs/newlines while parsing
  // a URL, so "/\\evil.example" or "/<tab>/evil.example" — which look like
  // same-site paths here — resolve to another site (#4285 Codex F1). No address
  // we produce contains either, so refuse them outright.
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return null;
  return isSameSite(raw) || /^https?:\/\//i.test(raw) || /^blob:/i.test(raw) ? raw : null;
}

/** A same-site path can be shown inside this app; other sites usually refuse to be framed. */
export function isSameSite(url: string): boolean {
  return /^\/(?!\/)/.test(url);
}
