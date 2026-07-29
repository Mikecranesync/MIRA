# Web Review — Drive Commander public surface (2026-07-10)

**Scope:** `factorylm.com/drive-commander/powerflex-525` (landing), fault pages (F005 thin,
F007 rich), parameter pages (P030), PF40 variant, 404/edge cases, mobile, Lighthouse,
security headers, sitemap/SEO, and a content-truth cross-check against
`origin/main:mira-web/src/data/drive-packs/powerflex_525.json`.

## What independently VERIFIED GOOD (the trust pitch holds)

- **Rendering is faithful to the pack.** Every rendered fault name/citation spot-checked
  matches the pack JSON byte-for-byte (F005 OverVoltage, F007 Motor Overload, P033, P030).
- **Fault names are genuinely correct per the OEM manual** (F002 Auxiliary Input, F003 Power
  Loss, F004 UnderVoltage, F005 OverVoltage, F007 Motor Overload, F013 Ground Fault, F064
  Drive Overload — all match Rockwell 520-UM001).
- **No Pro data leaks into the free DOM** — HTML source scan found only teaser copy; no
  hidden elements with Pro content. The renderer's stated discipline holds in production.
- **Honest abstention doctrine holds:** thin fault pages say "isn't in the free pack yet —
  we never invent steps we can't cite" instead of hallucinating steps.
- Console clean on DC pages (0 errors incl. after mobile resize + full scroll); all network
  requests 2xx; no mixed content.
- **Lighthouse: perf 91 / a11y 91 / best-practices 100 / SEO 100.**
- Full security-header set (HSTS+preload, CSP, XFO, XCTO, referrer-policy, permissions-policy).
- Sitemap contains 129 DC URLs; robots.txt sane; case-variant URLs canonicalize correctly
  (`/faults/f005` → canonical `F005`); per-page TechArticle JSON-LD; custom fault-not-found
  page for bogus codes (F999).
- Mobile 375px: no horizontal overflow; primary CTA 257×72 (comfortably tappable).
- PF40 pack live (26 faults), same layout.

## Findings (most obvious first)

| # | Sev | Route | Title | Evidence |
|---|-----|-------|-------|----------|
| 1 | 🟠 P1 | `/` (homepage) | Drive Commander is ORPHANED from the homepage — zero links to it | `curl` of `/`: 0 matches for "drive-commander"; only entry = direct URL / sitemap / DC-page-internal nav. The SEO conversion artifact gets no internal link equity and no human path from the front door. |
| 2 | 🟠 P1 | `/drive-commander/*` | Conversion CTA is a `mailto:` waitlist styled as a purchase button | "Unlock Drive Commander Pro — $197/year →" → `mailto:hello@factorylm.com?subject=...waitlist`. On mobile w/o a configured mail client this is a dead end. (Known — checkout is Phase 2 of the first-dollar plan — but it is the single largest conversion defect on the page.) |
| 3 | 🟠 P1 | `/faults/*` (43 of 48) | 90% of fault pages are thin: name + citation + paywall, ZERO parameter content — while every meta description promises "See the cited parameters to check" | Pack truth: only F007/F081/F082/F083/F101 have related parameters (5/48). E.g. F005 meta says "See the cited parameters…" but the page says "isn't in the free pack yet". Promise/content mismatch on the SEO pages; near-duplicate thin pages risk doorway-page treatment. |
| 4 | 🟡 P2 | `/parameters/P030` (+P035,P041,P042,P045) & F007 | Customer-visible garbled manual extraction | P030 purpose renders verbatim: "Selects the language The setting Important: drive is power cycled."; P033 on the flagship F007 page: "Sets the motor nameplate" (truncated) with excerpt "P033 0.1 A Based on Drive Rating" (table-cell noise). Undermines the visible-grounding-proof pitch. 5/45 params affected. |
| 5 | 🟡 P2 | `/drive-commander` | Index route 404s (generic FactoryLM 404) instead of listing packs | Header nav dodges it (links straight to powerflex-525) but the natural URL guess + future multi-pack navigation dead-ends. Already P0-c in the first-dollar plan. |
| 6 | 🟡 P2 | DC pages | Lighthouse a11y: insufficient color contrast + links distinguishable only by color | `color-contrast` score 0, `link-in-text-block` score 0 (dark industrial theme dimmed text). |
| 7 | 🟡 P2 | sitewide nav | Header/footer nav links ~16px tall (<44px tap target) on mobile | DOM scan: "Drive Commander" 116×16, "Blog" 28×16, etc. |
| 8 | 🟢 P3 | `/favicon.ico` | 404 (site declares SVG favicon; legacy .ico requests fail) | Console error on the 404 page; older crawlers/bookmarks request /favicon.ico. |

## Notes for the first-dollar plan

- Finding 2 = Phase 2 (checkout) — confirmed the top blocker in the wild.
- Finding 3 is the sleeper: shipping checkout behind 43 thin pages sells against weak free
  proof. Either enrich `related_faults` coverage in the PF525 pack (extraction pass over the
  manual's fault table→parameter cross-references) or rewrite thin-page meta descriptions to
  match what free actually shows. The G120 pack (Phase 1) should target parameter coverage
  per fault as a pack-gate metric, not just fault-name coverage.
- Finding 4: add a "purpose text is a complete sentence" heuristic to the pack reliability
  gate — 5 garbled params shipped through it.

Screenshot: `docs/promo-screenshots/2026-07-10_drive-commander-f007-fault-page_mobile.png`
