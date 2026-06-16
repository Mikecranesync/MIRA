# FactoryLM — Web Style Guide
**For:** Design AI / UI work on factorylm.com  
**Stack:** Hono + Bun, server-side rendered HTML strings, vanilla CSS. No React, no Tailwind, no build step.  
**Last extracted:** 2026-05-03 from `/mira-web/public/` and `/mira-web/src/`

---

## 1. Brand Identity

### Voice & Tone
- **Blunt, technical, honest.** "What we don't do yet" exists as a page. No vaporware.
- **Industrial, not consumer.** Users are maintenance techs at 2 AM with grease on their hands.
- **Cited, not confident.** MIRA always attributes answers to a source. The brand inherits that.

### Logo / Wordmark
- **Name:** `FactoryLM` (one word, no space, no TM)
- **Sub-brand:** `MIRA` (all-caps, the AI agent inside)
- **Logo file:** `/public/icons/favicon.svg`
- **OG image:** `/public/og-image.png` (56 KB PNG + SVG variant)
- **PWA icons:** `/public/icons/mira-192.png`, `mira-512.png`, `mira-maskable.png`
- No custom typeface for the wordmark — system sans, navy, tight letter-spacing (`-0.03em`)

### Two Visual Registers
The site runs two distinct visual languages. **Never mix them on the same page.**

| Register | Used on | Background | Accent |
|----------|---------|------------|--------|
| **Light / FactoryLM** | Homepage, blog, limitations, security | Off-white `#F5F6F8` | Orange `#C9531C` |
| **Dark / MIRA** | Pricing, CMMS gate, chat widget | Near-black `#0d0e11` | Amber `#f0a000` |

---

## 2. Color Tokens

All colors are CSS custom properties. Use the variable names — never hardcode hex in new CSS.

### Light Theme (`--fl-*`)

```css
/* Brand */
--fl-navy-900:   #1B365D;   /* headings, logo */
--fl-orange-600: #C9531C;   /* primary CTA, recommended badge */
--fl-orange-500: #E67139;   /* button hover */
--fl-sky-100:    #E6F0FA;   /* hero gradient top */

/* Surfaces */
--fl-bg-50:      #F5F6F8;   /* page background */
--fl-card-0:     #FFFFFF;   /* cards, buttons, nav */
--fl-rule-200:   #E1E5EA;   /* borders, dividers */

/* Text */
--fl-ink-900:    #1B2530;   /* primary body text */
--fl-muted-600:  #5C6770;   /* secondary text, labels */

/* Status */
--fl-good:       #1F8E5A;   /* success / indexed */
--fl-warn:       #C77B0A;   /* warning / partial */
--fl-bad:        #B5341E;   /* error / failed */

/* State pill backgrounds + text */
--fl-state-indexed-bg:      #DCEFE3;
--fl-state-indexed-text:    #16623F;
--fl-state-partial-bg:      #FFF3D6;
--fl-state-partial-text:    #856204;
--fl-state-failed-bg:       #FBDDD3;
--fl-state-failed-text:     #862415;
--fl-state-superseded-bg:   #E2E5E9;
--fl-state-superseded-text: #455261;

/* Safety alert */
--fl-safety-bg:     #FCE9E5;
--fl-safety-border: #B5341E;
--fl-safety-text:   #5A1E13;

/* Compare block */
--fl-compare-bad-bg:     #FCF3F0;
--fl-compare-bad-border: #F0C9C0;
--fl-compare-good-bg:    #F2FAF5;
--fl-compare-good-border:#BCDFCC;
```

### Dark Theme — MIRA Chat Widget (`--mira-*`)

```css
--mira-bg:        #0a0b0d;
--mira-panel:     #0f1114;
--mira-msg-area:  #141720;
--mira-input-bar: #1b1f2b;
--mira-border:    rgba(255,255,255,0.07);
--mira-border-hi: rgba(255,255,255,0.14);
--mira-text:      #e8eaf0;
--mira-muted:     #8a8fa8;
--mira-faint:     #4a4f66;
--mira-amber:     #f0a000;   /* primary accent */
--mira-teal:      #00d4aa;   /* secondary accent */
```

### Dark Theme — CMMS / Pricing Pages

```css
--bg:              #0a0a08;
--surface-1:       #111110;
--surface-2:       #171715;
--surface-3:       #1e1e1b;
--surface-4:       #252522;
--border:          rgba(255,255,255,0.08);
--border-hi:       rgba(255,255,255,0.14);
--amber:           #f0a030;
--amber-bright:    #ffc247;
--green:           #2dd4a0;
--red:             #f04848;
--blue:            #60b8f0;
--text:            #e4e0d8;
--text-secondary:  #b0aca2;
--text-muted:      #7a766c;
--text-faint:      #4a4840;
```

---

## 3. Typography

### Font Stacks

```css
/* Light theme — UI and body */
--fl-font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif;

/* Monospace — sensor data, code, citations */
--fl-font-mono: ui-monospace, SFMono-Regular, Menlo, "Roboto Mono", monospace;

/* Dark theme / CMMS */
font-family: 'DM Sans', system-ui, sans-serif;           /* headings */
font-family: 'Inter', 'Helvetica Neue', sans-serif;       /* body */
font-family: 'IBM Plex Mono', ui-monospace, monospace;    /* data/code */
```

### Type Scale (Light Theme)

```css
--fl-type-xs:   11px;   /* labels, eyebrows, state pills */
--fl-type-sm:   12px;   /* button text, captions, footer links */
--fl-type-base: 14px;   /* body text (default) */
--fl-type-md:   16px;   /* input fields, section body */
--fl-type-lg:   18px;   /* card titles, price tier names */
--fl-type-xl:   22px;   /* section subheadings */
--fl-type-2xl:  24px;   /* section headings */
--fl-type-3xl:  32px;   /* large headings */
--fl-type-4xl:  40px;   /* hero h1 */
```

### Letter Spacing

```css
--fl-ls-tight: -0.2px;   /* headings */
--fl-ls-wide:   0.4px;   /* uppercase labels */
--fl-ls-caps:   0.8px;   /* ALL-CAPS eyebrows */
```

### Type Hierarchy (Light Pages)

| Element | Size | Weight | Spacing | Color |
|---------|------|--------|---------|-------|
| Eyebrow (ALL CAPS) | `--fl-type-xs` 11px | 600 | `--fl-ls-caps` 0.8px | `--fl-muted-600` |
| h1 (hero) | `--fl-type-4xl` 40px | 600 | `--fl-ls-tight` | `--fl-navy-900` |
| h2 (section) | `--fl-type-3xl` 32px | 500 | `--fl-ls-tight` | `--fl-ink-900` |
| h3 (sub) | `--fl-type-xl` 22px | 500 | `--fl-ls-tight` | `--fl-orange-600` |
| Body | `--fl-type-base` 14px | 400 | 0 | `--fl-muted-600` |
| Body large | `--fl-type-md` 16px | 400 | 0 | `--fl-muted-600` |
| Label/pill | `--fl-type-xs` 11px | 700 | `--fl-ls-wide` 0.4px | varies |

### Type Hierarchy (Dark Pages)

| Element | Size | Weight |
|---------|------|--------|
| Eyebrow | 11px | 500, uppercase, 0.12em spacing |
| h1 | `clamp(32px, 5vw, 48px)` | 600 |
| h2 | 24–32px | 500 |
| Body | 14–15px | 300–400 |
| Monospace data | 12–13px | 400 |

---

## 4. Spacing

4px base unit. Use variables — never raw pixel values in new CSS.

```css
--fl-sp-1:   4px;
--fl-sp-2:   8px;
--fl-sp-3:  12px;
--fl-sp-4:  16px;   /* standard component padding */
--fl-sp-5:  20px;
--fl-sp-6:  24px;   /* section inner padding */
--fl-sp-8:  32px;   /* section vertical padding */
--fl-sp-10: 40px;   /* hero / large section padding */
```

---

## 5. Border Radius

```css
--fl-radius-sm:   8px;    /* ghost buttons, stop-card CTAs */
--fl-radius-md:   10px;   /* primary buttons */
--fl-radius-lg:   12px;   /* feature cards, stop card, compare cols */
--fl-radius-xl:   14px;   /* price cards */
--fl-radius-pill: 999px;  /* state badges, trust chips, cite chips */
```

Dark theme uses slightly tighter radii: `4px` inputs, `6px` buttons, `8–10px` cards.

---

## 6. Shadows

```css
/* Light theme */
--fl-shadow-sm: 0 1px 2px rgba(15,23,30,.04), 0 4px 16px rgba(15,23,30,.06);
--fl-shadow-md: 0 4px 12px rgba(0,0,0,.06);
--fl-shadow-lg: 0 24px 48px rgba(0,0,0,.25);

/* Primary button inset highlight */
box-shadow: 0 1px 0 rgba(255,255,255,.2) inset, 0 2px 8px rgba(201,83,28,.32);

/* Dark theme: borders do the work, not shadows */
/* FAB only: 0 8px 24px rgba(240,160,0,0.25) */
```

---

## 7. Animations

```css
/* Easing */
--ease-out:    cubic-bezier(0.16, 1, 0.3, 1);    /* snappy exit */
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1); /* playful bounce */

/* Durations */
--dur-fast: 120ms;   /* button hover */
--dur-mid:  220ms;   /* panel slide */
--dur-slow: 400ms;   /* fade/entrance */
```

**Named keyframes in use:**
- `fadeUp` / `fadeIn` / `slideInRight` — page section entrances
- `mira-fab-pulse` (3s infinite) — FAB button breathing glow
- `mira-think` (1.2s infinite) — three-dot thinking indicator (staggered)
- `mira-wave` (0.8s infinite) — waveform bars during TTS playback
- `mira-shimmer` (1.4s infinite) — skeleton loading state
- `mira-mic-pulse` + `mira-ring-expand` — mic recording state

**Always include:**
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
```

---

## 8. Components

### 8.1 Buttons

#### Primary Button `.fl-btn-primary`
```html
<a href="/cmms" class="fl-btn fl-btn-primary" data-cta="hero-primary">Start Free — magic link</a>
<!-- OR as button: -->
<button type="button" class="fl-btn fl-btn-primary">Submit</button>
```
```css
.fl-btn { display: inline-flex; align-items: center; justify-content: center;
          font-weight: 700; text-decoration: none; cursor: pointer; }

.fl-btn-primary {
  background: var(--fl-orange-600);        /* #C9531C */
  color: #fff;
  border: none;
  border-radius: var(--fl-radius-md);      /* 10px */
  padding: 10px 16px;
  min-height: 40px;
  font-size: var(--fl-type-base);          /* 14px */
  box-shadow: 0 1px 0 rgba(255,255,255,.2) inset, 0 2px 8px rgba(201,83,28,.32);
  transition: background .12s ease;
}
.fl-btn-primary:hover  { background: var(--fl-orange-500); }
.fl-btn-primary:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(201,83,28,.32); }
.fl-btn-primary:disabled { opacity: .5; pointer-events: none; }
```

#### Ghost Button `.fl-btn-ghost`
```html
<a href="/pricing" class="fl-btn fl-btn-ghost" data-cta="hero-secondary">See pricing →</a>
```
```css
.fl-btn-ghost {
  background: var(--fl-card-0);
  color: var(--fl-ink-900);
  border: 1px solid var(--fl-rule-200);
  border-radius: var(--fl-radius-sm);      /* 8px */
  padding: 8px 12px;
  min-height: 40px;
  font-size: var(--fl-type-sm);            /* 12px */
  transition: background .12s ease, border-color .12s ease;
}
.fl-btn-ghost:hover { background: var(--fl-bg-50); }
.fl-btn-ghost:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(201,83,28,.32); }
```

#### Dark Theme Button (Pricing / CMMS)
```css
/* Primary amber */
.btn-primary {
  background: var(--amber);
  color: #000;
  border: none;
  border-radius: 6px;
  padding: 10px 20px;
  font-weight: 600;
  font-size: 14px;
}
/* Ghost */
.btn-ghost {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 6px;
  padding: 9px 18px;
}
```

---

### 8.2 State Badges `.fl-state`

Four-state document status indicator used throughout the KB and ingest views.

```html
<span class="fl-state fl-state-indexed"><span class="fl-state-glyph"></span>Indexed</span>
<span class="fl-state fl-state-partial" role="status"><span class="fl-state-glyph"></span>Partial · Tap to rescan</span>
<span class="fl-state fl-state-failed" role="status"><span class="fl-state-glyph"></span>OCR failed · Tap to retry</span>
<span class="fl-state fl-state-superseded"><span class="fl-state-glyph"></span>Superseded</span>
```
```css
.fl-state {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: var(--fl-type-xs); font-weight: 700;
  letter-spacing: var(--fl-ls-wide); text-transform: uppercase;
  padding: 4px 10px; border-radius: var(--fl-radius-pill);
}
.fl-state-glyph { width: 8px; height: 8px; flex-shrink: 0; }

.fl-state-indexed  { background: var(--fl-state-indexed-bg); color: var(--fl-state-indexed-text); }
.fl-state-indexed  .fl-state-glyph { background: var(--fl-good); border-radius: 50%; }

.fl-state-partial  { background: var(--fl-state-partial-bg); color: var(--fl-state-partial-text); }
.fl-state-partial  .fl-state-glyph { background: var(--fl-warn); transform: rotate(45deg); }

.fl-state-failed   { background: var(--fl-state-failed-bg); color: var(--fl-state-failed-text); }
.fl-state-failed   .fl-state-glyph { background: var(--fl-bad); border-radius: 2px; }

.fl-state-superseded { background: var(--fl-state-superseded-bg); color: var(--fl-state-superseded-text); }
.fl-state-superseded .fl-state-glyph { background: #6B7785; }
```

---

### 8.3 Trust Band `.fl-trust-band`

Credential / social-proof strip. White background, top + bottom border.

```html
<section class="fl-trust-band">
  <p class="fl-trust-eyebrow">68,000+ chunks of OEM documentation indexed</p>
  <ul class="fl-trust-list">
    <li>Allen-Bradley</li><li>Siemens</li><li>ABB</li>
    <li>Schneider Electric</li><li>Danfoss</li><li>Yaskawa</li>
    <li>Rockwell</li><li>Eaton</li>
  </ul>
</section>
```
```css
.fl-trust-band { background: var(--fl-card-0); padding: var(--fl-sp-8) var(--fl-sp-6);
                 border-top: 1px solid var(--fl-rule-200); border-bottom: 1px solid var(--fl-rule-200);
                 text-align: center; }
.fl-trust-eyebrow { font-size: var(--fl-type-sm); letter-spacing: var(--fl-ls-caps);
                    text-transform: uppercase; color: var(--fl-muted-600); margin-bottom: var(--fl-sp-3); }
.fl-trust-list { display: flex; flex-wrap: wrap; gap: var(--fl-sp-5);
                 justify-content: center; list-style: none; margin: 0; padding: 0; }
.fl-trust-list li { font-size: var(--fl-type-md); font-weight: 600; color: var(--fl-ink-900); }
```

---

### 8.4 Compare Block `.fl-compare`

Side-by-side "ChatGPT vs MIRA" comparison. Red-tinted bad column, green-tinted good column.

```html
<div class="fl-compare">
  <p class="fl-compare-q">"Why is the Powerflex 755 tripping F005 at 1,200 RPM?"</p>
  <div class="fl-compare-grid">
    <div class="fl-col fl-col-bad">
      <h3 class="fl-col-h-bad">ChatGPT Projects</h3>
      <blockquote>F005 is typically caused by undervoltage…</blockquote>
      <p class="fl-col-note">Generic — no plant context, no manual citation.</p>
    </div>
    <div class="fl-col fl-col-good">
      <h3 class="fl-col-h-good">MIRA</h3>
      <blockquote>F005 on this drive (Asset POW-755-A12) means DC bus undervoltage…</blockquote>
      <div class="fl-col-citations">
        <span class="fl-cite-chip">Manual §6.2 (PowerFlex 755)</span>
        <span class="fl-cite-chip">PM 2024-12-14</span>
        <span class="fl-cite-chip">Trips: last 7d</span>
      </div>
    </div>
  </div>
</div>
```
```css
.fl-compare-q { font-size: var(--fl-type-base); font-weight: 600; font-style: italic;
                color: var(--fl-muted-600); margin-bottom: var(--fl-sp-3); }
.fl-compare-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--fl-sp-4); align-items: stretch; }
.fl-col { border-radius: var(--fl-radius-lg); padding: var(--fl-sp-4); }
.fl-col-bad  { border: 1px solid #F0C9C0; background: #FCF3F0; }
.fl-col-good { border: 1px solid #BCDFCC; background: #F2FAF5; }
.fl-cite-chip { background: var(--fl-card-0); border: 1px solid var(--fl-rule-200);
                border-radius: var(--fl-radius-pill); padding: 3px 9px;
                font-size: var(--fl-type-xs); font-weight: 600; color: var(--fl-navy-900); }
@media (max-width: 879px) { .fl-compare-grid { grid-template-columns: 1fr; } }
```

---

### 8.5 Stop Card `.fl-stop-card`

Safety-critical alert. Red border + background. Used when MIRA detects a hazard.

```html
<div class="fl-stop-card" role="alert">
  <h4>⚠ STOP — Voltage above safe range</h4>
  <p>MIRA detected 480 V on a 240 V branch via the photo sent at 02:14. Do not energize.</p>
  <div class="fl-stop-cta">
    <button type="button" class="fl-stop-btn">Acknowledge</button>
    <button type="button" class="fl-stop-btn">Call supervisor</button>
  </div>
</div>
```
```css
.fl-stop-card { background: var(--fl-safety-bg); border: 1.5px solid var(--fl-safety-border);
                border-radius: var(--fl-radius-lg); padding: 14px; color: var(--fl-safety-text); }
.fl-stop-card h4 { color: var(--fl-safety-border); font-size: var(--fl-type-base);
                   letter-spacing: var(--fl-ls-wide); text-transform: uppercase; margin: 0 0 6px; }
.fl-stop-btn { background: var(--fl-card-0); border: 1px solid var(--fl-safety-border);
               color: var(--fl-safety-border); border-radius: var(--fl-radius-sm);
               padding: 8px 12px; font-weight: 700; font-size: var(--fl-type-sm); cursor: pointer; }
.fl-stop-btn:hover { background: var(--fl-safety-bg); }
.fl-stop-btn:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(181,52,30,.32); }
```

---

### 8.6 Price Cards `.fl-price-card`

Three-column pricing grid. Middle card is the recommended tier.

```html
<div class="fl-price-grid">
  <div class="fl-price-card"><!-- Starter --></div>
  <div class="fl-price-card fl-price-card-recommended">
    <span class="fl-price-ribbon">Most popular</span>
    <!-- Pro -->
  </div>
  <div class="fl-price-card"><!-- Enterprise --></div>
</div>
```
```css
.fl-price-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--fl-sp-4); }
.fl-price-card { background: var(--fl-card-0); border: 1px solid var(--fl-rule-200);
                 border-radius: var(--fl-radius-xl); padding: var(--fl-sp-6);
                 box-shadow: var(--fl-shadow-sm); display: flex; flex-direction: column;
                 gap: var(--fl-sp-4); position: relative; }
.fl-price-card-recommended { border: 2px solid var(--fl-orange-600); transform: scale(1.02); }
.fl-price-ribbon { position: absolute; top: -1px; right: var(--fl-sp-4);
                   background: var(--fl-orange-600); color: #fff;
                   font-size: var(--fl-type-xs); font-weight: 700;
                   letter-spacing: var(--fl-ls-caps); text-transform: uppercase;
                   padding: 4px 10px; border-radius: 0 0 var(--fl-radius-sm) var(--fl-radius-sm); }
.fl-price-name { font-size: var(--fl-type-lg); font-weight: 700; color: var(--fl-navy-900); margin: 0; }
.fl-price-num  { font-size: var(--fl-type-4xl); font-weight: 700; color: var(--fl-ink-900); line-height: 1; }
.fl-price-period { font-size: var(--fl-type-base); font-weight: 500; color: var(--fl-muted-600); }
.fl-price-features { list-style: none; display: flex; flex-direction: column; gap: var(--fl-sp-2); flex: 1; }
.fl-price-features li::before { content: "✓ "; color: var(--fl-good); font-weight: 700; }
@media (max-width: 879px) { .fl-price-grid { grid-template-columns: 1fr; } .fl-price-card-recommended { transform: none; } }
```

---

### 8.7 Navigation `.fl-topbar`

```html
<header class="fl-topbar" role="banner">
  <a class="fl-topbar-brand" href="/" aria-label="FactoryLM home">FactoryLM</a>
  <nav class="fl-topbar-nav" aria-label="Primary">
    <a href="/cmms" data-cta="nav-cmms">CMMS</a>
    <a href="/pricing" data-cta="nav-pricing">Pricing</a>
    <a href="/blog" data-cta="nav-blog">Blog</a>
    <a href="/limitations" data-cta="nav-limitations">Limitations</a>
    <a href="/security" data-cta="nav-security">Security</a>
  </nav>
  <div class="fl-topbar-cta">
    <a href="/cmms" class="fl-btn fl-btn-ghost" data-cta="nav-signin">Sign in</a>
  </div>
</header>
```
```css
.fl-topbar { height: 56px; padding: 0 var(--fl-sp-6); background: var(--fl-card-0);
             border-bottom: 1px solid var(--fl-rule-200);
             display: flex; align-items: center; justify-content: space-between; }
.fl-topbar-brand { font-size: 18px; font-weight: 700; color: var(--fl-navy-900);
                   letter-spacing: -0.03em; text-decoration: none; }
.fl-topbar-nav { display: flex; gap: var(--fl-sp-5); }
.fl-topbar-nav a { font-size: var(--fl-type-sm); color: var(--fl-ink-900); text-decoration: none; }
.fl-topbar-nav a:hover { color: var(--fl-navy-900); text-decoration: underline; }

/* Dark nav (pricing/cmms pages) */
.fl-topbar.dark { background: rgba(13,14,17,0.85); backdrop-filter: blur(12px);
                  border-bottom-color: var(--border); position: sticky; top: 0; z-index: 100; }
.fl-topbar.dark .fl-topbar-brand,
.fl-topbar.dark .fl-topbar-nav a { color: rgba(255,255,255,0.6); }
.fl-topbar.dark .fl-topbar-nav a:hover { color: #fff; }
```

---

### 8.8 Hero Section `.fl-hero`

```html
<section class="fl-hero" aria-labelledby="fl-hero-h1">
  <div class="fl-hero-inner">
    <p class="fl-hero-eyebrow">Industrial Maintenance, AI-native</p>
    <h1 id="fl-hero-h1" class="fl-hero-h1">FactoryLM</h1>
    <h2 class="fl-hero-h2">The AI workspace for industrial maintenance.</h2>
    <h3 class="fl-hero-h3">Meet <strong>MIRA</strong> — your agent on the floor.</h3>
    <p class="fl-hero-sub">Manuals, sensors, photos, work orders, investigations — organized into Projects. MIRA answers from cited sources at 2 AM, when you scan the QR sticker on a broken machine.</p>
    <div class="fl-hero-cta">
      <a href="/cmms" class="fl-btn fl-btn-primary" data-cta="hero-primary">Start Free — magic link</a>
      <a href="/pricing" class="fl-btn fl-btn-ghost" data-cta="hero-secondary">See pricing →</a>
    </div>
  </div>
</section>
```
```css
.fl-hero { background: linear-gradient(180deg, var(--fl-sky-100) 0%, var(--fl-bg-50) 100%);
           padding: var(--fl-sp-10) var(--fl-sp-6); text-align: center; }
.fl-hero-inner { max-width: 880px; margin: 0 auto; }
.fl-hero-eyebrow { font-size: var(--fl-type-xs); letter-spacing: var(--fl-ls-caps);
                   text-transform: uppercase; color: var(--fl-muted-600); margin-bottom: var(--fl-sp-3); }
.fl-hero-h1 { font-size: var(--fl-type-4xl); font-weight: 600; color: var(--fl-navy-900);
              letter-spacing: var(--fl-ls-tight); margin: 0 0 var(--fl-sp-2); }
.fl-hero-h2 { font-size: var(--fl-type-3xl); font-weight: 500; color: var(--fl-ink-900);
              letter-spacing: var(--fl-ls-tight); margin: 0 0 var(--fl-sp-2); }
.fl-hero-h3 { font-size: var(--fl-type-xl); font-weight: 500; color: var(--fl-orange-600);
              margin: 0 0 var(--fl-sp-4); }
.fl-hero-sub { font-size: var(--fl-type-md); color: var(--fl-muted-600); line-height: 1.55;
               max-width: 720px; margin: 0 auto var(--fl-sp-6); }
.fl-hero-cta { display: flex; gap: var(--fl-sp-3); justify-content: center; flex-wrap: wrap; }
```

---

### 8.9 Footer `.fl-footer`

```html
<footer class="fl-footer" role="contentinfo">
  <div class="fl-footer-inner">
    <p class="fl-footer-brand">FactoryLM · Built for industrial maintenance.</p>
    <ul class="fl-footer-links">
      <li><a href="/limitations">Limitations</a></li>
      <li><a href="/trust">Trust</a></li>
      <li><a href="/privacy">Privacy</a></li>
      <li><a href="/terms">Terms</a></li>
    </ul>
    <button type="button" id="fl-sun-toggle" class="fl-sun-toggle"
            aria-pressed="false" aria-label="Toggle high-contrast outdoor mode">
      ☀ Sun-readable
    </button>
  </div>
</footer>
```
```css
.fl-footer { border-top: 1px solid var(--fl-rule-200); background: var(--fl-card-0);
             padding: var(--fl-sp-8) var(--fl-sp-6); }
.fl-footer-inner { max-width: 1080px; margin: 0 auto;
                   display: flex; flex-wrap: wrap; gap: var(--fl-sp-5);
                   align-items: center; justify-content: space-between; }
.fl-footer-brand { font-size: var(--fl-type-sm); color: var(--fl-muted-600); }
.fl-footer-links { display: flex; gap: var(--fl-sp-5); list-style: none; padding: 0; margin: 0; }
.fl-footer-links a { font-size: var(--fl-type-sm); color: var(--fl-ink-900); text-decoration: none; }
.fl-footer-links a:hover { color: var(--fl-navy-900); text-decoration: underline; }
```

---

## 9. Layout

### Max Widths
- Content sections: `max-width: 1080px; margin: 0 auto;`
- Hero inner: `max-width: 880px; margin: 0 auto;`
- Body text / subtitles: `max-width: 720px;`

### Section Padding
```css
.fl-section { max-width: 1080px; margin: 0 auto; padding: var(--fl-sp-10) var(--fl-sp-6); }
```

### Breakpoints
```css
@media (max-width: 879px)  { /* tablet — 2-column → 1-column grids */ }
@media (max-width: 759px)  { /* mobile — reduce padding, stack nav */ }
@media (max-width: 374px)  { /* small mobile — full-width panels */ }
```

---

## 10. Accessibility Requirements

Every new page must include all of the following:

```html
<!-- Skip link (first element in <body>) -->
<a class="fl-skip-link" href="#main-content">Skip to main content</a>

<!-- Focus styles -->
:focus-visible { outline: 2px solid var(--fl-orange-600); outline-offset: 3px; }

<!-- High-contrast outdoor mode (toggle in footer) -->
/* body.sun overrides: all color → black/white, borders → 2px solid #000,
   font-weight → 500, shadows → none */
```

- All interactive elements keyboard-accessible (Tab + Enter/Space)
- `aria-label` on icon-only buttons
- `role="alert"` on stop cards, `role="status"` on partial/failed badges
- `role="banner"` on `<header>`, `role="contentinfo"` on `<footer>`
- Images: `loading="lazy" decoding="async"` + descriptive `alt`
- Font size minimum `16px` on `<input>` to prevent iOS auto-zoom

---

## 11. Pages Reference

| URL | Theme | Purpose | Key sections |
|-----|-------|---------|--------------|
| `/` | Light | Product pitch | Nav · Hero · Trust band · Project cards · Compare · Feature strip · Pricing teaser · Footer |
| `/pricing` | Dark | Pricing grid | Sticky nav · Hero · 3-column price cards · Compare table · FAQ · Footer |
| `/cmms` | Dark | CMMS registration | Sticky nav · Hero · Magic link form · 3 steps · Compare · FAQ |
| `/blog` | Light | Articles + fault-code library | Nav · Article wrap · Footer |
| `/limitations` | Light | Honest "what we don't do yet" | Nav · Numbered limits list · Footer |
| `/security` | Light | Security + compliance | Nav · Content · Footer |
| `/activated` | Light (auth) | Post-payment upload page | Minimal nav · Upload form |

---

## 12. HTML Conventions

```html
<!-- data-cta attribute on every interactive element (analytics) -->
<a href="/cmms" class="fl-btn fl-btn-primary" data-cta="hero-primary">Start Free</a>

<!-- Semantic section structure -->
<main id="main-content" role="main">
  <section aria-labelledby="section-heading-id">
    <h2 id="section-heading-id">Section Title</h2>
    ...
  </section>
</main>

<!-- No inline styles. No !important. No id-based styling. -->
<!-- Classes only. Prefix: fl- (light), mira- (chat), no prefix (dark CMMS/pricing). -->
```

---

## 13. CSS File Map

| File | Scope |
|------|-------|
| `/public/_tokens.css` | All `--fl-*` custom properties (light theme) |
| `/public/_components.css` | `.fl-btn`, `.fl-state`, `.fl-trust-band`, `.fl-compare`, `.fl-stop-card`, `.fl-price-card`, `.fl-topbar`, `.fl-hero`, `.fl-footer` |
| `/public/mira-chat.css` | `--mira-*` tokens, FAB, chat panel, message bubbles, input bar |
| `/public/cmms.css` | Dark CMMS theme, form, steps |
| `/public/blog.css` | Article typography, code blocks |
| `pricing.html` (inline) | Dark pricing page tokens + layout (self-contained) |

---

## 14. Quick Reference Card

```
Primary CTA    → orange #C9531C, 10px radius, 700 weight, white text
Ghost CTA      → white bg, #E1E5EA border, 8px radius, 12px text
Headings       → navy #1B365D, -0.2px tracking
Body text      → #5C6770 muted, 14–16px, 1.55 line-height
Background     → #F5F6F8 page, #FFFFFF cards
Borders        → #E1E5EA
Success        → #1F8E5A
Warning        → #C77B0A
Error          → #B5341E
Safety alert   → red border #B5341E on light-red bg #FCE9E5
Dark accent    → amber #f0a000 (MIRA chat + pricing)
Max content    → 1080px
Max hero       → 880px
Base unit      → 4px
```
