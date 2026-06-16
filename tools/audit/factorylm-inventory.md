# factorylm.com audit — 2026-04-10

**Scope:** `https://factorylm.com` only (marketing + beta funnel served by `mira-web`). Out of scope: `app.factorylm.com`, `cmms.factorylm.ai`, Stripe Checkout, Loom, external CDNs.

**Sources:**
- Live Playwright crawl: `tools/audit/findings.md` + `findings.json` (25 pages, 62 links checked, 40 screenshots)
- Source critique: static read of `mira-web/public/*.html`, `cmms.css`, `emails/beta-*.html`
- Route inventory: parsed from `mira-web/src/server.ts`

---

## TL;DR — 10 bullets

1. **P0 — `/activated` is broken.** After paying, users land on a page that's a verbatim duplicate of `/cmms` (same title, H1, CTA). The post-payment "you're in" page doesn't exist as distinct UI. Breaks the beta funnel's "moment of highest motivation" principle.
2. **P0 — `cmms.html` JSON-LD has a fabricated `aggregateRating: 4.8/12 reviews`.** Not real data. Google penalty risk + credibility hit when discovered. Remove immediately.
3. **P0 — Homepage has no primary CTA button.** Live crawl found `/` has 0 scripts, 0 buttons, 0 forms, no `<main>` landmark — just text links. Direct acquisition path requires 2 clicks to reach the signup form on `/cmms`.
4. **P0 — index.html H1 and cmms.html H1 are both generic.** "AI that actually understands your equipment" and "Join the FactoryLM Beta" fail the "so what" test. Conversion copy needs concrete outcomes.
5. **P1 — 17/25 pages share a repeating 404 console error.** Unknown sitewide resource failing to load. Same signature on home, blog, cmms, activated, every blog post. Probably a layout-level favicon/manifest reference. Needs DevTools Network tab to identify.
6. **P1 — Two design systems, two renderers.** Homepage uses Inter + static HTML + no main landmark. `/cmms` uses DM Sans + IBM Plex Mono + blocking script + proper landmark. Brand discontinuity and a11y regression on the site's front door.
7. **P1 — Fake chat demo on index.html.** Static HTML mock of a chat window with blinking cursor and hardcoded answer. Plant managers read this as vaporware. Replace with real Loom GIF or live iframe.
8. **P1 — Zero real proof on either landing page.** No customer logos, no quotes, no photos of actual factories, no metrics. At $97/mo this is a trust gap for enterprise maintenance managers.
9. **P1 — WCAG AA contrast failures** on `cmms.css` `--text-muted #7a766c` (~3.4:1) used for all form labels and metadata. `index.html --text-faint` (~3.0:1) used on hero subtext.
10. **P2 — Lots of polish.** Lucide CDN `@latest` (unpinned), Google Fonts blocking render on both pages, ~680 lines of inline CSS on index.html, cmms.html ships a 440-line inline script.

**Bottom line:** The site looks like a well-coded SaaS template, not like software made by people who've been on a factory floor at 2 AM. The biggest single-leverage change is killing the fake chat demo on `/` and shipping a real 20-second product GIF. The second is fixing `/activated` so paying customers don't see the same signup form again. The third is killing the fabricated JSON-LD before Google finds it.

---

## 1. Functional issues — from live Playwright crawl

### Broken / missing resources
| # | Severity | Issue | Source | Fix |
|---|---|---|---|---|
| F1 | P0 | **`/activated` is a verbatim duplicate of `/cmms`** — same title, same H1, same CTA. Post-payment page is indistinguishable from pre-payment signup. | Live crawl: `/activated` title = `FactoryLM — AI Fault Code Diagnosis for Maintenance Teams \| Beta`, H1 = `Join the FactoryLM Beta` | Diff `/activated` vs `/cmms` routing in `mira-web/src/server.ts`. Build a distinct `activated.html` page OR confirm `public/activated.html` is actually being served (it exists but may not be routed). |
| F2 | P1 | **Repeating 404 console error on 17/25 pages.** Signature: `Failed to load resource: 404`. Same on home, /cmms, /activated, /blog, every blog post. Layout-level missing asset. | Live crawl | Open DevTools Network tab on `factorylm.com/`, filter 404s, identify the failing request. Likely a favicon variant, manifest.json entry, or PWA asset. |
| F3 | P2 | **`/og-image.svg` returns 404.** Not actually referenced by any page (pages point at `/og-image.png` which works). Only hit because it was a seed probe. | Live crawl | Delete dangling references OR add the SVG file to `mira-web/public/`. |
| F4 | P1 | **`/demo/work-orders` returns 200 with blank HTML.** JS hydration didn't complete before `domcontentloaded`. | Live crawl | Likely a real issue: the route may need client-side JS to render, but the crawler didn't wait for `networkidle`. Manual test in a real browser to confirm whether this page actually renders content for users. |

### Pages that returned 200 but have empty content
- `/demo/work-orders` — empty HTML (possibly a demo ticker endpoint that returns JSON, not HTML; route audit shows it's routed from `server.ts` as JSON — intentional, mark as non-issue)
- `/api/health` — empty HTML, `Content-Length: 0` — intentional JSON liveness probe

### HEAD-checked links — 62 unique, all 200
Zero broken internal navigation. The site doesn't have link rot.

### Auth-gated / POST routes (correctly rejected public crawling)
- `POST /api/register`
- `POST /api/stripe/webhook`
- `POST /api/ingest/manual`
- `POST /api/mira/chat`
- `GET /api/me` (requireActive)
- `GET /api/quota` (requireActive)
- `GET /api/billing-portal` (requireAuth)
- `GET /demo/tenant-work-orders` (requireActive)

### External domains
**Zero external links from any crawled page.** Surprising — no LinkedIn, no Twitter, no Loom, no GitHub. May be intentional (funnel wants zero outbound leakage) or an oversight (no social proof links).

---

## 2. Design & UX issues — from source critique

### TL;DR (design perspective)
The site uses SaaS template patterns (Linear-esque dark gray on index, amber industrial on cmms) without committing to either. Two different type systems, two different color accent strategies, one blueprint grid treatment, one noise-grain overlay. Plant managers pattern-match all of it as "another AI startup." The single best element is the `.cta-start` button on index.html — it has real inset shadows, a pulse dot, and a pressed state. Everything else should aspire to that level of craft.

### index.html — Home
| # | Sev | File:Line | Issue | Fix |
|---|---|---|---|---|
| D1 | P0 | `index.html:768-772` | H1: "AI that actually understands your equipment" — generic template copy. | Rewrite as concrete outcome: "Diagnose a fault in 10 seconds. Not 30 minutes." or "Your PowerFlex manual, searchable on the floor." |
| D2 | P1 | `index.html:774-777` | Subhead is a feature list. Ends on "learns from every repair" not an outcome. | End on the outcome: "...so your techs fix it once, on the first trip." |
| D3 | P1 | `index.html:795-829` | Hero "demo frame" is a static HTML mock of a chat with hardcoded text and blinking cursor. Reads as vaporware. | Replace with (a) a real 20-second Loom GIF of mira-chat answering a PowerFlex fault, OR (b) an `<iframe>` to the live CMMS chat, OR (c) an actual product screenshot PNG. |
| D4 | P1 | `index.html:835-970` | Three feature blocks are all self-descriptions. Zero customer voice. | Add one plant-manager quote ("Cut our MTTR on PowerFlex faults by 60%"), even if it's a synthetic pilot quote. Credibility gap. |
| D5 | P1 | `index.html:259-266` | `.hero-h1 { font-weight: 400; }` at 56px on dark bg reads anemic. | Bump to 600-700 weight, tighten tracking to `-0.035em`. |
| D6 | P1 | `index.html:281, 582, 682` | Body copy at `font-weight: 300` on Windows ClearType looks weak. | Raise minimum body weight to 400. |
| D7 | P2 | `index.html:85-93` | Amber radial gradient at 6% opacity is barely visible on most monitors. | Either commit to 10-12% + warm text tint, or delete. |
| D8 | P2 | `index.html:850-851` | `.feature-stat: "≤800ms first token"` — nobody at a factory cares about tokens. | Translate: "Answer before you finish typing" or "Under 1 second per question." |

### cmms.html — Beta landing
| # | Sev | File:Line | Issue | Fix |
|---|---|---|---|---|
| D9 | P0 | `cmms.html:34-47` | **JSON-LD aggregateRating: 4.8/12 reviews is fabricated.** | Delete the `aggregateRating` field entirely from the SoftwareApplication schema. Keep the rest. |
| D10 | P0 | `cmms.html:122-123` | H1: "Join the FactoryLM Beta" — asking for commitment above fold. Subhead: "Then decide" — dead weight. | Lead with promise: "See AI diagnose your first fault code in 60 seconds." |
| D11 | P1 | `cmms.css:180-194` | Amber-gradient-clipped `<em>` text is the most AI-generated look of 2024-25. | Replace with solid `var(--amber)` or an underline swipe. Keep the weight, lose the template feel. |
| D12 | P1 | `cmms.html:204-210` | Live ticker is below the signup form. Social proof should render before the ask. | Move ticker above/beside the form. Also verify ticker doesn't stream fake data at visible users. |
| D13 | P1 | `cmms.html:212-271` | Entire `.dashboard` section is in the DOM, hidden via `display:none`. Inflates initial HTML from ~15KB to ~30KB for every anonymous visitor. | Split into a separate `/cmms/app` route served only after auth. |
| D14 | P1 | `cmms.html:135-138` | First name field comes after company. Wrong cognitive order. | Reorder: first name → email → company. |
| D15 | P1 | `cmms.html:183-186` | `.seo-section` has the compelling numbers ("20-40 min per fault", "50-70% of CMMS implementations fail") buried below the fold. | Promote these above the fold as proof stats. |
| D16 | P1 | `cmms.html:140-143` | CTA: "Join the Beta" — generic and mismatched with the hero verb. | If hero says "See how it works" → button says "Watch the 3-min demo". |
| D17 | P2 | `cmms.html:113` | Topbar shows `topbar-user` span but no "Sign in" link for returning users. | Add "Sign in" link for returning active tenants. |
| D18 | P2 | `cmms.css:156-178` | Hero has BOTH a radial amber glow `::before` AND a blueprint grid `::after`. Two visual treatments fighting. | Pick one. Blueprint grid belongs on technical surfaces (dashboard), not the hero. |
| D19 | P2 | `cmms.css:67-76` | Noise grain overlay at `opacity: 0.025` with `z-index: 9999`. Invisible on OLED, blurs fine text on LCD. | Drop or demote `z-index` below content. |
| D20 | P2 | `cmms.css:3` | Loading DM Sans variable + IBM Plex Mono with 11 weights/variants. Heavy. | Drop italic and 800, keep 400/500/700. Saves ~60KB. |

### activated.html — Post-payment (WIP, untracked in git)
- **Good:** Corner registration marks, Plex Serif accent, `noindex,nofollow`, blueprint grid with gradient mask. Most distinctive design in the project. This is the aesthetic the marketing pages should steal from.
- **F1 (P0) from live crawl:** Despite this file existing with polished design, the LIVE `/activated` URL serves `/cmms` content. Either the file isn't deployed or the route isn't wired. **Verify routing in `mira-web/src/server.ts`.**

### Email templates — quick scan
- `beta-welcome.html` — Clean table layout, DM Sans import (Gmail strips anyway), single amber accent. Credible. Missing: preheader text, plain-text alt.
- `beta-payment.html:68` — Amber button with `border-radius:4px`. Works in Outlook. Missing VML fallback for old Outlook (minor). `{{FIRST_NAME}}` + `{{CHECKOUT_URL}}` placeholders confirmed.
- **All templates:** No `<meta name="color-scheme" content="dark light">`. Gmail dark mode auto-inverts and can break amber-on-black scheme. Add color-scheme meta and test in Litmus.

---

## 3. Accessibility issues — WCAG 2.2 AA

| # | Sev | Finding | Source | Fix |
|---|---|---|---|---|
| A1 | P0 | **Homepage has no `<main>` landmark.** Blog pages also missing. Only `/cmms` + `/activated` have it. | Live crawl `has_main: false` on `/`, `/blog`, all blog posts | Wrap the hero + feature sections in `<main>` on `index.html` and `/blog` template. |
| A2 | P1 | **`--text-muted #7a766c` on `--surface-2 #171715` ≈ 3.4:1** — fails AA for normal text. Used for all form labels, metadata, timestamps. | `cmms.css:29-30` | Bump to `#9a968c` (~4.7:1) or similar. |
| A3 | P1 | **`--text-faint rgba(255,255,255,0.28)` on `#0d0e11` ≈ 3.0:1** — fails AA. | `index.html:62-64`, used at 688, 791, 1033 | Raise opacity floor to 0.4. |
| A4 | P1 | **Form error uses `display: none → block` with no `aria-live`.** Screen readers never hear errors. | `cmms.html:244-249` | Add `role="alert" aria-live="polite"` to `#form-error`. |
| A5 | P1 | **`prefers-reduced-motion` not respected on pulse animations.** | `index.html:352 .cta-start-pulse`, `index.html:517 .demo-cursor` | Wrap in `@media (prefers-reduced-motion: no-preference)`. |
| A6 | P2 | **Hero demo container has `aria-hidden="true"` wrapping a `role="img"` child.** Conflicting semantics. | `index.html:795-796` | Drop `aria-hidden` on outer container. |
| A7 | P2 | **Chat input has inline `onkeydown` handler but no `aria-label`.** | `cmms.html:260` | Add `aria-label="Ask Mira a question"`. |
| A8 | P2 | **`direction: rtl` grid trick for feature reverse layout** confuses screen readers. | `index.html:547-555` | Use `grid-template-areas` instead. |
| A9 | P2 | **Blog posts lack `<main>` landmark** (14 pages affected). | Live crawl | Fix in blog template in `mira-web/src/lib/blog-renderer.ts` or wherever blog HTML is assembled. |

---

## 4. SEO issues

| # | Sev | Finding | File:Line | Fix |
|---|---|---|---|---|
| S1 | P0 | **Fabricated JSON-LD aggregateRating** (same as D9) | `cmms.html:34-47` | Delete `aggregateRating` property. |
| S2 | P1 | **index.html title is 34 chars.** "FactoryLM — Industrial AI Maintenance" — too short, not keyword-loaded. | `index.html:23` | Expand to 50-60: "FactoryLM — AI Fault Code Diagnosis & CMMS for Maintenance Teams" (64 chars). |
| S3 | P1 | **cmms.html title is 68 chars.** Over the 60-char Google cutoff. | `cmms.html:6` | Trim: "AI Fault Code Diagnosis for Maintenance Teams — FactoryLM" (57). |
| S4 | P1 | **index.html meta description is 139 chars**, under the 150-160 sweet spot. | `index.html:6` | Add "Join the beta — 50 spots left." to fill. |
| S5 | P1 | **No SoftwareApplication or Product schema on index.html.** Has only Organization + WebSite. | `index.html:25-42` | Add SoftwareApplication schema (see `cmms.html:24-48` for reference, minus the fake ratings). |
| S6 | P1 | **Viewport meta inconsistency.** Homepage + blog: `width=device-width, initial-scale=1.0, viewport-fit=cover`. `/cmms` + `/activated`: missing `viewport-fit=cover`. On notched iPhones, `/cmms` renders with awkward safe-area gaps. | Live crawl | Unify viewport meta in cmms.html and activated.html. |
| S7 | P2 | **`/activated` canonical points to `/cmms`** — self-declares as not its own URL. If `/activated` is meant to be a real page, its canonical should be `/activated`. | Live crawl + source | Decide whether `/activated` is (a) a distinct post-payment page (fix canonical) or (b) a legacy alias (add 301 redirect). |

All crawled pages have: description, og:title, og:description, og:image, twitter:card, canonical. Meta coverage is actually strong — matches the 7/10 SEO score in project memory.

---

## 5. Performance & tech hygiene

| # | Sev | Finding | File:Line | Fix |
|---|---|---|---|---|
| T1 | P1 | **index.html has ~680 lines of inline `<style>`** (~22KB per HTML request, defeats caching) | `index.html:52-731` | Extract to `/public/index.css`. Keep only critical above-the-fold CSS inlined (~3KB). |
| T2 | P1 | **cmms.html has ~440 lines of inline JavaScript** | `cmms.html:281-718` | Extract to `/public/cmms.js`. Enables browser caching. |
| T3 | P1 | **Lucide CDN loaded unpinned as `@latest`** — third-party, render-blocking, no SRI. | `cmms.html:99` | Replace with 3-4 inline SVGs for the icons actually used (factory, zap, check). |
| T4 | P1 | **Google Fonts blocking render** on index.html (Inter) and cmms.html (DM Sans + Plex Mono) | `index.html:45-47`, `cmms.html:3` | Self-host via `/public/fonts/` with `font-display: swap`. Removes third-party TLS handshake + saves ~60KB. |
| T5 | P2 | **1 blocking script in `<head>`** on `/cmms` and `/activated` (no async/defer). | Live crawl + `cmms.html` | Add `defer` attribute or move to end of `<body>`. |
| T6 | P2 | **Ticker `setInterval` runs every 6s forever**, even when tab is backgrounded. | `cmms.html:468-486` | Pause when `document.visibilityState === 'hidden'`. |
| T7 | P2 | **Inline base64 SVG noise** is ~2KB, applied twice. | `cmms.css:66-76` | Extract to `/public/img/noise.png` or `noise.svg`. |

---

## 6. Route inventory — for reference

### Publicly crawlable (no auth)
- `GET /` → `public/index.html` (homepage)
- `GET /cmms` → `public/cmms.html` (beta landing + signup form)
- `GET /activated` → **broken, serves cmms.html content** (see F1)
- `GET /blog` → blog index
- `GET /blog/fault-codes` → fault code library index
- `GET /blog/:slug` → 8 blog posts + 49 fault code articles (57 total)
- `GET /demo/work-orders` → JSON ticker (no auth) — empty HTML in crawl
- `GET /api/health` → liveness probe (JSON)
- `GET /api/checkout` → unauthenticated redirect to Stripe Checkout (requires `tid` + `email` query)

### Auth-gated (skipped by crawler)
- `GET /api/me` — requireActive
- `GET /api/quota` — requireActive
- `GET /api/billing-portal` — requireAuth
- `GET /demo/tenant-work-orders` — requireActive

### POST / webhook (not crawled)
- `POST /api/register` — signup form target
- `POST /api/stripe/webhook` — Stripe event handler
- `POST /api/ingest/manual` — PDF upload proxy (requireActive)
- `POST /api/mira/chat` — AI chat SSE (requireActive)

### Static assets
- `/robots.txt` ✅
- `/sitemap.xml` ✅ (dynamically generated, includes all blog + fault code slugs)
- `/og-image.png` ✅
- `/og-image.svg` ❌ **404**
- `/manifest.json` ✅ (PWA)
- `/sw.js` ✅ (service worker)

### Blog posts (8 confirmed public)
- `how-to-read-vfd-fault-codes`
- `predictive-vs-preventive-maintenance`
- `how-to-megger-test-a-motor`
- `common-allen-bradley-plc-faults`
- `understanding-4-20ma-signals`
- `vfd-troubleshooting-checklist`
- `why-your-air-compressor-keeps-shutting-down`
- `what-is-cmms`

### Fault code articles (49 confirmed public)
Allen-Bradley (3), PowerFlex (7), GS20 (6), Fanuc (4), Siemens (4), ABB ACS880 (3), Yaskawa (3), Compressor (3), Hydraulic (2), Motor (2), Pump (2), Conveyor (2), Micro820 (2), plus standalone (~11) — see `mira-web/src/lib/blog-renderer.ts` `FAULT_CODES` array for canonical list.

---

## 7. Prioritized fix list — merged

### P0 — ship this week
| # | File:Line | Issue | Est |
|---|---|---|---|
| F1 | `mira-web/src/server.ts` + `public/activated.html` | **Fix `/activated` routing.** Currently serves `/cmms` content. Post-payment users see the same signup form after paying. | 30 min |
| D9/S1 | `cmms.html:34-47` | **Delete fabricated `aggregateRating` from JSON-LD.** Google manual-action risk. | 2 min |
| D1 | `index.html:768-772` | Rewrite H1 to lead with concrete outcome (time/specificity) | 15 min |
| D10 | `cmms.html:122-123` | Rewrite cmms hero — promise first, not "join the beta" commitment ask | 15 min |
| A1 | `index.html` + blog template | Add `<main>` landmark to homepage + blog pages | 15 min |
| F2 | all pages | **Identify the repeating 404** console error in DevTools, fix the missing resource | 15 min (investigation) |
| T4 | Homepage | **Add a primary CTA button to `/`.** Currently all text links. Direct funnel friction. | 10 min |

**P0 total: ~2 hours of work.** Ship before the GTM sprint launches.

### P1 — hurts conversion / credibility
| # | File:Line | Issue | Est |
|---|---|---|---|
| D3 | `index.html:795-829` | Replace fake chat demo with real Loom GIF/iframe/screenshot | 2 hr |
| — | both pages | Unify on one design system (pick Inter or DM Sans, one palette, grain-or-no-grain) | 4 hr |
| D4 | `index.html:835-970` | Add 1-3 customer quotes/logos (synthetic pilot OK) | varies |
| T1 | `index.html:52-731` | Extract inline CSS to `/public/index.css` | 30 min |
| T2 | `cmms.html:281-718` | Extract inline JS to `/public/cmms.js` | 20 min |
| T3 | `cmms.html:99` | Replace Lucide CDN with inline SVGs | 20 min |
| T4 | both | Self-host fonts | 1 hr |
| D12 | `cmms.html:204-210` | Move live ticker above signup form | 15 min |
| D13 | `cmms.html:212-271` | Split dashboard HTML to separate `/cmms/app` route | 1 hr |
| D2 | `index.html:774-777` | Rewrite subhead to end on outcome | 10 min |
| D11 | `cmms.css:180-194` | Drop amber-gradient `<em>` effect | 5 min |
| A2 | `cmms.css:29-30` | Fix `--text-muted` contrast to pass WCAG AA | 5 min |
| A3 | `index.html:62-64` | Fix `--text-faint` contrast | 5 min |
| A4 | `cmms.html:244-249` | Add `aria-live` to form error | 2 min |
| S2 | `index.html:23` | Expand title to 50-60 chars with keywords | 5 min |
| S3 | `cmms.html:6` | Trim title to ≤60 chars | 5 min |
| S4 | `index.html:6` | Extend meta description to 150-160 chars | 5 min |
| S5 | `index.html:25-42` | Add SoftwareApplication schema (no fake ratings) | 10 min |
| S6 | `cmms.html` + `activated.html` | Unify viewport meta with `viewport-fit=cover` | 2 min |
| A9 | blog template | Add `<main>` landmark to blog posts | 15 min |
| D14 | `cmms.html:135-138` | Reorder form fields: first name → email → company | 5 min |
| D15 | `cmms.html:183-186` | Promote "20-40 min per fault" numbers above the fold | 15 min |

**P1 total: ~12-15 hours of work.**

### P2 — polish
| # | File:Line | Issue |
|---|---|---|
| D5, D6 | `index.html` | Bump hero font-weight to 600-700, body to 400 |
| D7 | `index.html:85-93` | Amber radial gradient opacity choice |
| D8 | `index.html:850-851` | "≤800ms first token" → plain English |
| D18 | `cmms.css:156-178` | Pick amber glow OR blueprint grid, not both |
| D19 | `cmms.css:67-76` | Drop or demote noise grain z-index |
| D20 | `cmms.css:3` | Drop italic + 800 from Google Font request |
| A5 | `index.html:352, 517` | Respect `prefers-reduced-motion` on pulse animations |
| A6 | `index.html:795-796` | Fix `aria-hidden` + `role="img"` conflict |
| A7 | `cmms.html:260` | Add `aria-label` to chat input |
| A8 | `index.html:547-555` | Replace `direction: rtl` trick with `grid-template-areas` |
| T5 | `cmms.html` blocking script | Add `defer` or move to body end |
| T6 | `cmms.html:468-486` | Pause ticker when tab hidden |
| T7 | `cmms.css:66-76` | Extract inline base64 noise |
| F3 | `/og-image.svg` | Dangling 404 |
| — | all email templates | Add `<meta name="color-scheme" content="dark light">` |
| F4 | `/demo/work-orders` | Verify whether JS hydration is expected |

---

## 8. Deferred / out of scope

- `mira-web/src/server.ts` — server-side logic not audited as functional target
- `app.factorylm.com` — different service (SaaS app, not marketing)
- `cmms.factorylm.ai` — Atlas CMMS frontend
- Stripe Checkout page — third-party
- Loom embed content — third-party
- External CDNs (Google Fonts, unpkg) — noted as fix targets but not themselves audited

---

## 9. How to re-run this audit

```bash
cd C:/Users/hharp/Documents/MIRA/tools/audit
uv run --with playwright python crawl.py
# outputs:
#   findings.md        — human-readable
#   findings.json      — raw data
#   screenshots/*.png  — 40 files (desktop + mobile per page)
```

The script is idempotent, reads from `SEED_URLS` constant, respects 1.5 req/s rate limit, and will NOT submit forms.

---

_Generated 2026-04-10 by three-source audit: route inventory (Explore agent), source critique (general-purpose agent), live Playwright crawl (general-purpose agent). Aggregated by Claude Opus 4.6 from the three subagent outputs._
