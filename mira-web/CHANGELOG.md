# mira-web CHANGELOG

All notable changes to `mira-web` (the FactoryLM PLG acquisition + beta onboarding funnel) are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) with
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Tags are scoped
to the component (`mira-web-vX.Y.Z`) so they don't collide with the MIRA
monorepo's top-level tag progression.

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
