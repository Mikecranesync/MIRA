# FactoryLM × MIRA — Phase 0 Developer Handoff

**Generated:** 2026-04-26
**Audience:** Claude Code (the agent that will ship these PRs) + Mike (reviewer)
**Anchor:** `docs/design-system-2026-04-26.md` (component catalog), `docs/website-refactor-roadmap-2026-04-26.md` (sequencing)
**Repo:** `Mikecranesync/MIRA`
**Surfaces this handoff covers:** `mira-web` (the marketing site at `factorylm.com`)

---

## How to use this doc

Each section below is a single GitHub issue. Each issue is sized for **one Claude Code session** (1-4 hours of focused work). Issues are grouped into three waves; within a wave they can be worked in parallel.

**Dependency graph:**

```
Wave A — foundation (must ship first, can parallelize within)
├── #SO-300 tokens.css
└── #SO-301 head partial

Wave B — components (after A, parallelize)
├── #SO-302 fl-btn
├── #SO-303 fl-state pill
├── #SO-304 fl-trust-band
├── #SO-305 fl-compare grid
├── #SO-306 fl-stop-card
├── #SO-307 fl-price-card
├── #SO-308 fl-limits
└── #SO-309 sun-readable toggle

Wave C — surfaces (after B, parallelize)
├── #SO-100 homepage refactor   ← depends on 302,303,304,305,306,309
├── #SO-070 cmms magic-link      ← depends on 302,309
├── #SO-104 pricing 3-tier       ← depends on 307,309
├── #SO-005 /limitations page    ← depends on 308,309
└── #SO-103 /vs-chatgpt-projects ← depends on 305,309
```

PR convention per `.claude/rules/python-standards.md` and prior project habits: **`feat(web): {short-description} (closes #SO-XXX)`**.

Every PR description should:
1. Cite the issue ref (`closes #SO-XXX`)
2. Include a screenshot of the rendered component (Mike or Claude Code attach manually)
3. List the design token IDs used
4. Note any deviation from the spec with a rationale

---

# Wave A — Foundation

## #SO-300 — Ship `_tokens.css` (THE design system file)

### Goal
Single canonical CSS-variable file that every public HTML page imports. All colors, spacing, type, shadows, radii, and motion live here.

### Files to touch
- **NEW:** `mira-web/public/_tokens.css`
- **MODIFY:** `mira-web/src/server.ts` — add `serveStatic` for `/public/_tokens.css` (already covered by existing `app.use("/public/*", serveStatic(...))` — verify, don't duplicate)

### Acceptance criteria
1. `mira-web/public/_tokens.css` exists with the full token set from `docs/design-system-2026-04-26.md` §2.1, §2.2, §2.3, §2.4 (copy verbatim — do not improvise values)
2. `https://factorylm.com/_tokens.css` resolves with `Content-Type: text/css` and `Cache-Control: public, max-age=31536000` (1 year)
3. The file includes a top-of-file comment: `/* FactoryLM × MIRA design tokens — see docs/design-system-2026-04-26.md. Do NOT edit values without updating the design system doc and component tests. */`
4. Includes `body.sun` overrides per design-system §2.2
5. No external font URLs — system stack only

### Visual spec
Reference `docs/design-system-2026-04-26.md` §2 verbatim. Tokens use the `--fl-*` namespace; do not introduce other prefixes.

### Test
- `curl -I https://factorylm.com/_tokens.css` returns `200` and the right cache header
- `bun test mira-web/tests/static-assets.test.ts` (add a small smoke test if one doesn't exist)

### Estimated session size
**1 hour.** Single new file, no logic.

---

## #SO-301 — Shared `<head>` partial

### Goal
Stop duplicating `<head>` markup across `index.html`, `cmms.html`, `pricing.html`, `activated.html`. One source of truth.

### Files to touch
- **NEW:** `mira-web/src/lib/head.ts`
- **MODIFY:** `mira-web/src/server.ts` (use `head()` for inline routes that previously inlined `<head>`)

### Acceptance criteria
1. `head(opts)` is exported from `src/lib/head.ts` and accepts: `{ title, description, canonical, ogImage?, ogTitle?, ogDescription?, jsonLd? }`
2. Returned string includes:
   - charset + viewport
   - `<title>` and `<meta name="description">`
   - `<link rel="canonical">` (REQUIRED per SEO strategy — block PR if absent)
   - OG + Twitter Card meta tags (default to safe FactoryLM defaults if not provided)
   - `<link rel="stylesheet" href="/_tokens.css">` and `<link rel="stylesheet" href="/_components.css">`
   - Manifest, theme-color (`var(--fl-navy-900)` resolved hex), favicon, og-image
   - PostHog snippet (`<script src="/posthog-init.js"></script>`)
   - Optional `jsonLd` slot for schema.org JSON-LD
3. All currently-static `public/*.html` pages are switched to be served via `c.html(layout({ head: head({...}), body: ... }))` from Hono
4. No regressions: existing routes still render at `factorylm.com/`, `factorylm.com/cmms`, `factorylm.com/pricing`, `factorylm.com/activated`

### Visual spec
n/a — this is a structural refactor. The visual output of every page must be unchanged after this PR.

### Edge cases
- `description` truncates to 160 chars with `…`
- If `canonical` is omitted, derive from `c.req.url`
- If `jsonLd` is provided, render it as a `<script type="application/ld+json">` block

### Test
- `bun test mira-web/src/lib/__tests__/head.test.ts` covering: default OG, custom canonical, JSON-LD injection, description truncation
- Manual smoke: each page still renders + view-source shows the full new `<head>` markup

### Estimated session size
**2 hours.** New module + 4 page migrations.

---

# Wave B — Components

> Each Wave-B component is a CSS-only addition to a single shared file `mira-web/public/_components.css` and (optionally) a tiny TS render helper in `mira-web/src/lib/components.ts`. Tests verify CSS class presence + no contract regressions.

## #SO-302 — `.fl-btn` button component (primary, ghost, mic)

### Goal
Three reusable button variants used everywhere.

### Files to touch
- **MODIFY:** `mira-web/public/_components.css` (create if absent — single shared component stylesheet)
- **MODIFY:** `mira-web/src/lib/components.ts` (create if absent — TS render helpers)

### Acceptance criteria
1. CSS classes `.fl-btn`, `.fl-btn-primary`, `.fl-btn-ghost`, `.fl-btn-mic` exist with the exact rules from `docs/design-system-2026-04-26.md` §3.1
2. Hover, focus-visible, active, and disabled states all defined
3. TS helper exports: `btnPrimary(label: string, opts?: { onclick?: string; type?: "button"|"submit"; ariaLabel?: string }): string` (and same for ghost + mic)
4. `:focus-visible` ring renders on keyboard focus (NOT on mouse click) — use `:focus-visible` not `:focus`
5. Min tap target: 44×44 px for `.fl-btn-mic`; 40-min height for `.fl-btn-primary` and `.fl-btn-ghost`

### Interaction spec
- Hover transition: `background .12s ease`
- Focus: 3px outer ring at `rgba(201,83,28,.32)`
- Disabled: `opacity .5; cursor: not-allowed; pointer-events: none`
- No animation on click (industrial — no bouncy buttons)

### Edge cases
- Buttons inside form: helper sets `type="submit"` if `opts.type === "submit"`, else defaults `type="button"`
- Long button text wraps; height grows. Don't truncate.

### Accessibility
- Mic button MUST have `aria-label`
- All buttons have visible `:focus-visible` ring meeting WCAG 2.4.7

### Test
- `bun test mira-web/src/lib/__tests__/components.test.ts` — assert HTML output matches expected for `btnPrimary`, `btnGhost`, `btnMic`
- Visual regression: take screenshot of `/test-components` route (add behind `?test=1` query)

### Estimated session size
**1.5 hours.**

---

## #SO-303 — `.fl-state` four-state pill

### Goal
The brand promise made visual. Indexed / Partial / Failed / Superseded pills.

### Files to touch
- **MODIFY:** `mira-web/public/_components.css`
- **MODIFY:** `mira-web/src/lib/components.ts`

### Acceptance criteria
1. Four classes from design-system §3.2 implemented exactly: `.fl-state-indexed`, `.fl-state-partial`, `.fl-state-failed`, `.fl-state-superseded`
2. Each pill has the correct background + text color + glyph shape per the token spec
3. The glyphs differ in shape: indexed = circle, partial = rotated-45 square, failed = rounded-2 square, superseded = unrotated rectangle. **Color is not the only differentiator** (a11y requirement)
4. TS helper: `stateBadge(state: "indexed"|"partial"|"failed"|"superseded", label?: string): string`
5. Default labels: "Indexed", "Partial · Tap to rescan", "OCR failed · Tap to retry", "Superseded"

### Visual spec
Reference design-system §3.2 verbatim.

### Edge cases
- If `label` is provided, use it. If not, use the default for that state.
- Pills are inline-flex; they should not break to a new line inside a row

### Accessibility
- If pill is inside a clickable parent, add `aria-label` to the parent that includes the state ("Open Manual Rev D, Indexed")
- The pill itself is decorative; do NOT give it `role="button"` unless it has its own click handler
- Color contrast: each pill background+text combo must pass WCAG AA (the spec values do — verify with axe or a contrast checker)

### Test
- Component test asserts all four classes and HTML structure
- a11y test: axe-core passes on a page with all four pills present

### Estimated session size
**1 hour.**

---

## #SO-304 — `.fl-trust-band`

### Goal
Codex's #1 homepage gap: trust signals under the hero.

### Files to touch
- **MODIFY:** `mira-web/public/_components.css`
- **MODIFY:** `mira-web/src/lib/components.ts`

### Acceptance criteria
1. CSS class `.fl-trust-band` plus inner `.fl-trust-eyebrow` and `.fl-trust-list` per design-system §3.13
2. TS helper: `trustBand(eyebrow: string, items: string[]): string`
3. Default usage on homepage:
   ```ts
   trustBand(
     "68,000+ chunks of OEM documentation indexed",
     ["Rockwell Automation","Siemens","AutomationDirect","ABB","Yaskawa","Danfoss","SEW-Eurodrive","Mitsubishi"]
   )
   ```
4. Items wrap on small viewports; horizontal scroll is NOT used
5. White background by default; on `body.sun` becomes `#FFFFFF` with `2px solid #000` borders

### Visual spec
- Padding: `var(--fl-sp-8) var(--fl-sp-6)` top/bottom × left/right
- Eyebrow: `var(--fl-type-sm)` uppercase, `var(--fl-muted-600)`, letter-spacing `var(--fl-ls-caps)`
- List items: `var(--fl-type-md)` semibold, comma-separated visually via `gap: var(--fl-sp-5)` flex
- Centered

### Responsive
- ≥980px: items in a single row
- 760-980px: items wrap to 2 rows
- <760px: items wrap to 3-4 rows; eyebrow text may wrap

### Edge cases
- Empty `items` array: hide the entire band (don't render an empty strip)
- Single item: still center it

### Accessibility
- The list IS a list (`<ul>`); use `<li>` for each item
- Eyebrow is a `<p>` not a heading (it's not navigable)

### Test
- Component test: `trustBand` returns expected HTML
- Visual test: screenshot at 1440, 980, 768, 380 widths

### Estimated session size
**1 hour.**

---

## #SO-305 — `.fl-compare` side-by-side grid

### Goal
Powers `/vs-chatgpt-projects` and the homepage feature strip. Bad-vs-good comparison.

### Files to touch
- **MODIFY:** `mira-web/public/_components.css`
- **MODIFY:** `mira-web/src/lib/components.ts`

### Acceptance criteria
1. CSS classes `.fl-compare`, `.fl-compare-grid`, `.fl-col`, `.fl-col-bad`, `.fl-col-good`, `.fl-col-h-bad`, `.fl-col-h-good` per design-system §3.12
2. TS helper:
   ```ts
   compareBlock(question: string, badLabel: string, badQuote: string, badNote: string, goodLabel: string, goodQuote: string, goodCitations?: string[]): string
   ```
3. The "good" column may include a citations row (uses `.fl-src-chip` styling — implementation lifts from §3.3 of design-system, even though `#SO-314` ships the full chip; for Phase 0 just style as inline pill spans)
4. On <880px viewports the columns stack to single-column

### Visual spec
- Bad column: `border-color: #F0C9C0; background: #FCF3F0;` (calls out the failure)
- Good column: `border-color: #BCDFCC; background: #F2FAF5;` (calls out the success)
- Both columns same height via `align-items: stretch`
- Inner padding `var(--fl-sp-4)`, radius `var(--fl-radius-lg)`

### Edge cases
- If `goodCitations` is empty, hide the citations row
- Long quotes don't truncate — they wrap. The brand promise is honesty; truncating a competitor's quote weakens it

### Accessibility
- Heading levels: `<h3>` per column
- "Bad" / "Good" semantics rely on color but ALSO on the heading prefix (e.g., "ChatGPT Projects" vs "MIRA Projects" — don't rely on color alone)

### Test
- Component test verifies HTML output and column class application
- Snapshot test on a fixture compare block

### Estimated session size
**1.5 hours.**

---

## #SO-306 — `.fl-stop-card` safety interrupt

### Goal
Brand promise made unavoidable. When MIRA detects safety-critical question, this card replaces the answer.

### Files to touch
- **MODIFY:** `mira-web/public/_components.css`
- **MODIFY:** `mira-web/src/lib/components.ts`

### Acceptance criteria
1. CSS classes `.fl-stop-card`, `.fl-stop-cta`, `.fl-stop-btn` per design-system §3.4
2. TS helper:
   ```ts
   stopCard(headline: string, body: string, ctas: Array<{ label: string; href?: string; onclick?: string }>): string
   ```
3. Always renders with `role="alert"`
4. Headline always starts with "⚠ STOP — " (helper enforces this)
5. Phase 0: this is shown as a SAMPLE on the homepage feature strip (proof of brand). Phase 1 wires it into the actual chat surface.

### Visual spec
- Background `var(--fl-safety-bg)`, border `1.5px solid var(--fl-safety-border)`
- Inner padding `14px`
- Headline: uppercase, letter-spacing `var(--fl-ls-wide)`, color `var(--fl-safety-border)`
- CTAs: `.fl-stop-btn` — white background, safety-border outline, safety-text color

### Accessibility
- `role="alert"` (announces to screen readers immediately)
- CTAs are actual `<button>` or `<a>` (not divs)

### Test
- Component test verifies role, headline prefix enforcement, CTA rendering

### Estimated session size
**1 hour.**

---

## #SO-307 — `.fl-price-card` (3 variants)

### Goal
Three pricing tiers ($0 / $97 / $497).

### Files to touch
- **MODIFY:** `mira-web/public/_components.css`
- **MODIFY:** `mira-web/src/lib/components.ts`

### Acceptance criteria
1. Classes `.fl-price-card`, `.fl-price-card-free`, `.fl-price-card-recommended`, `.fl-price-card-premium`
2. The recommended variant has a ribbon "Most popular" in the top-right + thicker `var(--fl-orange-600)` border
3. TS helper:
   ```ts
   priceCard(opts: {
     name: string,
     pitch: string,
     amount: string | "Free",
     period?: string,
     features: string[],
     ctaLabel: string,
     ctaHref: string,
     fineprint?: string,
     variant: "free"|"recommended"|"premium"
   }): string
   ```
4. Three cards in a row at >=880px; stack on mobile

### Visual spec
- Card padding `var(--fl-sp-6)`, radius `var(--fl-radius-xl)`, white background, shadow `var(--fl-shadow-sm)`
- Amount displayed in `var(--fl-type-4xl)` weight 700; period in `var(--fl-type-base)` weight 500 muted
- Features are `<ul>` with `<li>` — checkmark glyph (✓) at leading edge
- CTA is `.fl-btn fl-btn-primary` (or `.fl-btn-ghost` for the free tier)

### Edge cases
- "Free" amount renders without a `$` prefix
- Long feature lists scroll inside the card if >8 items? No — let cards grow. Plant managers are not browsing on phones at 320px width.

### Test
- Component test for all three variants
- Snapshot test on full pricing page render

### Estimated session size
**2 hours.**

---

## #SO-308 — `.fl-limits` honesty list

### Goal
The `/limitations` page list. Distinctive enough to share on Reddit.

### Files to touch
- **MODIFY:** `mira-web/public/_components.css`
- **MODIFY:** `mira-web/src/lib/components.ts`

### Acceptance criteria
1. Class `.fl-limits` containing `.fl-limits-intro` and `.fl-limits-list` (which is a `<ul>`)
2. TS helper:
   ```ts
   limitsList(intro: string, items: Array<{ headline: string; body: string }>): string
   ```
3. Each `<li>` has the `headline` in bold + `body` in regular, separated by a period
4. Generous line-height (1.6) for readability — this page has copy users will actually read

### Visual spec
- Max-width container 720px, centered
- Headline: bold, ink-900
- Body: regular, ink-900
- Spacing between items: `var(--fl-sp-5)` margin-bottom

### Edge cases
- If `items` empty: render only the intro paragraph + a footnote "Nothing to disclose. Yet."

### Accessibility
- Semantic `<ul>` and `<li>`
- Headlines are NOT separate `<h3>` (they're inline emphasis); but if accessibility tooling flags "list items should have structure," promote to `<h3>` and adjust styling

### Test
- Component test verifies expected HTML
- Snapshot test for empty + populated states

### Estimated session size
**1 hour.**

---

## #SO-309 — Sun-readable mode toggle

### Goal
Persistent high-contrast outdoor mode. Single user-facing button bottom-right; persists via `localStorage`.

### Files to touch
- **MODIFY:** `mira-web/public/_components.css` (already declared in `#SO-300` tokens; this issue adds the button + JS)
- **NEW:** `mira-web/public/sun-toggle.js` (~30 lines)
- **MODIFY:** Pages that should expose the toggle (homepage, `/projects`, future Hub) — but for Phase 0 just add to homepage, `/cmms`, `/pricing`, `/limitations`, `/vs-chatgpt-projects`

### Acceptance criteria
1. `<button class="fl-sun-toggle" onclick="flToggleSun()">☀ Toggle sun-readable</button>` renders fixed bottom-right on every Phase-0 page
2. Click toggles `body.sun` class
3. State persists via `localStorage` key `fl_sun_mode` (`"1"` or `"0"`)
4. On page load, if `localStorage.fl_sun_mode === "1"`, class is applied before first paint (use inline `<head>` script — see snippet)
5. Button is keyboard-accessible (`:focus-visible` ring)

### Inline `<head>` snippet (prevents flash)

```html
<script>
  (function () {
    try { if (localStorage.getItem('fl_sun_mode') === '1') document.documentElement.classList.add('sun-pre'); } catch(e){}
  })();
</script>
<style>html.sun-pre body { /* visual hint while loading */ }</style>
```

Actual class is added to `<body>` after `_components.css` loads:

```js
// public/sun-toggle.js
(function () {
  function apply() {
    if (localStorage.getItem('fl_sun_mode') === '1') document.body.classList.add('sun');
  }
  function flToggleSun() {
    var on = document.body.classList.toggle('sun');
    localStorage.setItem('fl_sun_mode', on ? '1' : '0');
  }
  document.addEventListener('DOMContentLoaded', apply);
  window.flToggleSun = flToggleSun;
})();
```

### Visual spec
- Position: `fixed; bottom: 20px; right: 20px;`
- Background `var(--fl-card-0)`, border `1px solid var(--fl-rule-200)`, radius `var(--fl-radius-pill)`, padding `10px 14px`
- Shadow `var(--fl-shadow-sm)`, `z-index: 60`
- Font weight 600, size `var(--fl-type-base)`

### Accessibility
- `aria-pressed` reflects state ("true" when sun mode active)
- `aria-label="Toggle sun-readable mode"`
- Button has visible focus ring

### Edge cases
- `localStorage` blocked (private browsing): button still works in-session, just doesn't persist. No exception thrown.
- Server-rendered: `body.sun` is added client-side after first paint. Document a known minor FOUC for users with sun mode on (acceptable; out of scope to SSR per-user preferences).

### Test
- Manual: refresh browser with sun mode on; verify class re-applies
- Browser test (e.g., Playwright): toggle, reload, verify state

### Estimated session size
**1.5 hours.**

---

# Wave C — Surfaces

## #SO-100 — Homepage refactor

### Goal
Codex's full punch-list applied to `factorylm.com/`.

### Depends on
`#SO-300, #SO-301, #SO-302, #SO-303, #SO-304, #SO-305, #SO-306, #SO-309`

### Files to touch
- **REWRITE:** `mira-web/public/index.html` (use template helpers from `#SO-301` head + Wave-B components)

### Acceptance criteria
1. Hero contains the L1 message:
   - H1: "FactoryLM"
   - H2: "The AI workspace for industrial maintenance."
   - H3: "Meet **MIRA** — your agent on the floor."
   - Subhead: "Manuals, sensors, photos, work orders, investigations — organized into Projects. MIRA answers from cited sources at 2 AM, when you scan the QR sticker on a broken machine."
   - CTAs: `[Start Free — magic link]` (primary, links to `/cmms`) + `[See pricing →]` (ghost)
2. Below the hero: `trustBand("68,000+ chunks of OEM documentation indexed", [...8 OEMs...])`
3. Below trust band: a 3-card row showing the three Project types (Asset / Crew / Investigation). Phase 0 uses static images (placeholders); Phase 1 swaps to live screenshots.
4. Below: a single `compareBlock` showing one MIRA vs ChatGPT Projects example (lifted from prototype X tab)
5. Below: a feature strip with a `<state-pill row>` showing the 4 document states + a `<stop-card>` sample
6. Below: pricing teaser ("Site license. $97/mo per plant. $497/mo with auto-RCA. → /pricing")
7. Footer includes `/limitations`, `/trust`, `/privacy`, `/terms` links
8. Sun-readable toggle visible
9. PostHog `cta_click` events fire on every CTA
10. JSON-LD schema for `Organization` + `WebSite` + `Person (Mike Harper)` injected via `head()` helper

### Visual spec
Match the codex-recon directional fixes: real product imagery in hero (placeholder PNG OK for Phase 0), trust band immediately below, simplified secondary CTA, no "Read the blog" dilution.

### Accessibility
- One H1 only
- Logical heading hierarchy (H1 → H2 → H3, no skip)
- All images have alt text
- All buttons keyboard-focusable

### SEO
- Title: "FactoryLM — AI Workspace for Industrial Maintenance"
- Meta description: "Manuals, sensors, photos, work orders — one workspace per asset. MIRA answers at 2 AM with cited sources. Free trial."
- Canonical: `https://factorylm.com/`

### Test
- Manual: render on desktop + mobile, screenshot for codex re-check
- Lighthouse: Performance ≥85, Accessibility ≥95, SEO ≥95
- Schema validator (Google Rich Results Test) passes Organization markup

### Estimated session size
**3 hours.**

---

## #SO-070 — `/cmms` magic-link entry

### Goal
Replace the multi-field beta form with passwordless magic-link entry. Codex's #1 conversion fix.

### Depends on
`#SO-300, #SO-301, #SO-302, #SO-309`

### Files to touch
- **REWRITE:** `mira-web/public/cmms.html`
- **MODIFY:** `mira-web/src/server.ts` — `POST /api/register` already exists; verify it auto-sends magic link. If not, add `POST /api/magic-link` that creates a pending tenant + emails a one-time login link.
- **MODIFY:** `mira-web/src/lib/auth.ts` — verify `signToken` supports a short-lived magic-link token (10 min TTL). Add if missing.
- **MODIFY:** `mira-web/emails/beta-welcome.html` — restructure as the magic-link email

### Acceptance criteria
1. `/cmms` shows ONE input (work email) and one CTA ("Send magic link")
2. Submitting the form calls `POST /api/magic-link {email}` → server creates pending tenant if not exists, sends magic-link email, returns success
3. Magic-link email contains a tokenized URL like `https://factorylm.com/api/magic/login?token=...&email=...`
4. Clicking the link in the email signs the user in for 24h and lands them at a sample workspace at `/sample` (Phase 1 builds real sample workspace; Phase 0 lands at a static placeholder explaining "you'll see your sample workspace here once Phase 1 ships, for now upload your first manual")
5. After-the-fold: 3-step "What happens next" strip with `stateBadge`-styled markers
6. Below the fold: `compareBlock` from prototype X tab (single example) + sun-readable toggle
7. Magic link tokens stored in NeonDB with 10-min expiry; single-use; logged in audit trail per existing `audit.ts`

### Visual spec
- Email input: `var(--fl-type-base)`, padding `12px 14px`, border `1px solid var(--fl-rule-200)`, radius `var(--fl-radius-lg)`, focus ring `box-shadow: 0 0 0 3px rgba(27,54,93,.10)` and `border-color: var(--fl-navy-900)`
- "Send magic link" button is `.fl-btn-primary`
- "No credit card. No call. No demo." reassurance copy below the button

### Accessibility
- `<input type="email" required autocomplete="email">`
- `<label for="cmms-email">Work email</label>` (visually hidden but semantically present)
- Form submission blocked on invalid email; inline error message under the input

### Edge cases
- Existing active tenant submits: server skips the create + just sends a sign-in link
- Same email submits twice in 60 seconds: rate-limit returns 429 (extend existing `checkRegisterRateLimit`)
- Email blocked / invalid domain: friendly inline error ("That email doesn't look right — check it and try again")

### Test
- `bun test mira-web/src/lib/__tests__/magic-link.test.ts` — covers create, expiry, single-use, double-use rejection
- Manual: end-to-end stranger flow per `#SO-004` (smoke test)

### Estimated session size
**4 hours.** This is the heaviest Phase-0 issue; magic-link plumbing is non-trivial.

---

## #SO-104 — `/pricing` 3-tier page

### Goal
Three pricing cards per the brand kit ($0 / $97 / $497).

### Depends on
`#SO-300, #SO-301, #SO-307, #SO-309`

### Files to touch
- **REWRITE:** `mira-web/public/pricing.html`

### Acceptance criteria
1. Page hero: H1 "Pricing", H2 "Site license. Not per-seat."
2. Three `priceCard` components in a row at `>=880px`, stacked on mobile:
   - **MIRA Free** — $0/mo. Voice + Telegram + Slack. 1 plant. 50 chats/mo. CTA: "Start free → /cmms"
   - **FactoryLM Projects** — $97/mo/plant (RECOMMENDED variant). Workspace + MIRA + cited answers. CTA: "Start free trial → /cmms"
   - **FactoryLM Investigations** — $497/mo/plant. Adds auto-RCA + Atlas push + signed PDF. CTA: "Talk to Mike → mailto:mike@factorylm.com"
3. FAQ band below the cards (5-7 questions) with `FAQPage` JSON-LD
4. Below FAQ: `compareBlock` MIRA vs ChatGPT Projects (small reminder)
5. JSON-LD schema for each tier: `@type: Product` with `@type: Offer` nested
6. Sun-readable toggle visible

### Visual spec
- Cards: 3 columns of equal width, gap `var(--fl-sp-5)`
- Recommended card has subtle scale (`transform: scale(1.02)`) and the "Most popular" ribbon
- Feature list checkmarks: `var(--fl-good)` color

### Accessibility
- Pricing amounts read correctly to screen readers — the formatting `<span class="fl-price-currency">$</span><span class="fl-price-num">97</span><span class="fl-price-period">/mo/plant</span>` should announce as "97 dollars per month per plant"
- Use `aria-label` on the card root: `aria-label="FactoryLM Projects, 97 dollars per month per plant"`

### SEO
- Title: "FactoryLM Pricing — $0, $97, $497 per plant per month"
- Meta description: "Three plans. Site license, not per-seat. Free MIRA agent for plants under 50 chats/month."
- JSON-LD: 3× `Product`+`Offer`

### Test
- Component test for each tier renders correctly
- Schema validator passes
- Lighthouse SEO ≥95

### Estimated session size
**2 hours.**

---

## #SO-005 — `/limitations` page

### Goal
Honest "what FactoryLM doesn't do (yet)" page.

### Depends on
`#SO-300, #SO-301, #SO-308, #SO-309`

### Files to touch
- **NEW:** `mira-web/public/limitations.html`
- **MODIFY:** `mira-web/src/server.ts` — add `GET /limitations` route
- **MODIFY:** `mira-web/src/server.ts` — add `/limitations` to dynamic sitemap with priority 0.5

### Acceptance criteria
1. Page hero: H1 "What FactoryLM doesn't do (yet)", H2 "We'd rather you know upfront than be surprised on day 7."
2. `limitsList` component with 8-12 honest items. Starter set:
   - "No PLC tag streaming yet. Modbus / OPC UA / EtherNet-IP is on the post-MVP roadmap (Config 4)."
   - "No native CMMS push beyond Atlas. We work alongside MaintainX, Limble, UpKeep but don't write work orders into them yet."
   - "Safety-critical questions don't get a chat answer. LOTO, arc flash, confined space, etc. escalate to a human."
   - "Multi-tenant isolation is enforced in code, but we have not had a third-party SOC 2 audit. Pre-revenue."
   - "Dashboards beyond chat answers and work-order summaries don't exist yet."
   - "Mobile native apps don't exist. PWA + Telegram + Slack covers >95% of plant-floor use today."
   - "We don't translate manuals between languages yet. English-language manuals only."
   - "Image OCR fails on hand-drawn diagrams and severely degraded scans. We tell you when it does."
   - "RCA workflow exists in design (FactoryLM Investigations tier) but is in private alpha as of Apr 2026."
   - "Voice input requires phone microphone permission. Voice quality in 100+ dB drops fast."
3. Footer link: "Spotted something we're not honest about? Email mike@factorylm.com — we'll add it."
4. Sun-readable toggle visible

### Visual spec
- Max-width 720px container
- Generous line-height (1.6)
- Each item is bold lead phrase + period + body, no bullet glyph

### SEO
- Title: "What FactoryLM doesn't do (yet) — Limitations"
- Meta description: "An honest list of what's missing from FactoryLM — current as of 2026-04. We'd rather you know upfront."
- Canonical: `https://factorylm.com/limitations`
- JSON-LD `@type: AboutPage`

### Test
- Component test for `limitsList` rendering
- Manual: page renders + linked from homepage footer + sitemap.xml includes it

### Estimated session size
**1.5 hours.**

---

## #SO-103 — `/vs-chatgpt-projects` page

### Goal
Spin the prototype's X tab into its own URL. Strongest piece of marketing in the repo.

### Depends on
`#SO-300, #SO-301, #SO-305, #SO-309`

### Files to touch
- **NEW:** `mira-web/public/vs-chatgpt-projects.html`
- **MODIFY:** `mira-web/src/server.ts` — add `GET /vs-chatgpt-projects` route
- **MODIFY:** `mira-web/src/server.ts` — add to sitemap with priority 0.9

### Acceptance criteria
1. Hero: H1 "Why ChatGPT Projects, Claude Projects, NotebookLM, and Perplexity Spaces don't work for industrial maintenance.", subhead "And what FactoryLM does instead — with sources."
2. Single `compareBlock` (MIRA vs ChatGPT Projects). Lift the question + both quotes verbatim from the prototype:
   - **Question:** "What torque did we use on the screw bolts last time, and is the bearing about to fail?"
   - **Bad (ChatGPT Projects):** "Based on standard industry practice, screw drive bolts are typically torqued to between 40 and 60 N·m. Bearings showing increased vibration may indicate impending failure — consider scheduling inspection."
   - **Good (MIRA Projects):** "45 N·m ± 2 N·m, per Carlos on 2026-01-14 (WO-3964) and per the OEM manual Rev D §4.3. Yes — your bearing is trending toward failure: amps +8% and vibration +12% over 24 h, matching the April 2024 failure pattern within 4%."
   - **Citations on good column:** `📄 Manual Rev D · §4.3 · p. 87`, `📈 A1.MOTOR_AMP 24h`, `📋 WO-3964`, `📋 WO-3812 RCA`
3. "Where each consumer AI breaks (cited)" section — bullet list lifting the four sourced bug reports from the prototype X tab. **Keep the sourced links exactly as they appear in the prototype** — they are the proof.
4. "What FactoryLM does instead" section — six bullets matching to features (document state pills, voice in 80dB, sun-readable, cited answers, safety-aware, auto-built RCA timelines)
5. Email-capture at the bottom: "Get the full 12-page comparison report (with reproducible test data)." → `POST /api/leads/capture {email, source: "vs-chatgpt-projects"}`. Phase 1 wires the report; Phase 0 just stores the lead.
6. JSON-LD `@type: ComparisonPage` (custom; OK if Google ignores) AND `@type: FAQPage` for the bug-list (each bug = a Question)

### Visual spec
- Hero is full-width navy gradient panel
- Compare block centered, max-width 1080px
- Bug list uses standard `<ul>` styling, each link opens in a new tab (`rel="noopener noreferrer"`)
- "Get the report" form is single-field (email) + button

### SEO
- Title: "FactoryLM vs ChatGPT Projects, Claude Projects, NotebookLM, Perplexity Spaces"
- Meta description: "Why consumer AI workspaces fail at industrial maintenance — with sourced bug reports — and what FactoryLM does instead."
- Canonical: `https://factorylm.com/vs-chatgpt-projects`

### Accessibility
- All sourced bug links have `aria-label` describing destination
- Color is not the only differentiator in the compare block (already handled by `#SO-305` requirement)

### Test
- Manual: page renders with all four sourced links working
- Schema validator passes FAQPage
- Email-capture submits and creates a row in `plg_leads` (or `plg_tenants` with source tag)

### Estimated session size
**3 hours.**

---

# Wave C — Recommended PR sequencing

If Mike runs Claude Code on these issues in order, here's the optimal sequence (one PR each, can ship up to 2-3 in parallel):

| Day | PRs to ship (parallelizable within day) |
|---|---|
| 1 | `#SO-300` tokens, `#SO-301` head partial |
| 2 | `#SO-302` button, `#SO-303` state pill, `#SO-309` sun toggle |
| 3 | `#SO-304` trust band, `#SO-305` compare grid, `#SO-306` stop card |
| 4 | `#SO-307` price card, `#SO-308` limits list |
| 5 | `#SO-100` homepage refactor *(big PR — single)* |
| 6 | `#SO-070` cmms magic-link *(big PR — single)* |
| 7 | `#SO-104` pricing, `#SO-005` limitations, `#SO-103` vs-chatgpt-projects (3 medium PRs in parallel) |

End of week 1 = full Phase 0 shipped. That's the unblocker for every launch venue + every issue downstream.

---

# Definition of Done — Phase 0 release readiness

A Phase-0 release is shippable when:

1. All 15 issues above closed
2. `bun test` passes 100% in `mira-web`
3. `bun run typecheck` passes
4. `gh workflow run code-review.yml` passes (existing automated review)
5. `https://factorylm.com/_tokens.css` returns 200 with 1-year cache
6. Homepage Lighthouse Performance ≥85, Accessibility ≥95, SEO ≥95, Best Practices ≥90
7. Stranger smoke test (`#SO-004`) passes — throwaway gmail → magic link → sample workspace → first chat in <10 min
8. `wiki/hot.md` updated with phase-0 release note
9. Mike approves a side-by-side screenshot of `factorylm.com/` before vs after

After Phase 0 ships, the launch venues from `docs/launch-plan-2026-04-26.md` Wave 1 unlock. Mike, do not point any traffic at the site until Phase 0 is done — every visitor before that is a wasted impression.
