/**
 * Scan hand-off: does this scanner already belong to the Hub?
 *
 * A cold visitor scanning a machine label needs the channel funnel — chooser,
 * guest report, registration. A technician who is already signed in to the Hub
 * needs the machine: its notebook, its documents, Ask MIRA. `/m/:tag` served
 * only the first audience, because the Hub's own scan page is unreachable in
 * production (nginx sends `/m/` here, everything else to the Hub).
 *
 * So this decides, from cookies alone, which audience a scan belongs to.
 *
 * IT IS A ROUTING HINT, NEVER AN AUTHORIZATION DECISION. The presence of a
 * session cookie is not proof of a valid session — the cookie may be expired,
 * revoked or forged. The Hub validates it and shows its own guest landing if it
 * does not hold. Nothing here grants access to anything; the worst a forged
 * cookie achieves is being sent to a page that will ask you to sign in.
 */

/** NextAuth's cookie names. The `__Secure-` prefix is used over HTTPS. */
const HUB_SESSION_COOKIES = ["__Secure-next-auth.session-token", "next-auth.session-token"] as const;

export function hubSessionPresent(cookies: Record<string, string>): boolean {
  return HUB_SESSION_COOKIES.some((name) => Boolean(cookies[name]));
}

/**
 * Where the Hub serves the machine experience.
 *
 * `/machine/`, and neither `/m/` nor `/scan/`. nginx proxies `/m/` here (this
 * app) and `/scan/` to the MIRA Scan SPA on :5180 — using either would send the
 * technician to the wrong application, and the first version of this hand-off
 * did exactly that until production probing caught it. `/machine/` is claimed by
 * no location block, so it falls through to the Hub with no nginx change.
 */
export function hubScanPath(assetTag: string): string {
  return `/machine/${encodeURIComponent(assetTag)}`;
}
