/**
 * /scan/:tag — the machine experience for a scanned label.
 *
 * WHY NOT /m/:tag. nginx routes `/m/` to mira-web (:3200), which owns the
 * cold-visitor channel funnel — chooser, guest report, registration — and its
 * byte-identical not-found page that keeps cross-tenant and nonexistent tags
 * indistinguishable. The Hub's own `/m/[assetTag]` page was therefore
 * unreachable in production: finished code that had never once executed.
 *
 * Serving the same page at `/scan/` makes it reachable with NO nginx change,
 * because everything that is not `/m/` already proxies to the Hub. mira-web
 * hands off here when the scanner already has a Hub session; a cold visitor
 * keeps the funnel exactly as before.
 *
 * This re-exports the existing component rather than copying it, so the scan
 * experience cannot drift between the two URLs.
 */
export { default } from "../../m/[assetTag]/page";
