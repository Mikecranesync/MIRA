# factorylm.com Marketing Site — Demo Readiness Audit

**Date:** 2026-06-05  
**Auditor:** Claude (Sonnet 4.6) on CHARLIE node  
**Scope:** `mira-web` (Hono/Bun) serving `https://factorylm.com`  
**Method:** Code inspection + live GET/HEAD probes; no mutations against prod.

---

## 1. Route Inventory & Live Status

All routes enumerated from `mira-web/src/server.ts` (lines 1–30 comment block) and probed live.

| Path | Live Status | Renders? | Real or Stub | Demo Verdict | Category |
|------|-------------|----------|--------------|--------------|----------|
| `/` | 200 | Yes | Real | READY | — |
| `/pricing` | 200 | Yes | Real | READY | — |
| `/assess` | 200 | Yes | Real — but Chart.js blocked by CSP | BROKEN IN BROWSER | **DEMO_BLOCKER** |
| `/cmms` | 200 | Yes | Real (magic-link sign-in form) | READY | — |
| `/buy` | 200 | Yes | Real (purchase landing) | READY | — |
| `/limitations` | 200 | Yes | Real | READY | — |
| `/security` | 200 | Yes | Real | READY | — |
| `/blog` | 200 | Yes | Real (10 posts, 53 fault codes) | READY | — |
| `/blog/fault-codes` | 200 | Yes | Real (53 fault codes indexed) | READY | — |
| `/sample` | 200 | Yes | **Stub** — "workspace will appear here once Phase 1 ships" | STUB | NICE_TO_HAVE |
| `/privacy` | 200 | Yes | Real | READY | — |
| `/terms` | 200 | Yes | Real | READY | — |
| `/trust` | 200 | Yes | Real | READY | — |
| `/sitemap.xml` | 200 | Yes | Real (dynamic) | READY | — |
| `/llms.txt` | 200 | Yes | Real | READY | — |
| `/llms-full.txt` | 200 | Yes | Real | READY | — |
| `/robots.txt` | 200 | Yes | Real | READY | — |
| `/status` | 200 | Yes | Real | READY | — |
| `/api/health` | 200 | JSON | Real | READY | — |
| `/signup` | 301 → `app.factorylm.com/signup` → 200 | Yes | Redirects to Hub registration | Works but confusing | NICE_TO_HAVE |
| `/qr-test` | 200 | Yes | Real (sales/demo tool) | READY | — |
| `/feature/fault-diagnosis` | 200 | Yes | Real | READY | — |
| `/feature/cmms-integration` | 200 | Yes | Real | READY | — |
| `/feature/voice-vision` | 200 | Yes | Real | READY | — |
| `/feature/mira-ai` | 404 | — | Route not registered | — | — |
| `/m/:asset_tag` | Auth-gated | QR scan entry | Real | — | — |
| `/admin/qr-print` | Admin-only | Admin page | Real | — | — |
| `/admin/qr-analytics` | Admin-only | Admin page | Real | — | — |

---

## 2. Home Page (`/`)

**Status: LOADS CLEANLY. One messaging conflict is a DEMO_BLOCKER.**

### What works
- Hero renders: "FactoryLM — Turn your maintenance reality into AI-ready infrastructure." Messaging is coherent and professional.
- Three-tier project-card row matches NORTH_STAR.md and STRATEGY.md exactly: Assessment $500, Pilot $2–5K/mo, Operating Layer $499/mo.
- Hero image (`/images/hero-fault-lookup-cartoon.jpg`) returns 200 — renders in browser.
- Compare block (Generic AI vs MIRA on a namespace) is compelling and accurate.
- Cartoon row animates via `/feature-cartoons.js` (deferred; 200).
- No lorem ipsum, no TODO/FIXME visible in rendered HTML.
- Responsive: viewport meta is present (`width=device-width, initial-scale=1`), mobile sticky CTA fires at ≤720px (`@media (max-width: 720px)`), grid collapses to 1-column — `mira-web/src/views/home.ts` lines 325–354.

### DEMO_BLOCKER — Hero and pricing page tell different stories (Mike must decide which is current truth)

Facts:
- **Hero primary CTA (line 99):** "Try MIRA Free →" → `/signup` → 301 → `app.factorylm.com/signup`
- **`app.factorylm.com/signup` (live, verified):** A real "Create Account" page — email+password + Google OAuth, no payment step. A free Hub account genuinely exists.
- **Hero sub-text (line 102):** "7-day free trial, no credit card. Or book a $500 in-person assessment and skip the trial."
- **Topbar CTA:** "Get Started" → `/buy` (no mention of free account)
- **Pricing page:** Three paid offers only — no free tier, no trial mentioned anywhere.

**On camera, a viewer sees:** "free trial" on the hero → clicks pricing → no free tier. They will ask "so what does 'free' actually get me?" and there is no answer on the marketing site.

**Two valid fixes — Mike's call:**
1. If the free Hub account is the on-ramp: add a note to the pricing page ("Free Hub account available — no credit card") and make the hero copy describe what you actually get free.
2. If the current model is assessment-only: change hero CTA to "Book Your Assessment →" (`/buy`), remove "7-day free trial" sub-text, update mobile sticky CTA. The pricing page is already correct for this model.

The inconsistency itself is the blocker — not which direction is right.

---

## 3. Pricing Page (`/pricing`)

**Status: ACCURATE. Pricing matches strategy. Professionally designed.**

Tiers displayed:
| Tier | Price Shown | NORTH_STAR.md / STRATEGY.md | Match? |
|------|-------------|------------------------------|--------|
| Assessment | $500 one-time | $500 | ✅ |
| Pilot | $2–5K/mo · 3-mo min | $2K–5K/mo, 3-month minimum | ✅ |
| Operating Layer | $499/mo per plant | $499/mo | ✅ |

- Assessment card is correctly marked "Most popular" (featured) — it's the wedge offer.
- Comparison table (Generic AI vs FactoryLM), FAQ section, and footer all clean.
- Dark theme design is polished and camera-ready.
- Mobile: nav links hidden at ≤640px (`@media (max-width: 640px) { .nav-links { display: none; } }` — `pricing.html` line 87); main CTA still visible.
- No old $97/mo pricing anywhere on this page.
- FAQ references `/assess` with a working link.

---

## 4. Assess Page (`/assess`)

**Status: FUNCTIONAL LOGIC — BUT RADAR CHART WILL NOT RENDER DUE TO CSP MISMATCH.**

### What works
- The 20-question scorecard is fully implemented in client-side JavaScript (pure HTML file, 693 lines).
- 6 dimensions (Data & Documentation, Work Order Management, Preventive Maintenance, Asset Intelligence, Knowledge Sharing, Technology Readiness) with benchmarks.
- Radar chart via Chart.js, results table, tier badges (Foundational → Leading), top-3 next-steps playbook.
- Progress bar, back/forward navigation, `localStorage` persistence across page reloads.
- CTA at end: "Book Your Assessment — $500 →" → `/buy`. Correct.
- Print/PDF button, retake button.
- Mobile: `@media (max-width: 600px)` responsive tweaks present.
- No forms POST — purely client-side computation. Safe on prod.
- `assess.html` line 26: `<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>`

### DEMO_BLOCKER — Chart.js blocked by Content Security Policy
The production nginx CSP (verified live via `curl -sI https://factorylm.com`):
```
script-src 'self' 'unsafe-inline' https://unpkg.com https://js.stripe.com https://us-assets.i.posthog.com
```
`cdn.jsdelivr.net` is **not in the allowlist**. Modern browsers (Chrome, Safari, Firefox) will block the Chart.js load. The radar chart — the primary visual deliverable of the assessment — will silently fail to render. The results page shows a blank canvas where the radar should be. This is broken in every browser with CSP enforcement.

**Fix:** Add `https://cdn.jsdelivr.net` to `script-src` in the nginx config, OR switch `assess.html` line 26 from `cdn.jsdelivr.net` to `unpkg.com` (which is already whitelisted):
```html
<script src="https://unpkg.com/chart.js@4.4.1/dist/chart.umd.min.js"></script>
```

### Minor — Broken footer link
`assess.html` line 274: `<a href="/privacy.html">Privacy</a>`  
`/privacy.html` returns **404**. The correct route is `/privacy` (no `.html` extension).

---

## 5. CMMS Page (`/cmms`)

**Status: READY — clean magic-link sign-in landing.**

- Renders a form (email input → POST `/api/magic-link` → sends sign-in link to email).
- Messaging: positioned as the sign-in page for paying subscribers. Appropriate.
- No "Join the Beta" language visible.
- Relevant for demos where you want to show the authenticated product path.

---

## 6. SSL Certificate

**Status: VALID. Expiry in 83 days — schedule renewal before August 27.**

```
notBefore=May 29 23:54:13 2026 GMT
notAfter=Aug 27 23:54:12 2026 GMT
issuer=Let's Encrypt / YE1
subject=CN=factorylm.com
```

- HSTS present with `max-age=63072000; includeSubDomains; preload`.
- HTTP/2 served via nginx/1.24.0.
- Security headers present: `X-Content-Type-Options`, `X-Frame-Options: SAMEORIGIN`, `X-XSS-Protection`, `Referrer-Policy`.
- Cert expires 2026-08-27. Auto-renewal (certbot) should handle it, but confirm before any major demo or press event in late August.

---

## 7. Mobile Responsiveness

**Status: ADEQUATE. Not camera-ready on mobile without testing one blocker.**

- Viewport meta: present on all server-rendered pages (`mira-web/src/lib/head.ts`).
- Home: responsive CSS in `home.ts` — hero collapses, 3-column grid goes 1-column at ≤720px, mobile sticky CTA fires at bottom.
- Pricing: grid collapses at ≤760px; nav links hidden at ≤640px (CTA still visible).
- Assess: `@media (max-width: 600px)` tweaks applied.
- The static HTML pages (`pricing.html`, `assess.html`, `buy.html`) each have independent CSS — no shared design system. Visual consistency is acceptable but not pixel-perfect across pages.
- **Unverified live:** A Playwright screenshot was not taken (no browser tool available in this session). Code inspection only. Recommend a manual phone check before going on camera.

---

## 8. Broken Links

| Link | Found In | Status | Issue |
|------|----------|--------|-------|
| `/privacy.html` | `assess.html` line 274 (footer) | 404 | Should be `/privacy` |
| `/signup` (home hero + mobile CTA) | `home.ts` lines 99, 507 | 301 → Hub signup (real, 200) | Hero says "free trial"; pricing says no free tier — inconsistent |
| `href="#"` (stop-card CTAs in hero) | `home.ts` components | No destination | Acknowledge/Call supervisor buttons are dead. Not visible on home page (feature strip section) |

Internal navigation links from the navbar (`/cmms`, `/pricing`, `/blog`, `/limitations`, `/security`, `/buy`) all return 200. Footer links (`/limitations`, `/trust`, `/privacy`, `/terms`) all return 200.

---

## 9. Prioritized DEMO_BLOCKER List

### BLOCKER 1 — `/assess` radar chart silently broken (CSP blocks Chart.js)
**Impact:** The scorecard's primary visual — the radar chart showing 6-dimension scores vs. benchmark — does not render in any modern browser. The results page shows a blank white rectangle. If the assessment is part of the demo ("hand the prospect your phone"), the most compelling moment is broken.  
**Fix:** Change `assess.html` line 26 from `cdn.jsdelivr.net` to `https://unpkg.com/chart.js@4.4.1/dist/chart.umd.min.js` (already in CSP whitelist). One-line change, no redeploy of the nginx config needed.  
**File:** `mira-web/public/assess.html:26`

### BLOCKER 2 — Home page hero CTA and pricing page tell different stories (needs Mike to decide which is live)
**Impact:** On camera, a viewer reads the hero: "Try MIRA Free → 7-day free trial, no credit card." Then they hit `/pricing`: three paid offers, no free tier. Then they might click "Get Started" (topbar) → `/buy` → also no free tier. The question "do I get a free trial or not?" is unanswered.

**What is actually true:**
- `app.factorylm.com/signup` returns 200 and renders a real "Create Account" form (email+password + Google OAuth, no payment step visible). A free Hub account exists.
- `mira-web/CLAUDE.md` line 7 says "No free tier. Pricing hidden until Day 7 email." — but this file describes a stale `$97/mo` self-serve model that is no longer on the pricing page, so the CLAUDE.md itself may be stale.
- The current pricing page shows Assessment/Pilot/Operating Layer only — no mention of a free tier or trial.

**This is a Mike decision, not a one-line fix.** Two valid directions:
1. **Free Hub account is the trial** → update the pricing page to mention it; align hero copy with what the Hub account actually gives you.
2. **No free tier** → change the hero CTA to "Book Your Assessment →" (`/buy`) and remove "7-day free trial, no credit card" sub-text.

**Either way, the inconsistency is visible on camera and needs resolution before demo day.**  
**Files:** `mira-web/src/views/home.ts:99,102,507`; `mira-web/public/pricing.html` (if adding free-tier mention)

---

## 10. Nice-to-Have / Future

| Item | Category | Notes |
|------|----------|-------|
| `/sample` stub copy ("workspace will appear here once Phase 1 ships") | NICE_TO_HAVE | Visible to any signed-in user; on camera it reads as an unfinished product. Replace with a more forward-looking CTA or hide the route from non-paying users. `mira-web/src/views/cmms.ts:414` |
| `/privacy.html` broken link in assess footer | NICE_TO_HAVE | `assess.html:274` — change to `/privacy` |
| SSL cert expires 2026-08-27 | NICE_TO_HAVE | Confirm certbot auto-renewal is active |
| `href="#"` stop-card acknowledge/call buttons | FUTURE | `home.ts` component; not demo-visible but would 404 if clicked from a feature page |
| `href` on stop-card CTA | FUTURE | Not visible on homepage proper (feature strip renders state-badges and a stop-card but the buttons don't appear in the current hero flow) |
| No `alt` text on og-image | FUTURE | Minor accessibility |

---

## Summary Table

| Finding | Severity | Fix Complexity | File |
|---------|----------|----------------|------|
| Chart.js CSP mismatch → radar blank on /assess | DEMO_BLOCKER | 1-line fix | `assess.html:26` |
| Hero "7-day free trial" vs pricing page with no free tier — Mike must decide | DEMO_BLOCKER | Decision → copy change | `home.ts:99,102,507` |
| `/privacy.html` 404 in assess footer | NICE_TO_HAVE | 1-line fix | `assess.html:274` |
| `/sample` stub copy exposed to signed-in users | NICE_TO_HAVE | Messaging change | `cmms.ts:414` |
| SSL cert expiry 2026-08-27 | MONITOR | Confirm certbot | nginx/certbot |
