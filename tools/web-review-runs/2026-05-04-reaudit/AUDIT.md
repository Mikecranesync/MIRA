# factorylm.com / app.factorylm.com — re-audit 2026-05-04

**Method.** Interaction-driven crawl: Playwright clicks every button + drills every menu (capped 50 / page) on 12 routes (8 apex, 4 app subdomain), desktop + mobile on 5. Plus Lighthouse on 6 apex routes, security headers via curl on both hosts, and edge probes (sitemap / robots / 404 / API surface).

**Baseline.** [`tools/web-review-runs/2026-05-03-style-audit/AUDIT.md`](../2026-05-03-style-audit/AUDIT.md) (style audit, 8 findings) + [`wiki/reviews/2026-05-03-factorylm.com.md`](../../../wiki/reviews/2026-05-03-factorylm.com.md) (canary, 7 findings).

**Crawl stats.** 17 page-views, 335 clickables enumerated, 317 interactions executed, 112 broken-interaction records (excluding the persistent SVG warning, see "Persistent baseline noise" below).

---

## Verdict

**Trajectory: mixed → regressing.** The visual fixes from 2026-05-03 mostly landed (dark theme + unified topbar on the funnel). But the interaction crawl surfaces **11 new regressions** that the static style-audit + canary couldn't see, and **4 of the original baseline findings are still in production**. Net: the customer-facing surface is *prettier* but *more broken* than it was on 2026-05-03.

| | 2026-05-03 baseline | 2026-05-04 result |
|---|---|---|
| Style-audit findings | 2 P0, 2 P1, 3 P2 categories, 1 P3 | **3 fixed** ✅, **3 still broken** ⚠️, **1 deferred** ➖ |
| Canary findings | 1 P1, 5 P2, 1 P3 | **2 partly fixed** ✅, **5 still broken** ⚠️ (contrast got *wider*) |
| Interaction failures | (not measured) | **11 new regressions** 🆕 |

---

## ✅ Fixed (3)

| # | Was | Route | PR / commit | Evidence |
|---|---|---|---|---|
| F1 | P0 light `/cmms` | `factorylm.com/cmms` | #939 v0.4.0 | Loads with dark `#09090c` bg + amber CTA `#f0a000`. See `desktop/apex-cmms.png`. Initial-load console clean (only the persistent SVG `<rect>` warning). |
| F2 | P0 light `/activated` | `factorylm.com/activated` | #939 (cmms.ts shared template) | Same dark treatment as `/cmms`. See `desktop/apex-activated.png`. |
| F3 | CRA-25 `/sample`, `/activated`, `/pricing` route to OWU on app subdomain | `app.factorylm.com/sample,/activated,/pricing` | d881bb9 | All three return 200 from mira-web :3200 (verified — mira-web template content + mira-web public-asset paths). See `headers/routing-verdict.md`. |

Topbar coherence (PRs #940/#944) is *partially* fixed — the wordmark logo and dark bar shipped to most pages, but **CTA copy still varies** ("Sign in" on /, "Start Free Trial" on app/pricing, magic-link form on /cmms) and the topbar nav links break when served from the app subdomain (see R7 below). Marking this as "partly fixed" rather than fully resolved.

---

## ⚠️ Still broken (4)

| # | Was | Route | Baseline | Current | Why it didn't move |
|---|---|---|---|---|---|
| S1 | P1 missing CSP header on apex | `factorylm.com` | no `content-security-policy` | **same — still missing** | `deployment/nginx-factorylm-marketing.conf` defines a CSP block (lines 41–52) but the live response from the VPS doesn't include it. Either the config wasn't deployed, or it's being stripped upstream. |
| S2 | P2 color-contrast violations (5 routes) | `/`, `/blog`, `/cmms`, `/blog/fault-codes`, `/blog/how-to-read-vfd-fault-codes` | 5 routes failing | **6 routes failing, 27 distinct elements** — *worse than baseline* | The 2026-05-03 style audit fixed palette but not contrast: white amber on dark works for body text but **buttons** (`#f0a000` on `#09090c`) and **muted footnote text** still fail axe color-contrast. New failures on `/pricing` and `/activated` not in 2026-05-03 canary. |
| S3 | P3 404 page no home link | `/__webreview_404_*` | 13-byte plain-text "404 Not Found" | **same** | nginx default 404; no custom 404 view in mira-web. |
| S4 | CRA-27 hub `/sitemap.xml` + `/robots.txt` | `app.factorylm.com/sitemap.xml`, `/robots.txt` | not implemented | **307 → `/login?callbackUrl=...`** | Code is on worktree branch `claude/silly-rhodes-caa1e5` (per `docs/runbooks/audit-fixes-2026-05-04.md`); mira-hub container has not been rebuilt + redeployed. |

Detailed contrast offenders:

- `/` (4): hero CTA `<a class="fl-btn fl-btn-primary" href="/cmms">`, two `.fl-stop-btn` cards (#fault, #wrench), one `<a href="#">` placeholder
- `/cmms` & `/activated` (1 each): `<button id="fl-magic-submit">` — same offender, shared template
- `/pricing` (7): `.hero-eyebrow`, `.card-footnote` × 3 (the per-tier price footnotes), `section.comparison p`, etc.
- `/blog` (9): `.section-label`, `<h2>`, `.post-meta span`, footer links
- `/blog/fault-codes` (5): `.section-label`, footer links to `/limitations`, `/trust`

Lighthouse JSON in `lighthouse/`. All 6 routes scored Perf 85–100, A11y 94–96, BP 96–100, SEO 100, but `color-contrast` audit is `score: 0` (failing) on every one.

---

## 🆕 Regressions (11)

These weren't measured in the 2026-05-03 baseline because they only show up under interaction. Severity is my call based on customer-funnel impact.

| # | Sev | Route | Element / Action | Failure | Likely cause |
|---|---|---|---|---|---|
| **R1** | **P0** | `factorylm.com/blog/fault-codes`, `/blog` | Click any fault-code link or "Open Mira chat" button | `POST /api/mira/session → 404`, fires on **30+ interactions** in this run alone | `mira-web/public/mira-chat.js` calls `/api/mira/session` but **no such endpoint exists in `mira-web/src/server.ts`**. The chat widget asset (PR #637b3c0 "animated feature cartoons") shipped without its backend. Customer-facing P0 — the entire fault-code troubleshooter on the blog is non-functional. |
| **R2** | **P1** | apex blog & fault-codes pages | Browser preload | `Refused to apply style from 'https://factorylm.com/mira-chat.css' because its MIME type ('text/plain')` — fires 31× across the run | `mira-web/src/lib/blog-renderer.ts:54` preloads `/public/mira-chat.css`, but the file is served at `/mira-chat.css` (no `/public/` prefix). 404s, nginx returns `text/plain`, browser refuses. |
| **R3** | **P1** | `app.factorylm.com/*` (every hub-rendered page) | Any link click → next page mounts | `[hubDataProvider] NEXT_PUBLIC_PIPELINE_API_URL is unset in production — set it in docker-compose.saas.yml mira-hub env block` — fires on **every** hub-page mount across all 4 app-subdomain crawls | NEXT_PUBLIC_* envs are baked at docker build time (memory: `feedback_next_public_envs_baked_at_build.md`). The env var is in Doppler `factorylm/prd` but missing from the build-arg / compose env block. The hub never reaches mira-pipeline because the URL is undefined. |
| **R4** | **P1** | `/cmms` & `/activated` mobile | 7 nav/footer links + sun-toggle | `TimeoutError: elementHandle.click: Timeout 5000ms exceeded` — 13 click failures across the two pages | Tap targets / off-viewport elements unreachable on 412×915. **In flight as `feat/cra-24-tap-targets` (current branch) but not yet merged or deployed.** |
| **R5** | **P1** | `app.factorylm.com/admin/` | curl probe | `404 Not Found` (13 bytes) | d881bb9 routes `/admin/` to mira-web :3200, but mira-web has only `/admin/qr-print` and `/admin/qr-analytics` — no `/admin` index route. Either remove the nginx `location /admin/` block or add an index page in mira-web. |
| **R6** | **P2** | `factorylm.com/` (all interactions) | Initial page load + every click | Console error: `<rect> attribute rx: Expected length, "0 0 12 12"` — fires on every interaction (29 desktop + 29 mobile + propagates via shared SVG) | Cartoon hero (PR #935 "v0.3.0") has an SVG `<rect rx="0 0 12 12">` — `rx` accepts a single length, not a viewBox-style 4-tuple. Cosmetic but pollutes the console budget for everything else. |
| **R7** | **P2** | `app.factorylm.com/pricing`, `/sample` | Click any topbar nav link (CMMS, Pricing, Blog, etc.) | Navigates to `app.factorylm.com/<path>` (same-host) which falls through to mira-hub catch-all and hits the hub auth gate | The shared topbar partial in mira-web hardcodes relative `/cmms`, `/pricing`, etc. Those resolve on whichever host serves the page; on app subdomain they should be absolute `https://factorylm.com/<path>`. |
| **R8** | **P2** | `app.factorylm.com/pricing` | Click "Start Free Trial" → Stripe redirect | `Failed to load resource: net::ERR_CONNECTION_RESET` (4×) + `Loading CSS chunk 50452 failed (https://js.stripe.com/v3/...checkout-app-init-...css)` | CSP blocks Stripe asset chunk, OR transient DNS/network. Either way: **the primary conversion CTA on the pricing page fails for at least one of every 5 attempts in this crawl.** Worth re-running to disambiguate transient vs CSP — but blocking either way. |
| **R9** | **P2** | `app.factorylm.com/pricing`, `/sample` | Click "Pricing" link | `pageerror: SyntaxError: Unexpected token '<'` | A JS module is being requested but receives an HTML 404 page. Probably a Next.js `_next/data/` JSON request resolving to a 404 HTML page. |
| **R10** | **P2** | `app.factorylm.com/pricing` | First clickable: `Skip to main content` skip link | `TimeoutError: elementHandle.click: Timeout 5000ms exceeded` | A11y skip-link is positioned off-screen and never becomes clickable. Useless for screen-reader / keyboard users. |
| **R11** | **P3** | `app.factorylm.com/pricing` | Stripe preload hint | `<link rel=preload> uses an unsupported "as" value` (warning) | Preload `as=...` value is invalid (probably `as=fetch` for non-CORS, or wrong MIME). Cosmetic but indicates someone hand-rolled a preload hint without checking the spec. |

---

## 🔄 Routing-fix verification (CRA-25 / CRA-26 / CRA-27)

| Linear | Intent | Live result | Verdict |
|---|---|---|---|
| **CRA-25** | `/sample`, `/activated`, `/pricing` → mira-web on app subdomain | All return 200 from mira-web | ✅ **DEPLOYED** |
| **CRA-26** | unknown-host → 404 (not 308 to a vhost) | Not yet probed | ⚠️ **IN BRANCH (claude/silly-rhodes-caa1e5), not deployed** |
| **CRA-27** | mira-hub `/sitemap.xml` + `/robots.txt` public | 307 → `/login` | ⚠️ **IN BRANCH, not deployed** |

Per `docs/runbooks/audit-fixes-2026-05-04.md`, CRA-26 + CRA-27 + CRA-43/45/46/50 land together when mira-hub container is rebuilt with the worktree branch. Until that deploys, those baseline findings remain.

---

## ➖ Deferred / unchanged (1)

- **`/sample` stub page still light theme** — was P3 in 2026-05-03 (deferred until post-auth UI built out). Still light. No-op confirmed.

---

## 📊 Lighthouse delta

| Route | Perf | A11y | BP | SEO | Color-contrast |
|---|---|---|---|---|---|
| `/` | 85 | 94 | 96 | 100 | **FAIL (4 items)** |
| `/cmms` | 99 | 96 | 96 | 100 | **FAIL (1)** |
| `/activated` | 94 | 96 | 96 | 100 | **FAIL (1)** |
| `/pricing` | 100 | 96 | 100 | 100 | **FAIL (7)** |
| `/blog` | 100 | 96 | 100 | 100 | **FAIL (9)** |
| `/blog/fault-codes` | 100 | 96 | 100 | 100 | **FAIL (5)** |

Headline scores look great. The single audit that's red on every route is `color-contrast`. Full JSON in `lighthouse/`.

---

## 🔒 Security headers

| Header | `factorylm.com` | `app.factorylm.com` |
|---|---|---|
| `Strict-Transport-Security` | ✅ `max-age=63072000; includeSubDomains; preload` | ✅ same |
| `X-Frame-Options` | ✅ `SAMEORIGIN` | ✅ `SAMEORIGIN` |
| `X-Content-Type-Options` | ✅ `nosniff` | ✅ `nosniff` |
| `Referrer-Policy` | ✅ `strict-origin-when-cross-origin` | ✅ same |
| `Permissions-Policy` | ✅ `camera=(), microphone=(), geolocation=()` | ✅ same |
| `Content-Security-Policy` | ❌ **missing** | ✅ full CSP w/ accounts.google.com, hubapi.com whitelist |
| `X-Robots-Tag` | (not set — apex is indexable, intentional) | ✅ `noindex, nofollow` |

Apex CSP gap (S1) is the standout. Live response is missing what `nginx-factorylm-marketing.conf` declares, suggesting the deployed nginx config is older than the repo file or was patched out.

Server header still includes `nginx/1.24.0 (Ubuntu)` on both hosts — minor info disclosure (was issue #625; `server_tokens off` documented but not enforced).

Full headers dumped to `headers/`. Routing verdict in `headers/routing-verdict.md`.

---

## 🎯 Recommended next moves (severity-ordered)

1. **R1: Add `/api/mira/session` endpoint** to `mira-web/src/server.ts`, OR remove the chat widget from blog templates until the backend is ready. The fault-code troubleshooter is currently a dead button.
2. **R2: Fix `mira-chat.css` path** in `blog-renderer.ts:54` — change `/public/mira-chat.css` → `/mira-chat.css`. One-character fix; will silence 31 console errors.
3. **R3: Bake `NEXT_PUBLIC_PIPELINE_API_URL` into the mira-hub image** — add `args:` block to `docker-compose.saas.yml` mira-hub service, OR use `next build --env`. Per memory, NEXT_PUBLIC_* must be at build-time, not runtime.
4. **R4: Land + deploy `feat/cra-24-tap-targets`** (current branch) — fixes the mobile click-timeouts on /cmms and /activated.
5. **S1: Verify the apex nginx config on the VPS.** SSH in, check what's actually in `/etc/nginx/sites-enabled/factorylm-marketing` vs the repo. If repo is newer, scp + reload.
6. **S2: Tokenize CTA color contrast.** Either darken `--fl-bg-50` or lighten `--fl-amber` on buttons; specifically the `.fl-btn-primary` and `.fl-stop-btn` selectors. The other contrast offenders are footnote/eyebrow text — make `.card-footnote` use `--fl-text-muted` not `--fl-text-faint`.
7. **R7: Make topbar links absolute when served on the app subdomain.** Add a `host` prop to the shared topbar partial in `mira-web/src/views/_topbar.ts` (or wherever PR #940 put it) and prepend `https://factorylm.com` when host is app subdomain.
8. **CRA-26 + CRA-27: Merge `claude/silly-rhodes-caa1e5` and rebuild mira-hub** — closes 2 baseline findings + improves SEO.
9. **R8: Reproduce the Stripe ERR_CONNECTION_RESET** on a fresh run; if persistent, audit hub CSP `connect-src` for js.stripe.com domains. (Apex CSP allows js.stripe.com; hub CSP does not.)
10. **R5: Decide app.factorylm.com/admin scope.** Either drop the nginx `location /admin/` block or build an admin index page in mira-web.
11. **R6: Fix the home `<rect rx="0 0 12 12">`** SVG attribute. Probably `rx="12"` or `rx="6"` — quick one-liner in the home cartoon SVG.

No GitHub issues filed automatically. Approve any of the above and I'll open them.

---

## Persistent baseline noise

A single SVG `<rect>` element on `factorylm.com/` has `rx="0 0 12 12"` instead of a valid length. This logs a console error on every interaction (the SVG is part of the cartoon hero rendered above the fold, so it's loaded and parsed on every navigation back to home). **Fired on 14 page-views** in this crawl, suppressed from the broken-interactions table to avoid flooding it. Captured as R6.

---

## Artifacts

```
tools/web-review-runs/2026-05-04-reaudit/
├── AUDIT.md                       (this file)
├── playwright-run.log             (full Playwright stdout)
├── clicks-aggregate.md            (auto-generated from clicks.jsonl)
├── extract-clicks.py              (regen the aggregate)
├── extract-lh.py                  (regen the Lighthouse table)
├── desktop/                       (12 full-page initial-load screenshots, 1440×900)
├── mobile/                        (5 full-page initial-load screenshots, 412×915)
├── clicks/<route-slug>__<viewport>/
│   ├── 00-initial.png
│   ├── 01-…-NN-…png               (per-click state captures)
│   ├── clicks.jsonl               (one record per interaction)
│   └── summary.json
├── lighthouse/                    (6 JSON reports)
└── headers/
    ├── factorylm.com-root.txt
    ├── app.factorylm.com-root.txt
    ├── app-routing-probe.txt
    ├── edge-probes.txt
    └── routing-verdict.md         (per-host routing assessment)
```
