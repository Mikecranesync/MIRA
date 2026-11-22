/**
 * #5744 — email (magic-link) sign-in returns the technician to the cited
 * manual page they opened, the same way password and Google sign-in already
 * return to their link (#5726).
 *
 * The return path rides three hops: the login form posts its `callbackUrl`
 * with the email, the emailed link carries it as `next`, and the verify page
 * goes there after the token is accepted. Every hop re-checks it with
 * `safeReturnPath`, because anyone holding the emailed link can edit it.
 *
 * Only ONE kind of destination is carried: the cited-page source viewer,
 * `/v3/source/?file=<uuid>&page=<n>` — the link a ready manual hands the
 * technician. It names nothing but a file id and a page number. Every other
 * return path falls back to /feed, because the emailed URL leaves the Hub: it
 * passes through the mail provider, and a mistyped address delivers it to a
 * stranger. A general deep link can carry work-order details in its query
 * (the machine-memory "create work order" link pre-fills the asset, fault and
 * next check), so it is never put on the email (#5751 Codex F1). The check
 * also keeps authentication pages such as /magic out (F2). The link is rebuilt
 * from an ASCII uuid and page number, so a malformed character in the input
 * can never reach URL encoding (F3).
 *
 * The token rides the URL fragment (#5747: fragments never reach request
 * URIs or referrers, and the verify page strips it from history). `next` is
 * a query parameter: it names only a file id and a page number.
 *
 * Paths are basePath-relative, exactly like the middleware's `loginCallback`:
 * `router.push` adds the basePath itself.
 */

export const DEFAULT_RETURN_PATH = "/feed";

const VIEWER_PATH = /^\/v3\/source\/?$/;
const FILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = /^[1-9][0-9]{0,5}$/;
const MAX_RETURN_PATH = 200;

/** The source-viewer link, rebuilt from its file id and page, or null. */
export function safeReturnPath(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw || raw.length > MAX_RETURN_PATH) return null;
  const q = raw.indexOf("?");
  const path = q === -1 ? raw : raw.slice(0, q);
  if (!VIEWER_PATH.test(path)) return null;
  const params = new URLSearchParams(q === -1 ? "" : raw.slice(q + 1));
  const keys = [...params.keys()];
  if (keys.some((k) => k !== "file" && k !== "page") || params.getAll("file").length !== 1 || params.getAll("page").length > 1) {
    return null;
  }
  const file = params.get("file") ?? "";
  const page = params.get("page");
  if (!FILE_ID.test(file) || (page !== null && !PAGE.test(page))) return null;
  return `/v3/source/?file=${file.toLowerCase()}${page ? `&page=${page}` : ""}`;
}

/** The JSON body the login form posts: the return path only when it is the
 *  cited-page viewer. */
export function magicLinkRequestBody(email: string, callbackUrl: string | null): { email: string; returnTo?: string } {
  const returnTo = safeReturnPath(callbackUrl);
  return { email: email.trim(), ...(returnTo ? { returnTo } : {}) };
}

/** The sign-in link the email carries: `/magic/`, the checked return path as
 *  `next`, and the token in the fragment. */
export function magicLinkUrl(origin: string, apiBase: string, token: string, returnTo: unknown): string {
  const next = safeReturnPath(returnTo);
  return `${origin}${apiBase}/magic/${next ? `?next=${encodeURIComponent(next)}` : ""}#token=${encodeURIComponent(token)}`;
}

/** Where the verify page sends a technician whose token was accepted. */
export function magicLandingPath(next: string | null): string {
  return safeReturnPath(next) ?? DEFAULT_RETURN_PATH;
}

/** The verify page's redemption, kept out of the component so it is tested:
 *  the destination after an accepted token, or null when sign-in failed. */
export async function redeemMagicToken(
  signInWithToken: (token: string) => Promise<{ ok?: boolean } | undefined | null>,
  token: string,
  next: string | null,
): Promise<string | null> {
  const result = await signInWithToken(token);
  return result?.ok ? magicLandingPath(next) : null;
}
