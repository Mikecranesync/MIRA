# mira-web CHANGELOG

All notable changes to `mira-web` (the FactoryLM PLG acquisition + beta onboarding funnel) are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) with
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Tags are scoped
to the component (`mira-web/vX.Y.Z`) so they don't collide with the MIRA
monorepo's top-level tag progression.

## [0.5.2] — 2026-05-03

### Fixed
- **Service worker was masking the v0.5.0 + v0.5.1 deploys.** Returning
  visitors saw the old topbar, white edges, and dead sun-toggle even
  after both PRs landed in production because `sw.js` is cache-first
  for static assets and `CACHE_NAME` had been pinned at `factorylm-v3`
  since the SW was introduced. Bump to `factorylm-v4` triggers the
  activate handler's `caches.delete()` for every key !== current name,
  forcing all CSS/JS to re-fetch on next page load. Also adds
  `_dark-theme.css` and `_components.css` companions `_dark-theme.css`
  and `sun-toggle.js` to `PRECACHE_URLS` so future first-load visitors
  get them up front instead of opportunistically.

  CACHE_NAME bumps need to ship every time a CSS/JS asset under
  `/public` changes — added a TODO comment in `sw.js` so future
  edits don't repeat the trap.

## [0.5.1] — 2026-05-03

### Fixed
- **White viewport edges around dark pages.** `_dark-theme.css` only
  painted the `<body>` background; the `<html>` element kept its UA
  default white. When body content was shorter than the viewport, the
  unpainted html element bled through as a white strip on the right
  and bottom edges (visible on `/cmms`, `/limitations`, `/security`
  in the v0.5.0 production screenshots). Fix paints `<html>` with the
  same `#09090c` and adds `min-height: 100vh; margin: 0` to body so
  it always fills the viewport.
- **Sun-readable toggle button did nothing.** `sun-toggle.js` defined
  `window.flToggleSun` but never attached a click listener to the
  `#fl-sun-toggle` button — it has been a dead button on every page
  shipping it. Fix adds an `addEventListener("click", flToggleSun)`
  in the existing `DOMContentLoaded` handler. Now toggles between the
  dark cartoon palette and the high-contrast `body.sun` outdoor mode
  (`#F0F0F0` bg, `#000` text, defined in `_tokens.css`).

## [0.5.0] — 2026-05-03

### Added
- **Shared topbar partial** at `mira-web/src/views/_topbar.ts` exporting
  `navbar({ currentPath, ctaPrefix })` and `footer({ ctaPrefix })`. Single
  source of truth for the four TS-rendered marketing views (home, cmms,
  limitations, security/sample). Per-page differences are limited to
  `aria-current="page"` and the `data-cta` analytics prefix.
- **23-test contract suite** (`src/views/__tests__/topbar.test.ts`)
  locking down link set, ordering, CTA copy, and per-page
  `aria-current` placement so the four views cannot drift apart again.

### Changed
- **`/limitations` and `/security` adopt the dark palette** by linking
  the v0.4.0 `_dark-theme.css` stylesheet — same single-line opt-in
  pattern used by `/cmms` and `/sample`. Closes the P1 row in the
  2026-05-03 style audit.
- **`/cmms` topbar gains the standard nav and CTA.** Previously
  `/cmms` had its own four-link nav (Home / Pricing / Limitations /
  Security) with no CTA; it now matches the home topbar exactly,
  with `aria-current="page"` on the CMMS link.

### Notes
- This release fixes 4 of the 6 topbar variants flagged in the
  2026-05-03 style audit. The remaining two — the M-icon-era topbar
  shared by the static HTML pages (`pricing.html`, `privacy.html`,
  `terms.html`, `trust.html`, `legal/dpa.html`) and the blog renderer
  (`blog-renderer.ts`) — require either converting the static pages
  to TS views or a build-time string-injection pass. Tracked as
  Phase 2 in the audit.

## [0.4.0] — 2026-05-03

### Added
- **Shared dark-theme stylesheet** at `mira-web/public/_dark-theme.css`
  carrying the FactoryLM design-token overrides (page bg, card surface,
  ink, amber accent) plus the dark-tinted `.fl-col-bad` /
  `.fl-col-good` overrides used by the ChatGPT-vs-MIRA compare blocks.
  Any view that wants to opt into the dark palette now includes a
  single `<link rel="stylesheet" href="/_dark-theme.css">` in its
  `<head>` — no per-component refactor needed because existing
  selectors reference the tokens via `var()`.

### Changed
- **`/cmms` and `/sample` adopt the dark palette.** This is the P0 fix
  from the 2026-05-03 style audit (`tools/web-review-runs/
  2026-05-03-style-audit/AUDIT.md`): `/cmms` is the conversion landing
  page every "Start Free — magic link" click on home led to, and the
  light-theme break in the funnel was the most visible inconsistency
  on the site after v0.3.1 shipped the dark hero. (`views/cmms.ts`)
- **`home.ts` no longer carries the dark-token block inline.** The
  duplicated CSS moved to `_dark-theme.css`; `home.ts` keeps only
  layout/typography styles unique to the home view. (`views/home.ts`)
- **`/_dark-theme.css` registered as a static route** alongside
  `_tokens.css` and `_components.css` in `src/server.ts`.

### Notes
- This intentionally does *not* touch `/limitations`, `/security`,
  `/pricing`, `/blog`, the legal stack, or `/activated` (which has its
  own bespoke dark theme via static HTML). Those are tracked in the
  audit as P1/P2 with separate fixes coming.

## [0.3.1] — 2026-05-03

### Fixed
- **`/images/*` static route was missing.** v0.3.0 shipped the new hero
  cartoon at `/images/hero-fault-lookup-cartoon.png`, but Hono's
  `serveStatic` registrations in `src/server.ts` only covered `/public/*`
  and a handful of explicit per-file paths — anything under `/images/`
  404'd. Same root-cause as the pre-existing
  `/images/app-screenshot-desktop.png` 404 flagged in PR #933. Adds
  `app.use("/images/*", serveStatic({ root: "./public" }))` so the
  conventional `/images/foo.png` path works without forcing a `/public/`
  prefix in markup. (`mira-web/src/server.ts`)

## [0.3.0] — 2026-05-03

### Changed
- **Landing-page hero is now the WITHOUT-MIRA / WITH-MIRA fault-lookup
  cartoon** instead of the placeholder work-orders screenshot. Marvel-style
  split-panel with thick diagonal divider, real Allen-Bradley PowerFlex 525
  F-012 = HW OverCurrent fault data, narration caption pitching "in a
  world where a cryptic fault code costs hours of downtime... when you
  can chat with your manuals, every tech becomes the 20-year tech." Same
  hero copy (h1/h2/h3/sub) and CTAs preserved — the cartoon is what the
  existing "Compound-interest knowledge for industrial maintenance"
  headline was always pointing at.
- New asset `mira-web/public/images/hero-fault-lookup-cartoon.png`
  (1792×1024, 3.2MB), copied from `marketing/cartoons/compound-interest/
  panel-3.png` so the source-of-truth panel still lives in the cartoon
  pipeline.
- `home.ts` hero `<img>` swap: `src` + `alt` + intrinsic dimensions
  updated; width/height match the actual file so CLS stays clean.
  `aria-hidden="true"` preserved (image is decorative; surrounding text
  carries the message for screen readers).

### Fixed
- **Production 404 on `/images/app-screenshot-desktop.png`** (flagged in
  PR #933 as a pre-existing issue) is incidentally resolved — the
  reference is gone.

## [0.2.1] — 2026-04-11

### Removed
- **Free tier from `/pricing`.** The shipped page advertised a Free tier
  with "10 queries/month" but no such tier state existed in the backend
  — `requireActive` middleware (`src/lib/auth.ts:87-111`) hard-blocks
  any non-`active` tier with HTTP 403, and `src/lib/quota.ts` Free-tier
  logic was dead code never called by any route. Matches the explicit
  "No free tier" intent in `mira-web/CLAUDE.md` and the Fihn beta-only
  strategy. Layout reflowed from 3-col to 2-col with `max-width: 720px`
  centering. `mira-web/public/pricing.html`.

### Added
- **14-day money-back guarantee** on both `$97` and `$297` pricing
  cards via a new `.card-footnote` utility class. Also surfaced as a
  FAQ entry and in all three meta descriptions (`name`, `og`, `twitter`).

### Changed
- `/pricing` nav CTA: `"Try Free"` → `"Get Started"`.
- `$297` card CTA: `"Contact us"` → `"Get MIRA Integrated"` (parallel
  structure to `$97`'s "Start with MIRA", matches the hero's
  "Published pricing, no 'contact sales.'" promise).
- `$97` card features list condensed from 8 bullets to 6 by merging
  "AI fault diagnosis via chat" + "Upload equipment manuals (cited OEM
  answers)" into a single bullet and dropping "Unlimited diagnostic
  queries" / "Unlimited users (site license)" (already in the card
  description — redundant).
- Money-back FAQ answer: dropped the conditional "if MIRA can't answer
  a fault code your team couldn't find on their own…" and kept the
  unconditional "cancel for any reason" promise.
- All three meta descriptions updated to drop "Free trial" language.
- `/api/health` version string: `"0.1.0"` → `"0.2.1"` (was stale since
  0.2.0 shipped — it reported 0.1.0 even when package.json was at 0.2.0).

### Fixed
- Pricing card height mismatch: the featured `$97` card was extending
  ~24 px below the `$297` card because only `$97` had the 14-day
  money-back footnote and the flex layout leaked the extra element past
  the `$297` bottom edge. Adding the same footnote to `$297` aligns
  both cards and reinforces the trust message on both tiers.

### Follow-up still needed (not in this release)
- `mira-web/public/index.html` — 4 "Try Free / 10 queries" references
  on the homepage (nav CTA, hero label, and dedicated "Try MIRA Free"
  section at lines 1238-1250).
- `mira-web/public/cmms.html` — interactive demo chat with a client-side
  fake 10-query limit (lines 578, 604 JS mock + line 462 post-signup
  copy + line 71 JSON-LD schema + line 136 button label). Requires a
  product decision on what replaces the "Try MIRA" demo (see #145 for
  the three options).
- MaintainX Premium price in the comparison table (currently shown as
  `$59/user/mo`) should be fact-checked against MaintainX's live pricing
  before the next marketing push — agent research surfaced `$65/user/mo`.

Investigation: https://github.com/Mikecranesync/MIRA/issues/145

## [0.2.0] — 2026-04-10

### Added
- **`GET /activated`** — single-purpose post-payment upload page served at
  `factorylm.com/activated?token=<JWT>`. Replaces the straight-to-dashboard
  handoff in the Stripe activation email ("moment of highest motivation" per
  Fihn strategy — capture the first-manual upload before the dashboard is
  shown). `mira-web/public/activated.html`, `mira-web/src/server.ts`.
- **`POST /api/ingest/manual`** — JWT-gated (`requireActive`) proxy that
  accepts a single PDF (50 MB cap, MIME allowlist) and forwards it to
  `mira-mcp:8001/ingest/pdf` with `MCP_REST_API_KEY` bearer auth.
  `mira-web/src/server.ts`.
- Industrial HMI design system for `/activated`: triple-typeface stack
  (IBM Plex Serif italic display + DM Sans body + IBM Plex Mono labels),
  orchestrated staggered entrance animation, corner registration marks,
  amber video-bay brackets, 20-segment fuel-gauge progress bar, LED status
  indicator with ready/working/ok/err states, cross-hair drop-zone marker,
  blueprint grid overlay, and a mono "[ OVERRIDE ] Skip to dashboard"
  fallback link.
- `LOOM_UPLOAD_URL` env var with server-side normalization: auto-converts
  Loom `/share/` URLs to `/embed/` (share URLs set `X-Frame-Options: deny`
  and cannot be iframed) and falls back to a static "Loom feed / awaiting
  signal" placeholder when unset or when the URL fails a basic safety
  regex. `mira-web/docker-compose.yml`, `mira-web/src/server.ts`.
- `MIRA_MCP_URL` env var (default `http://mira-mcp:8001`) so the ingest
  proxy target is overridable per deploy. `mira-web/docker-compose.yml`.
- `PUBLIC_URL`-aware activation link construction in `sendActivatedEmail`
  (`mira-web/src/lib/mailer.ts`) — replaces the previous hardcoded
  `https://factorylm.com`.

### Changed
- Activation email (`mira-web/emails/beta-activated.html`) retargeted
  around the upload-first flow: subject line, numbered steps, and CTA
  button (`"Upload your first manual"`) now point at `/activated?token=…`
  via a new `ACTIVATED_URL` template variable.

### Security
- `/api/ingest/manual` enforces `requireActive` middleware — only tenants
  with `tier='active'` in NeonDB can hit the proxy.
- URL normalization regex on `LOOM_UPLOAD_URL` rejects values containing
  whitespace, quotes, or angle brackets (prevents HTML injection via the
  env var into the rendered iframe).

### Deploy notes
- VPS `/opt/mira/mira-web/` requires a `.env` file with the Doppler-sourced
  secrets (`PLG_JWT_SECRET`, `NEON_DATABASE_URL`, `MCP_REST_API_KEY`, etc.)
  — previous deploys hydrated these out-of-band and did not persist them.
- After `docker compose up -d --build mira-web` on the VPS, run
  `docker network connect mira_mira-net mira-web` so the ingest proxy can
  reach `mira-mcp-saas` via the `mira-mcp` service alias. This network
  attachment is NOT in the compose file (intentionally, to avoid breaking
  dev hosts that don't run the SaaS stack) and must be re-applied after
  any container recreation.

## [0.1.0] — 2026-04-08 (initial)

Initial scaffold of the PLG acquisition funnel — Hono on Bun, JWT auth via
`jose`, NeonDB tenant tracking, Stripe Checkout + webhook + Customer
Portal, Resend email drip scheduler, Atlas CMMS integration, Mira AI chat
proxy to `mira-sidecar`, blog + fault-code library routes, dynamic sitemap.
