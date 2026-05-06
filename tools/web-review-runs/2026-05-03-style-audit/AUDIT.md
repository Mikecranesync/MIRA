# factorylm.com style audit — 2026-05-03

**Scope.** All public-facing pages on factorylm.com captured at desktop
(1440×900) and the seven main marketing pages at mobile (412×915) via
Chrome headless `--screenshot=`. Screenshots in this directory under
`desktop/` and `mobile/`.

**Why.** v0.3.1 just landed the WITHOUT-MIRA / WITH-MIRA hero cartoon
on the home page. The visual standard the site should match — both
in palette and in cartoon-painterly tone — is now `/`. Every other
page was audited against that standard.

## Headline finding

The site is a **hodgepodge of three design eras layered on top of each
other**, easily distinguishable by topbar treatment alone:

| Era | Logo | Topbar palette | CTA | Pages |
|---|---|---|---|---|
| **Old light** | Plain "FactoryLM" wordmark, navy on white | White bar, navy nav | "Sign in" or no CTA | `/cmms`, `/limitations`, `/security`, `/sample`, `/activated` |
| **Mid dark (M-icon)** | Orange-square **M** icon + "FactoryLM" | Black bar, gray nav, amber accent | "Get Started" / "Join the Beta" / "Try free" — *all three appear* | `/pricing`, `/privacy`, `/terms`, `/trust`, `/legal/dpa`, `/blog`, `/blog/fault-codes` |
| **New dark (cartoon)** | Plain wordmark again, white on dark | Dark bar, ink-light nav | "Sign in" only | `/` |

**Six different navs** are live in production right now (different link
sets, different orderings) and **four different primary CTAs** ("Sign
in", "Get Started", "Join the Beta", "Try free"). A visitor who lands
on `/` and clicks anywhere experiences a palette break, a logo break,
and a CTA-language break in one click.

The dark-theme commit on `/` (PR #933) explicitly scoped itself to home
only — but the consequence is that the front door now feels like a
different product than every other page.

## Per-page findings + fixes

### `/` — home (the standard) ✅

The reference. Dark `#09090c` page bg, `#13141a` cards, amber `#f0a000`
accent. Wordmark logo, single "Sign in" CTA. Hero cartoon visible
above the fold. **No fixes — this is the bar.**

Screenshots: `desktop/home.png`, `mobile/home.png`

### `/cmms` — magic-link signup landing 🔴 P0

Critical conversion page. Light theme.

**Diffs from standard:**
- White topbar with navy nav links (vs. dark bar)
- Light blue gradient bg (vs. `#09090c`)
- Navy h1 (vs. white-on-dark)
- "Send magic link" CTA in red-orange `#cc4422`-ish (vs. amber `#f0a000`)
- Topbar nav reads "Home / Pricing / Limitations / Security" — different
  link set from home's "CMMS / Pricing / Blog / Limitations / Security"
- "Sun-readable" pill in bottom-right is a styling artifact that
  doesn't appear on the new dark home

**Fix priorities (in order):**
1. Apply the home dark palette to this page (`--fl-bg-50`, `--fl-card-0`, etc.)
2. Adopt the home topbar nav exactly — same link set, same order, same CTA
3. Recolor the magic-link CTA to amber `#f0a000` so it matches the
   "Start Free — magic link" button on home
4. Card panels (1·EMAIL ARRIVES / 2·UPLOAD A MANUAL / 3·ASK A QUESTION)
   need dark-card treatment with the same `#13141a` surface used on home

**Why P0:** This is *the* conversion page — every visitor who clicks
"Start Free" on home lands here. The palette switch breaks the brand
mid-funnel.

Screenshots: `desktop/cmms.png`, `mobile/cmms.png`

### `/activated` — same problem as `/cmms` 🔴 P0

Renders identical to `/cmms`. **Fix is the same fix** — applying the dark
treatment to `views/cmms.ts` (or whatever `/activated` renders) covers
both routes.

Screenshots: `desktop/activated.png`

### `/limitations` — light marketing page 🟠 P1

**Diffs:**
- White topbar, navy h1, light blue gradient hero band
- Topbar reads "CMMS / Pricing / Blog / Limitations / Security" (closer
  to home but still missing the wordmark/CTA harmony)

**Fix:** Apply the home dark palette. Section headers in amber, body in
ink-light. Re-use the same `_components.css` selectors home uses; only
token rebinding needed (matches the pattern home took in PR #933).

Screenshots: `desktop/limitations.png`, `mobile/limitations.png`

### `/security` — light marketing page 🟠 P1

Same diff and same fix as `/limitations`. Both render via similar
template structure (`views/security.ts`, `views/limitations.ts`).

Screenshots: `desktop/security.png`, `mobile/security.png`

### `/pricing` — already dark BUT a different dark 🟡 P2

Closer to the target than the light pages, but visibly its own design
era.

**Diffs from standard:**
- **Logo treatment: orange square M-icon + "FactoryLM"** (vs. home's
  plain wordmark). This is the single most visible inconsistency
  across the entire site — pricing/privacy/terms/trust/dpa/blog/
  fault-codes ALL use this M-icon variant; home alone doesn't.
- **Topbar nav reads "Product / Pricing / Blog / Troubleshooter"** —
  *completely different link set* from home's
  "CMMS / Pricing / Blog / Limitations / Security"
- **Primary CTA reads "Get Started"** in amber (vs. home's "Sign in")
- "MOST POPULAR" tag and pricing-card amber strokes are warm-amber but
  on a slightly cooler dark background than home's `#09090c`

**Fix:** Pick *one* logo treatment site-wide (recommend the plain
wordmark home uses — simpler, lets the M-icon become the favicon
without competing). Pick *one* topbar nav set, *one* primary CTA copy
(see "Cross-cutting fixes" below).

Screenshots: `desktop/pricing.png`, `mobile/pricing.png`

### `/privacy`, `/terms`, `/trust`, `/legal/dpa` — legal stack 🟡 P2

All four share the same M-icon dark treatment as `/pricing` with the
"Product / Pricing / Blog / Troubleshooter" nav and a "Join the Beta"
amber CTA. They look like a coherent group internally.

**Diffs from standard:**
- M-icon logo (see /pricing finding)
- "Join the Beta" CTA (different from home's "Sign in")
- Section headers in pure amber `#f0a000` for `1.`/`2.`/`3.` (home uses
  amber more sparingly — for accents and the MIRA-name highlight)

**Fix:** Once `/pricing` is reconciled to the home standard, the legal
stack inherits the same fixes. Low blast radius — these are read-once
pages, but they should not undermine the visual story home sets up.

Screenshots: `desktop/privacy.png`, `desktop/terms.png`,
`desktop/trust.png`, `desktop/dpa.png`

### `/blog`, `/blog/fault-codes` — content hub 🟡 P2

Dark with M-icon logo. Topbar uniquely reads
"Product / Blog / Fault Codes / CMMS" — *yet another* nav variant.
Primary CTA is "Try free" — *yet another* CTA copy. There's also a
floating amber M-icon avatar at lower-right that doesn't appear
elsewhere on the site.

**Diffs from standard:**
- Distinct nav and CTA (the fourth and third variants respectively)
- Floating M-icon button in lower-right — purpose unclear; if it's a
  chat launcher, it should appear consistently across the site or
  not at all
- Card-list dark surfaces `#1a1a20`-ish vs. home's `#13141a` — close
  but not the same token

**Fix:** Adopt home topbar + standardize the floating chat launcher
either everywhere or nowhere. Tokenize the card surface to
`--fl-card-0` so cards match home cards.

Screenshots: `desktop/blog.png`, `desktop/fault-codes.png`,
`mobile/blog.png`, `mobile/fault-codes.png`

### `/sample` — placeholder workspace 🟢 P3

Light theme. "You're signed in." card with "Upload your first manual" /
"Back to home" buttons. Topbar matches `/cmms` (Home / Pricing /
Limitations / Security).

This page is a stub for the eventual logged-in workspace. Lower
priority because it's only seen post-signup.

**Fix:** Pick up the dark treatment when the rest of the post-auth UI
is built out. Not a marketing-page issue.

Screenshots: `desktop/sample.png`

## Cross-cutting fixes (the actual unlock)

Per-page recoloring is a sympathetic-fix anti-pattern. The real
leverage is fixing four shared things once:

### 1. Topbar component — single source of truth

There are **six** distinct topbars in production. Pick one. Recommended:
home's exact set ("CMMS / Pricing / Blog / Limitations / Security" +
"Sign in") served from a shared partial. Every page imports it. If
"Blog" doesn't belong on every page, suppress per-page via a config
prop, not by hand-rolling a different topbar.

### 2. Logo treatment

Plain "FactoryLM" wordmark site-wide. The orange square M-icon stays
as a favicon and as the standalone chat-launcher mark, but doesn't
compete with the wordmark in topbars.

### 3. Primary CTA copy

Pick one: "Sign in" (home) or "Start Free" (the home hero button) or
"Join the Beta" (legal stack) or "Try free" (blog) or "Get Started"
(pricing). They mean roughly the same thing in different voices —
having all four live at once is incoherent. Recommended: **"Start
Free"** in the topbar across the site, since the hero button on home
is already "Start Free — magic link" and that's the conversion the
funnel actually wants.

### 4. Footer component — also missing or different per page

Audit shows footers vary too. Sample uses a light footer with
"Limitations / Trust / Privacy / Terms" links; pricing/privacy/etc.
have no visible footer above-fold (would need full-page screenshots
to confirm); home has its own. Same fix as topbar — pick one, share it.

## Suggested execution order

1. **Tokenize the dark theme.** Move home's inline `PAGE_STYLES` block
   from `home.ts` into `_tokens.css` so every page can opt in by
   adding a single class. Right now the dark palette is trapped in one
   view file.
2. **Build a shared topbar partial** (`src/views/_topbar.ts` or
   similar). Every page renders it the same way.
3. **Migrate the legal stack and pricing first** — they're closest to
   the standard already, so the diff is smallest. Once they match home,
   the M-icon-era pages disappear as a category.
4. **Migrate `/cmms` and `/activated`.** Highest-impact because they're
   the conversion landing pages.
5. **Migrate `/limitations`, `/security`, `/sample`.** Lowest traffic,
   lowest risk.
6. **Re-run this audit** post-migration. Same chrome `--headless`
   command, save under `tools/web-review-runs/<date>-style-audit/` and
   diff against this run's screenshots.

## Reproducing this audit

```bash
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
OUT=tools/web-review-runs/<DATE>-style-audit
mkdir -p "$OUT/desktop" "$OUT/mobile"

# Desktop
for entry in home:/ cmms:/cmms limitations:/limitations security:/security \
            pricing:/pricing activated:/activated privacy:/privacy \
            terms:/terms trust:/trust dpa:/legal/dpa blog:/blog \
            fault-codes:/blog/fault-codes sample:/sample; do
  name="${entry%%:*}" path="${entry#*:}"
  "$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
    --window-size=1440,900 \
    --screenshot="$OUT/desktop/$name.png" "https://factorylm.com$path"
done

# Mobile (key pages only)
for entry in home:/ cmms:/cmms limitations:/limitations security:/security \
            pricing:/pricing blog:/blog fault-codes:/blog/fault-codes; do
  name="${entry%%:*}" path="${entry#*:}"
  "$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
    --window-size=412,915 \
    --screenshot="$OUT/mobile/$name.png" "https://factorylm.com$path"
done
```

Avoids the Playwright CDP-pipe handshake timeout that blocks
`snapshot-darktheme.ts` on this Windows host.
