// Parses a pasted workspace-invitation URL WITHOUT ever contacting it. The
// only network calls the invite sign-in flow makes go to this app's own
// trusted backend origin (the resolved build-flavor API base) — never to the
// host or path the technician pasted. This file never logs the pasted text
// or the extracted token (grep it: no console.* references either).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type InviteLinkError =
  | "empty"
  | "invalid_format"
  | "untrusted_origin"
  | "missing_token";

export interface InviteLinkResult {
  token: string;
}

/**
 * The link's token, read the same way for every caller. An invitation carries
 * it as `?token=`; the emailed sign-in link (#5942, the Hub's magicLinkUrl)
 * carries it in the fragment, `#token=`, after an optional `?next=`. When both
 * are present they must agree: two different tokens in one link is rejected
 * rather than resolved by picking one.
 */
function linkToken(url: URL): { token: string } | { conflict: true } {
  const query = url.searchParams.get("token")?.trim() ?? "";
  const fragment = new URLSearchParams(url.hash.replace(/^#/, "")).get("token")?.trim() ?? "";
  if (query && fragment && query.toLowerCase() !== fragment.toLowerCase()) return { conflict: true };
  return { token: query || fragment };
}

/**
 * Token identity of a pasted invitation URL — used only to decide whether a
 * textarea edit is a *different* invite. Does not contact the host, does not
 * log the value, and is not an authentication check (origin/HTTPS/path
 * validation still happens in `parseInviteLink` at submit).
 */
export function inviteTokenIdentity(pasted: string): string | null {
  const raw = pasted.trim();
  if (!raw) return null;
  try {
    const found = linkToken(new URL(raw));
    if ("conflict" in found) return null;
    return UUID_RE.test(found.token) ? found.token.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * `trustedOrigin` is the app's own resolved backend origin (e.g.
 * `https://app.factorylm.com`), from `resolveApiBase()` — NOT derived from
 * the pasted text. A pasted link whose origin doesn't match is rejected
 * before any further parsing of its contents.
 */
export function parseInviteLink(
  pasted: string,
  trustedOrigin: string,
): InviteLinkResult | { error: InviteLinkError } {
  const raw = pasted.trim();
  if (!raw) return { error: "empty" };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { error: "invalid_format" };
  }

  if (url.protocol !== "https:") return { error: "invalid_format" };
  if (url.origin !== trustedOrigin) return { error: "untrusted_origin" };
  // The hub serves the magic-link landing page at /magic, optionally behind
  // a basePath (e.g. /hub/magic) — accept either. The hub runs with Next's
  // `trailingSlash: true` (next.config.ts), so the CANONICAL emailed link is
  // `/magic/`, not `/magic` — both must be accepted since this link is never
  // fetched/followed (no redirect would ever normalize it for us).
  if (!/\/magic\/?$/.test(url.pathname)) return { error: "invalid_format" };

  const found = linkToken(url);
  if ("conflict" in found) return { error: "invalid_format" };
  if (!UUID_RE.test(found.token)) return { error: "missing_token" };

  return { token: found.token };
}
