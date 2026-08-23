/**
 * /machine/:tag — the machine experience for a scanned label.
 *
 * WHY NOT /m/:tag. nginx routes `/m/` to mira-web (:3200), which owns the
 * cold-visitor channel funnel — chooser, guest report, registration — and its
 * byte-identical not-found page that keeps cross-tenant and nonexistent tags
 * indistinguishable. The Hub's own `/m/[assetTag]` page was therefore
 * unreachable in production: finished code that had never once executed.
 *
 * WHY NOT /scan/:tag EITHER. That prefix is ALSO taken: nginx proxies `/scan/`
 * to the MIRA Scan SPA on :5180 (with its own FastAPI backend on /api/scanbe).
 * The first attempt at this hand-off redirected there and served a different
 * application — caught by probing production rather than by reading the config,
 * which is why the check is "prove both flows" and not "the redirect returns 302".
 *
 * `/machine/` is proxied by nothing, so it falls through to the Hub, and the
 * page is reachable with NO nginx change. mira-web hands off here when the
 * scanner already has a Hub session; a cold visitor keeps the funnel exactly as
 * before.
 *
 * This re-exports the existing component rather than copying it, so the scan
 * experience cannot drift between the two URLs.
 */
export { default } from "../../m/[assetTag]/page";
