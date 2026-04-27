# FactoryLM × MIRA — Design System

**Generated:** 2026-04-26
**Source of truth:** `docs/proposals/MIRA-Projects-Prototype.html` (the prototype's `:root` and component CSS)
**Mode applied:** Audit → Document → Extend (all three, in that order)
**Companion to:** `docs/brand-and-positioning-2026-04-26.md`, `docs/design-handoff-2026-04-26.md`

---

## 1. Audit — current state

### 1.1 Summary

**Components reviewed:** 0 (no formal design system exists today)
**Issues found:** A LOT
**Score:** 22/100 — there are good *visual instincts* in `public/index.html` (dark theme, amber accent, clean monospace for tags) but no token system, no shared component library, every page rolls its own CSS.

### 1.2 What exists today (`mira-web`)

| Surface | CSS approach | Reusability | Notes |
|---|---|---|---|
| `public/index.html` (homepage) | Inline `<style>` block | None | Dark theme, amber accent, decent typography, but 0 tokens |
| `public/cmms.html` | Inline `<style>` block | None | Codex flagged the form-heavy feel — needs full rebuild |
| `public/pricing.html` | Inline `<style>` block | None | Single-tier, will need tri-card after `#SO-104` |
| `public/activated.html` | Inline `<style>` block | None | Post-payment, embeds Loom |
| `src/lib/blog-renderer.ts` | Templated HTML strings | None | Dynamic blog/fault-code rendering — no token reuse with the rest of the site |
| `src/lib/feature-renderer.ts` | Templated HTML strings | None | Feature deep-dives — same |
| `public/sw.js`, `public/manifest.json` | n/a | n/a | PWA assets present (good) |

### 1.3 Naming consistency

| Issue | Components affected | Recommendation |
|---|---|---|
| Inline-styled pages don't share class names | All `public/*.html` | Adopt token-based CSS variables (§2) |
| Mixed `/m/*` (QR scan flow) and `/blog/*` (content) styling | `m.ts`, `m-chooser.ts`, `m-report.ts`, `blog-renderer.ts` | Single `<head>` partial that injects tokens + base styles |
| `feature-renderer.ts` and `blog-renderer.ts` likely diverge in spacing / type scale | Both renderers | Shared CSS variable file at `public/_tokens.css` |
| `.claude` references in code comments mixed with `.agents` (post codex branch) | All | Whatever the merged convention is, pick one. Brand chose `FactoryLM` (cap F, single word) — same discipline applies to internal identifiers |

### 1.4 Token coverage

| Category | Defined as variable | Hardcoded values found |
|---|---|---|
| Colors | 0 | ~25+ hex codes scattered (e.g., `#1B365D`, `#C9531C`, `#FFD27A` — partly in current homepage, partly in fragments) |
| Spacing | 0 | Arbitrary px values (12, 14, 16, 18, 20, 22, 24) sprinkled |
| Typography | 0 | font-family declared per-page |
| Shadows | 0 | 1 shared shadow style in prototype, none in current site |
| Radii | 0 | Mix of 8/10/12/14/999 across components |
| Animation | 0 | Only the `@keyframes pulse` in the prototype |

**Bottom line:** the site visually works because it's small. As you ship `/projects`, `/vs-chatgpt-projects`, three pillar pages, and 5 `/vs-*` comparison pages, this will turn into pixel chaos within 2 weeks unless you adopt the token system below.

### 1.5 Component completeness (current)

| Component | States | Variants | Docs | Score |
|---|---|---|---|---|
| Primary CTA button | ✅ default + hover | ❌ no secondary, no ghost | ❌ | 4/10 |
| Form input | ⚠️ basic only | ❌ | ❌ | 3/10 |
| Hero card | ✅ as-is | ❌ | ❌ | 4/10 |
| Pricing card | ⚠️ single tier only | ❌ | ❌ | 3/10 |
| Blog post layout | ✅ functional | ❌ | ❌ | 5/10 |
| Fault-code page layout | ✅ functional | ❌ | ❌ | 5/10 |
| QR scan landing (`/m/*`) | ✅ minimal | ❌ | ❌ | 4/10 |

### 1.6 Priority actions

1. **Adopt CSS variables from §2** — single file `public/_tokens.css` imported into every public HTML page. Unblocks every other improvement.
2. **Extract a shared `<head>` partial** that includes the tokens, font stack, viewport, OG tags. Stop duplicating `<head>` across pages.
3. **Build the 8 most-used components** from §3 as reusable HTML+CSS snippets first (no JS framework), inline into Hono templates. CSS-only components ship in 2 days; this unblocks the homepage refactor + all the new pages.

---

## 2. Tokens (extracted from prototype `:root`)

This is the canonical token set. Every value below appears in the prototype HTML. Save as `mira-web/public/_tokens.css` and `<link>` into every page.

### 2.1 Colors

```css
:root {
  /* Primary — workspace (light theme) */
  --fl-navy-900:  #1B365D;
  --fl-navy-700:  #23476F;
  --fl-orange-600:#C9531C;
  --fl-orange-500:#E67139;
  --fl-sky-100:   #E6F0FA;

  /* Surfaces */
  --fl-bg-50:     #F5F6F8;
  --fl-card-0:    #FFFFFF;
  --fl-rule-200:  #E1E5EA;

  /* Text */
  --fl-ink-900:   #1B2530;
  --fl-muted-600: #5C6770;

  /* Status */
  --fl-good:      #1F8E5A;
  --fl-warn:      #C77B0A;
  --fl-bad:       #B5341E;

  /* State pill backgrounds (the four-state honesty story) */
  --fl-state-indexed-bg:    #DCEFE3;
  --fl-state-indexed-text:  #16623F;
  --fl-state-partial-bg:    #FFF3D6;
  --fl-state-partial-text:  #856204;
  --fl-state-failed-bg:     #FBDDD3;
  --fl-state-failed-text:   #862415;
  --fl-state-superseded-bg: #E2E5E9;
  --fl-state-superseded-text:#455261;

  /* Safety alert */
  --fl-safety-bg:     #FCE9E5;
  --fl-safety-border: #B5341E;
  --fl-safety-text:   #5A1E13;

  /* Shadows */
  --fl-shadow-sm: 0 1px 2px rgba(15,23,30,.04), 0 4px 16px rgba(15,23,30,.06);
  --fl-shadow-md: 0 4px 12px rgba(0,0,0,.06);
  --fl-shadow-lg: 0 24px 48px rgba(0,0,0,.25);

  /* Radii */
  --fl-radius-sm:  8px;
  --fl-radius-md:  10px;
  --fl-radius-lg:  12px;
  --fl-radius-xl:  14px;
  --fl-radius-pill:999px;

  /* Spacing scale */
  --fl-sp-1:  4px;
  --fl-sp-2:  8px;
  --fl-sp-3:  12px;
  --fl-sp-4:  16px;
  --fl-sp-5:  20px;
  --fl-sp-6:  24px;
  --fl-sp-8:  32px;
  --fl-sp-10: 40px;

  /* Type scale (rem unit-ed) */
  --fl-type-xs:  11px;
  --fl-type-sm:  12px;
  --fl-type-base:14px;
  --fl-type-md:  16px;
  --fl-type-lg:  18px;
  --fl-type-xl:  22px;
  --fl-type-2xl: 24px;
  --fl-type-3xl: 32px;
  --fl-type-4xl: 40px;

  /* Letter spacing */
  --fl-ls-tight:  -.2px;
  --fl-ls-wide:    .4px;
  --fl-ls-caps:    .8px;
}
```

### 2.2 Sun-readable override (high-contrast outdoor mode)

```css
body.sun {
  /* Crank contrast, thicken weights, flatten saturation */
  --fl-bg-50:     #F0F0F0;
  --fl-card-0:    #FFFFFF;
  --fl-rule-200:  #404040;
  --fl-navy-900:  #000000;
  --fl-orange-600:#C8400A;
  --fl-muted-600: #2A2A2A;
  --fl-ink-900:   #000000;
  font-weight: 500;
}
body.sun .topbar     { background: #000; }
body.sun .hero       { background: #000; }
body.sun .panel,
body.sun .chat       { box-shadow: 0 0 0 2px #000; }
body.sun .file       { border-width: 2px; border-color: #000; }
body.sun .state      { border: 1.5px solid #000; }
body.sun .primary-btn{ background: #000; }
body.sun .ghost-btn  { border-width: 2px; border-color: #000; }
```

The toggle persists via `localStorage`:

```js
const SUN_KEY = "fl_sun_mode";
if (localStorage.getItem(SUN_KEY) === "1") document.body.classList.add("sun");
function toggleSun() {
  const on = document.body.classList.toggle("sun");
  localStorage.setItem(SUN_KEY, on ? "1" : "0");
}
```

### 2.3 Typography

```css
:root {
  --fl-font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif;
  --fl-font-mono: ui-monospace, SFMono-Regular, Menlo, "Roboto Mono", monospace;
}
html, body {
  font-family: var(--fl-font-sans);
  font-size: var(--fl-type-base);
  line-height: 1.45;
  color: var(--fl-ink-900);
  background: var(--fl-bg-50);
  -webkit-font-smoothing: antialiased;
}
```

**Asset tags + sensor IDs always monospace:** `EX-3-04`, `A1.MOTOR_AMP`, `VFD-07`. Use `<code>` or `<span class="fl-mono">`.

### 2.4 Animation

Only one keyframe is brand-blessed:

```css
@keyframes fl-pulse {
  0%   { box-shadow: 0 0 0 0   rgba(255,210,122,.7); }
  70%  { box-shadow: 0 0 0 12px rgba(255,210,122,0); }
  100% { box-shadow: 0 0 0 0   rgba(255,210,122,0); }
}
.fl-dot-pulse {
  width: 8px; height: 8px; border-radius: 50%;
  background: #FFD27A;
  animation: fl-pulse 2.2s infinite;
}
```

Use sparingly. The pulse is the "watch — vibration trending" health indicator. It's an industrial brand signal, not decoration.

---

## 3. Component catalog (Document mode)

Each component below has: **what it is**, **when to use**, **states**, **variants**, **HTML structure**, **accessibility**, and **priority** (Phase 0 / 1 / 2 to ship).

### 3.1 Button — `.fl-btn`

**What:** Action trigger. Three variants.

**When:** Primary on every page (one per viewport). Ghost for secondary. Mic for voice input only.

| Variant | Use when |
|---|---|
| `.fl-btn-primary` | Main action — Start Free, Send, Submit |
| `.fl-btn-ghost` | Secondary — Cancel, Open, Diff, Rescan |
| `.fl-btn-mic` | Voice input only |

**States:** default, hover, focus, active, disabled, loading

**HTML:**

```html
<button class="fl-btn fl-btn-primary">Start Free</button>
<button class="fl-btn fl-btn-ghost">Open</button>
<button class="fl-btn fl-btn-mic" aria-label="Voice input">🎙️</button>
```

**CSS:**

```css
.fl-btn { font-family: var(--fl-font-sans); cursor: pointer; font-weight: 700; transition: background .12s; }
.fl-btn-primary {
  border: none; background: var(--fl-orange-600); color: #fff;
  border-radius: var(--fl-radius-md);
  padding: 10px 16px;
  font-size: var(--fl-type-base);
  box-shadow: 0 1px 0 rgba(255,255,255,.2) inset, 0 2px 8px rgba(201,83,28,.32);
}
.fl-btn-primary:hover { background: var(--fl-orange-500); }
.fl-btn-primary:disabled { opacity: .5; cursor: not-allowed; }
.fl-btn-ghost {
  border: 1px solid var(--fl-rule-200); background: var(--fl-card-0);
  border-radius: var(--fl-radius-sm);
  padding: 8px 12px;
  font-size: var(--fl-type-sm);
}
.fl-btn-ghost:hover { background: var(--fl-bg-50); }
.fl-btn-mic {
  border: none; background: var(--fl-orange-600); color: #fff;
  width: 44px; height: 44px; border-radius: 50%;
  font-size: var(--fl-type-lg);
  box-shadow: 0 2px 8px rgba(201,83,28,.32);
}
```

**A11y:** All buttons have `type="button"` unless inside a form. `:focus-visible` ring at `box-shadow: 0 0 0 3px rgba(201,83,28,.32)`. Mic button has `aria-label="Voice input"`.

**Priority:** Phase 0.

### 3.2 State Pill — `.fl-state`

**What:** The four-state document transparency story. Brand promise made visual.

**When:** Every document, every uploaded file, every KB chunk that has an ingest state.

| Variant | Use |
|---|---|
| `.fl-state-indexed` | Document successfully ingested + searchable |
| `.fl-state-partial` | OCR partially succeeded (image-only pages skipped) |
| `.fl-state-failed` | OCR failed entirely. **Tap-to-rescan affordance required.** |
| `.fl-state-superseded` | Older revision replaced by newer one. Still searchable. |

**States:** Pills are display-only; they're not interactive themselves. The row they live on is interactive.

**HTML:**

```html
<span class="fl-state fl-state-indexed">
  <span class="fl-state-glyph"></span>Indexed
</span>
<span class="fl-state fl-state-partial">
  <span class="fl-state-glyph"></span>Partial · Tap to rescan
</span>
<span class="fl-state fl-state-failed">
  <span class="fl-state-glyph"></span>OCR failed · Tap to retry
</span>
<span class="fl-state fl-state-superseded">
  <span class="fl-state-glyph"></span>Superseded
</span>
```

**CSS:**

```css
.fl-state {
  font-size: var(--fl-type-xs);
  font-weight: 700;
  letter-spacing: var(--fl-ls-wide);
  padding: 4px 10px;
  border-radius: var(--fl-radius-pill);
  text-transform: uppercase;
  display: inline-flex; align-items: center; gap: 6px;
}
.fl-state-glyph {
  width: 8px; height: 8px; border-radius: 50%;
  display: inline-block;
}
.fl-state-indexed     { background: var(--fl-state-indexed-bg);    color: var(--fl-state-indexed-text); }
.fl-state-indexed     .fl-state-glyph { background: var(--fl-good); }
.fl-state-partial     { background: var(--fl-state-partial-bg);    color: var(--fl-state-partial-text); }
.fl-state-partial     .fl-state-glyph { background: var(--fl-warn); transform: rotate(45deg); border-radius: 0; }
.fl-state-failed      { background: var(--fl-state-failed-bg);     color: var(--fl-state-failed-text); }
.fl-state-failed      .fl-state-glyph { background: var(--fl-bad);  border-radius: 2px; }
.fl-state-superseded  { background: var(--fl-state-superseded-bg); color: var(--fl-state-superseded-text); text-decoration: line-through; }
.fl-state-superseded  .fl-state-glyph { background: #6B7785; border-radius: 0; }
```

**A11y:** Each pill should have `role="status"` if it's communicating live state, otherwise be plain. Color is not the only carrier of meaning — text + glyph shape + position all encode the state.

**Do:** Always show ALL pills users encounter; even "Superseded" stays visible (line-through) so users know the doc still exists.
**Don't:** Replace failed states with a green checkmark "to look polished." That breaks the brand promise.

**Priority:** Phase 0 (homepage feature strip uses these as proof) + Phase 1 (Hub Documents shelf).

### 3.3 Citation Chip — `.fl-src-chip`

**What:** A tappable, clickable reference to a manual page, sensor trace, or work order. The brand signature.

**When:** Every MIRA answer, anywhere in the product. Below the answer text, separated by a dashed rule.

| Variant | Use |
|---|---|
| `.fl-src-chip` (default) | Document / manual reference |
| `.fl-src-chip-sensor` | Sensor trace |
| `.fl-src-chip-wo` | Work order or RCA reference |

**HTML:**

```html
<div class="fl-msg-sources">
  <span class="fl-muted">Sources →</span>
  <button class="fl-src-chip" onclick="showCite('Manual Rev D', '§4.3 · p. 87', '...')">
    📄 Manual Rev D · §4.3 · p. 87
  </button>
  <button class="fl-src-chip fl-src-chip-sensor">
    📈 A1.MOTOR_AMP · 24h trace
  </button>
  <button class="fl-src-chip fl-src-chip-wo">
    📋 WO-3812 RCA
  </button>
</div>
```

**CSS:**

```css
.fl-msg-sources {
  margin-top: 8px; padding-top: 8px;
  border-top: 1px dashed var(--fl-rule-200);
  font-size: var(--fl-type-xs);
  color: var(--fl-muted-600);
  display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
}
.fl-src-chip {
  background: var(--fl-card-0);
  border: 1px solid var(--fl-rule-200);
  border-radius: var(--fl-radius-pill);
  padding: 4px 9px;
  font-weight: 600;
  color: var(--fl-navy-900);
  cursor: pointer;
  font-size: var(--fl-type-xs);
}
.fl-src-chip:hover  { background: var(--fl-sky-100); }
.fl-src-chip-sensor { background: #FFF7EE; border-color: #F2D6BB; color: var(--fl-orange-600); }
```

**A11y:** Each chip is a `<button>`. Has `aria-label="Open source: <doc> page <n>"`. Click opens the citation overlay (§3.10).

**Priority:** Phase 0 (homepage animated hero) + Phase 1 (Hub chat composer).

### 3.4 Stop Card (Safety Interrupt) — `.fl-stop-card`

**What:** Hard stop when MIRA detects a safety-critical question (LOTO, arc flash, confined space, etc.). Brand promise made unavoidable.

**When:** Every chat surface (Hub, Telegram-rendered, Slack, voice). Whenever `mira-bots/shared/guardrails.py` keyword fires.

**States:** display-only; CTAs trigger flow.

**HTML:**

```html
<div class="fl-stop-card" role="alert">
  <h4>⚠ STOP — Safety check before continuing</h4>
  <p>This procedure requires <strong>lockout/tagout</strong> at MCC-3 panel breaker
     <strong>EX3-04-MAIN</strong>. Confirm with your safety lead and capture the lock photo
     before MIRA continues.</p>
  <div class="fl-stop-cta">
    <button class="fl-stop-btn">Open LOTO procedure</button>
    <button class="fl-stop-btn">Notify safety lead</button>
  </div>
</div>
```

**CSS:**

```css
.fl-stop-card {
  background: var(--fl-safety-bg);
  border: 1.5px solid var(--fl-safety-border);
  border-radius: var(--fl-radius-lg);
  padding: 14px;
  color: var(--fl-safety-text);
}
.fl-stop-card h4 {
  color: var(--fl-safety-border);
  font-size: var(--fl-type-base);
  letter-spacing: var(--fl-ls-wide);
  text-transform: uppercase;
  margin-bottom: 6px;
}
.fl-stop-cta { margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap; }
.fl-stop-btn {
  background: var(--fl-card-0);
  border: 1px solid var(--fl-safety-border);
  color: var(--fl-safety-border);
  border-radius: var(--fl-radius-sm);
  padding: 8px 12px;
  font-weight: 700;
  font-size: var(--fl-type-sm);
  cursor: pointer;
}
```

**A11y:** `role="alert"`. Buttons are real buttons. Screen-readers announce as "Alert. Stop. Safety check before continuing."

**Priority:** Phase 0 (homepage feature strip) + Phase 1 (Hub chat).

### 3.5 Topbar — `.fl-topbar`

**What:** Sticky brand bar at the top of every Hub page and the docs prototype.

**When:** Inside the signed-in app and the public `/projects` reference. NOT on the marketing site (which has a different nav).

**HTML:**

```html
<header class="fl-topbar">
  <a class="fl-brand" href="/">FactoryLM<span class="fl-dot">·</span> Projects</a>
  <span class="fl-pill">Asset Page</span>
</header>
```

**CSS:**

```css
.fl-topbar {
  background: var(--fl-navy-900); color: #fff;
  padding: 12px 22px;
  display: flex; align-items: center; justify-content: space-between;
  position: sticky; top: 0; z-index: 50;
  box-shadow: 0 1px 0 rgba(255,255,255,.08), 0 4px 12px rgba(0,0,0,.06);
}
.fl-brand { font-weight: 700; letter-spacing: .3px; color: #fff; text-decoration: none; }
.fl-brand .fl-dot { color: var(--fl-orange-500); }
.fl-pill {
  background: rgba(255,255,255,.12);
  padding: 6px 12px; border-radius: var(--fl-radius-pill);
  font-size: var(--fl-type-sm);
  letter-spacing: var(--fl-ls-wide);
  text-transform: uppercase;
}
```

**Priority:** Phase 1 (Hub).

### 3.6 Tabs — `.fl-tabs`

**What:** Sticky tab navigation under the topbar.

**When:** Used in Hub for switching between assets, chats, work orders, etc.

**HTML:**

```html
<nav class="fl-tabs" role="tablist">
  <button class="fl-tab fl-tab-active" role="tab" aria-selected="true">Asset Page <span class="fl-tab-count">recommended</span></button>
  <button class="fl-tab" role="tab" aria-selected="false">Crew Workspace</button>
  <button class="fl-tab" role="tab" aria-selected="false">Investigation</button>
</nav>
```

**CSS:** see prototype `.tabs` and `.tab` rules. Token-substitute the colors.

**Priority:** Phase 1.

### 3.7 Hero Card — `.fl-hero`

**What:** Big navy gradient panel with title, subtitle, meta strip, primary CTA. The opening surface for asset pages, crew workspaces, investigations, and the marketing homepage `/projects` reference page.

**Variants:** Asset (Direction A), Crew (Direction B), Investigation (Direction C). All share visuals; only content + CTA differ.

**HTML/CSS:** lifted directly from prototype `.hero`. Token-substitute `#1B365D → var(--fl-navy-900)`, etc.

**Priority:** Phase 1.

### 3.8 File Row — `.fl-file`

**What:** A document line in the Documents shelf. Three columns: name+meta, state pill, action button.

**HTML:**

```html
<div class="fl-file" tabindex="0" role="button" aria-label="Open Manual Rev D">
  <div>
    <div class="fl-file-name">Davis-Standard MAC-150 Service Manual <span class="fl-file-rev">REV D</span></div>
    <div class="fl-file-meta">PDF · 312 pages · OEM · Indexed 2 days ago</div>
  </div>
  <span class="fl-state fl-state-indexed"><span class="fl-state-glyph"></span>Indexed</span>
  <button class="fl-btn fl-btn-ghost">Open</button>
</div>
```

**CSS:** see prototype `.file`, `.name`, `.meta`. Token-substitute.

**A11y:** The entire row is keyboard-focusable. Action button is also tabbable separately. `:focus-visible` ring per design tokens.

**Priority:** Phase 1.

### 3.9 Sensor Card — `.fl-sensor`

**What:** A small card showing one sensor's current value, 24h delta, and a sparkline.

**HTML:**

```html
<div class="fl-sensor">
  <h4 class="fl-sensor-title">Drive motor amps <span class="fl-mono fl-muted">A1.MOTOR_AMP</span></h4>
  <div class="fl-sensor-val">142.6 A <span class="fl-sensor-delta fl-sensor-delta-up">+8.3% / 24h</span></div>
  <svg viewBox="0 0 100 30" class="fl-sparkline">
    <polyline fill="none" stroke="var(--fl-orange-600)" stroke-width="2"
              points="0,22 10,21 20,22 30,21 40,18 50,17 60,16 70,14 80,12 90,11 100,9"/>
  </svg>
</div>
```

**CSS:** see prototype `.sensor`. Token-substitute.

**Priority:** Phase 1 (Hub Sensors shelf).

### 3.10 Citation Overlay — `.fl-overlay`

**What:** Modal opened when a citation chip is clicked. Shows the doc name, location, exact snippet.

**HTML/CSS:** see prototype `.overlay`. Token-substitute.

**A11y:** `role="dialog" aria-modal="true"`. ESC closes. Focus traps inside the overlay. Focus returns to triggering chip on close.

**Priority:** Phase 0 (homepage hero animation should open it; Phase 1 hub chat uses it).

### 3.11 Compose Bar — `.fl-composer`

**What:** The chat input strip — text input + mic button. Bottom of every chat surface.

**HTML/CSS:** see prototype `.composer`. Token-substitute. Mic button is `.fl-btn-mic` (§3.1).

**Priority:** Phase 1.

### 3.12 Compare Grid — `.fl-compare`

**What:** Side-by-side bad-vs-good comparison block. Used in `/vs-chatgpt-projects` and homepage feature strip.

**HTML/CSS:** see prototype `.compare`, `.col`, `.col.bad`, `.col.good`. Token-substitute.

**Priority:** Phase 0 (homepage) + Phase 1 (`/vs-*` pages).

### 3.13 Trust Band — `.fl-trust-band` *(EXTEND — new)*

**What:** Horizontal strip under the homepage hero. Comma-separated OEM coverage stats and any customer logos as they accrue.

**Why new:** Codex recon flagged this as the highest-impact homepage gap. Doesn't exist in prototype because prototype is product, not marketing.

**HTML:**

```html
<section class="fl-trust-band">
  <div class="fl-trust-eyebrow">68,000+ chunks of OEM documentation indexed</div>
  <ul class="fl-trust-list">
    <li>Rockwell Automation</li>
    <li>Siemens</li>
    <li>AutomationDirect</li>
    <li>ABB</li>
    <li>Yaskawa</li>
    <li>Danfoss</li>
    <li>SEW-Eurodrive</li>
    <li>Mitsubishi</li>
  </ul>
</section>
```

**CSS:**

```css
.fl-trust-band {
  background: var(--fl-card-0);
  padding: var(--fl-sp-8) var(--fl-sp-6);
  text-align: center;
  border-top: 1px solid var(--fl-rule-200);
  border-bottom: 1px solid var(--fl-rule-200);
}
.fl-trust-eyebrow {
  font-size: var(--fl-type-sm);
  letter-spacing: var(--fl-ls-caps);
  text-transform: uppercase;
  color: var(--fl-muted-600);
  margin-bottom: var(--fl-sp-3);
}
.fl-trust-list {
  list-style: none; padding: 0; margin: 0;
  display: flex; flex-wrap: wrap; gap: var(--fl-sp-5);
  justify-content: center;
}
.fl-trust-list li {
  font-size: var(--fl-type-md);
  font-weight: 600;
  color: var(--fl-ink-900);
}
```

**Priority:** Phase 0.

### 3.14 Pricing Card — `.fl-price-card` *(EXTEND — new)*

**What:** One of three tiers. New per brand kit ($0 / $97 / $497).

**Variants:** `.fl-price-card-free`, `.fl-price-card-recommended` (highlighted), `.fl-price-card-premium`.

**HTML:**

```html
<article class="fl-price-card fl-price-card-recommended">
  <header>
    <h3>FactoryLM Projects</h3>
    <p class="fl-price-pitch">Workspace + MIRA + cited answers</p>
  </header>
  <div class="fl-price-amount">
    <span class="fl-price-currency">$</span>
    <span class="fl-price-num">97</span>
    <span class="fl-price-period">/mo/plant</span>
  </div>
  <ul class="fl-price-features">
    <li>Unlimited Projects</li>
    <li>Cited answers from your manuals</li>
    <li>Sensor + photo + work-order linking</li>
    <li>Telegram + Slack + Voice + QR scan</li>
    <li>Sun-readable mode</li>
  </ul>
  <button class="fl-btn fl-btn-primary">Start Free</button>
  <p class="fl-price-fineprint">No credit card. Magic link.</p>
</article>
```

**CSS:** standard card with the recommended variant highlighted via thicker `--fl-orange-600` border + a "Most popular" ribbon.

**Priority:** Phase 0.

### 3.15 Limitations List — `.fl-limits` *(EXTEND — new)*

**What:** The honest "what FactoryLM doesn't do" page. Distinctive enough to share.

**HTML:**

```html
<section class="fl-limits">
  <h2>What FactoryLM doesn't do (yet)</h2>
  <p class="fl-limits-intro">We'd rather you know upfront than be surprised on day 7.</p>
  <ul class="fl-limits-list">
    <li>
      <strong>No PLC tag streaming yet.</strong>
      Reading live Modbus / OPC UA / EtherNet-IP tags is on the post-MVP roadmap (Config 4).
      Today MIRA uses static manual text, photos, and historical sensor exports.
    </li>
    <li>
      <strong>No native CMMS integrations beyond our Atlas.</strong>
      We work alongside MaintainX, Limble, UpKeep — but we don't push work orders into them yet.
      Your Atlas tenant is included; data flows in/out via CSV or our API.
    </li>
    <li>
      <strong>Safety-critical questions don't get a chat answer.</strong>
      LOTO, arc flash, confined space, and similar will escalate to a human you designate.
      MIRA is a research and troubleshooting agent, not a safety advisor.
    </li>
    <!-- ... -->
  </ul>
</section>
```

**CSS:** simple unordered list with bold lead phrases and 1.5rem line-height. Almost no chrome — the honesty IS the design.

**Priority:** Phase 0.

---

## 4. Component sequencing — what to ship when

Mike, this matches the roadmap phases in `docs/website-refactor-roadmap-2026-04-26.md`.

### Phase 0 (this week) — must-ship for the homepage refresh + `/limitations` + 3-tier pricing

| Component | Sized for one Claude Code session? | Issue |
|---|---|---|
| Tokens file `_tokens.css` | Yes — single file, 1-2 hours | `#SO-300` |
| Shared `<head>` partial | Yes — 1 file, 1 hour | `#SO-301` |
| `.fl-btn` (primary, ghost, mic) | Yes | `#SO-302` |
| `.fl-state` four-state pill | Yes | `#SO-303` |
| `.fl-trust-band` | Yes | `#SO-304` |
| `.fl-compare` grid | Yes | `#SO-305` |
| `.fl-stop-card` | Yes | `#SO-306` |
| `.fl-price-card` 3-tier | Yes | `#SO-307` |
| `.fl-limits` list | Yes | `#SO-308` |
| Sun-readable toggle (`.sun` class + JS persist) | Yes | `#SO-309` |

### Phase 1 (W2-W3) — Hub Direction A polish

| Component | Issue |
|---|---|
| `.fl-topbar` + `.fl-tabs` | `#SO-310` |
| `.fl-hero` (asset/crew/investigation variants) | `#SO-311` |
| `.fl-file` row + shelf shell | `#SO-312` |
| `.fl-sensor` card | `#SO-313` |
| `.fl-src-chip` + `.fl-overlay` modal | `#SO-314` |
| `.fl-composer` + chat-rail layout | `#SO-315` |
| `.fl-msg` (user/ai bubble) | `#SO-316` |

### Phase 3 (W6-W8) — Direction B + C

| Component | Issue |
|---|---|
| `.fl-pin` (crew pinned-asset card) | `#SO-317` |
| `.fl-avatars` (overlapping crew avatars) | `#SO-318` |
| `.fl-handoff` (shift handoff card) | `#SO-319` |
| `.fl-tl-row` (timeline row) | `#SO-320` |
| `.fl-rca` (leading hypothesis card) | `#SO-321` |

---

## 5. Implementation guidance

### 5.1 File organization (proposed)

```
mira-web/
├── public/
│   ├── _tokens.css              ← THE design system. Single source of truth. (#SO-300)
│   ├── _components.css          ← All .fl-* component styles. Compiled output. (#SO-310-321 etc.)
│   ├── _head-partial.html       ← Shared <head>. Used by Hono templates + static pages. (#SO-301)
│   ├── index.html               ← Refactored homepage (#SO-100)
│   ├── pricing.html             ← 3-tier pricing (#SO-104)
│   ├── limitations.html         ← New (#SO-005)
│   ├── projects.html            ← INTERNAL ONLY — gated behind admin auth (#SO-322)
│   ├── vs-chatgpt-projects.html ← Public (#SO-103)
│   └── ...
└── src/
    ├── lib/
    │   ├── blog-renderer.ts     ← Refactor to import _tokens.css and use .fl-* classes (#SO-323)
    │   └── feature-renderer.ts  ← Same (#SO-324)
    └── server.ts
```

The compiled `_components.css` is a single concatenation of every component's CSS in the order Phase 0 → Phase 3 above. Static; cached aggressively (1y). Bumped only when components change (use a build-time hash in the URL or a sw.js cache invalidation).

### 5.2 Hono templating (no framework)

Mike, your stack is Hono on Bun — keep it. No need for React on the marketing site. CSS-only components compose cleanly via:

```ts
// src/lib/components.ts (new)
export const trustBand = (oems: string[]) => `
  <section class="fl-trust-band">
    <div class="fl-trust-eyebrow">68,000+ chunks of OEM documentation indexed</div>
    <ul class="fl-trust-list">
      ${oems.map(o => `<li>${o}</li>`).join("")}
    </ul>
  </section>
`;

export const stateBadge = (state: "indexed"|"partial"|"failed"|"superseded", label?: string) => `
  <span class="fl-state fl-state-${state}">
    <span class="fl-state-glyph"></span>${label ?? state}
  </span>
`;
```

Then anywhere in `server.ts` or a renderer:

```ts
import { trustBand, stateBadge } from "./lib/components.js";

const html = `
  <!DOCTYPE html>
  <html>
    ${headPartial({ title: "FactoryLM" })}
    <body>
      ${heroHomepage()}
      ${trustBand(["Rockwell Automation","Siemens","AutomationDirect","ABB","Yaskawa","Danfoss","SEW-Eurodrive","Mitsubishi"])}
      ${faultCodeFeatureStrip([stateBadge("indexed"), stateBadge("partial"), stateBadge("failed"), stateBadge("superseded")])}
    </body>
  </html>
`;
```

Components are pure functions returning strings. Easy to test, easy to reason about, easy for Claude Code to ship one at a time.

### 5.3 Hub framework

Per recent commits the Hub is Next.js 16 — keep React component conventions. Mirror the `.fl-*` classes there too (Tailwind + a `tokens.css` import). Don't fork the design system; it should look identical across both surfaces.

### 5.4 Don't do these

- Don't introduce Tailwind on `mira-web` (the marketing site) — your CSS isn't large enough to justify the build complexity. Keep CSS variables + plain CSS.
- Don't introduce a JS framework on `mira-web`. Hono + bun + plain CSS is faster than anything else for a marketing site. Per launch plan + SEO doc, page speed = SEO ranking.
- Don't ship multiple variants of the same component. One Button. One State Pill. One Citation Chip. If you find yourself making `Button2`, kill the original or merge.

---

## 6. Priority actions (final, ranked)

1. **Ship `_tokens.css` + `_head-partial.html`** (`#SO-300`, `#SO-301`). Single afternoon of work. Unblocks every other improvement.
2. **Build the 5 Phase-0 components** — Button, State Pill, Trust Band, Compare Grid, Stop Card (`#SO-302`-`#SO-306`). Each is one Claude Code session. 5 sessions total.
3. **Refactor homepage** to use new tokens + components (`#SO-100`). One session, depends on Phase-0 components being done.
4. **Refactor `/cmms`** to magic-link form + sample workspace experience (`#SO-070`). One session.
5. **Build pricing 3-tier** (`#SO-104`, depends on `#SO-307` Pricing Card component).
6. **Build `/limitations`** (`#SO-005`, depends on `#SO-308` Limits List component).
7. **Build `/vs-chatgpt-projects`** (`#SO-103`, depends on `#SO-305` Compare Grid component).
8. **Sun-readable toggle** (`#SO-309`). Single session, drops in everywhere.
9. **Hub Direction A polish** — Phase 1 components (`#SO-310`-`#SO-316`). Six sessions total.
10. **Hub Direction B + C** — Phase 3+4 components (`#SO-317`-`#SO-321`). Five sessions; can wait until paying customers.

That's ~25 Claude Code sessions for the full design system implementation across both surfaces. At one session/day that's 5 weeks. At two/day that's under three.
