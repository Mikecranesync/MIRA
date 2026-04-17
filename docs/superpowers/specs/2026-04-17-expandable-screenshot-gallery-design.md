# Expandable Screenshot Gallery — Design Spec

**Date:** 2026-04-17
**Status:** Draft
**Author:** Mike Harper + Claude

---

## Problem

The factorylm.com homepage features 3 product capability sections (Fault Diagnosis, CMMS Integration, Voice+Vision). Each currently uses 4 dark HMI-style telemetry cards with monospace data rows to illustrate the workflow. These cards describe what the product does in abstract terms — they don't show it. Visitors can't see the actual product UI.

## Solution

Replace the telemetry cards with an **Expandable Screenshot Gallery** (horizontal image accordion) — real product screenshots captured automatically via Playwright from the live MIRA deployment. The gallery uses a 3-state interaction: resting thumbnails → hover expand with caption → click lightbox with full description and link to feature page.

**Pattern name:** Horizontal Image Accordion / Expandable Gallery
**Used by:** Linear, Arc Browser, Attio, Craft, Framer

---

## Part 1: Screenshot Capture (Playwright)

### Script

`tools/capture-screenshots.py` — Python + `playwright`, run via `uv`

### Target

Live VPS production: `https://app.factorylm.com` (Open WebUI) and `https://cmms.factorylm.com` (Atlas CMMS). Configurable via `--base-url` flag.

### Authentication

Uses `OPENWEBUI_API_KEY` env var (from Doppler) to authenticate with Open WebUI API. Atlas CMMS uses `PLG_ATLAS_ADMIN_USER` / `PLG_ATLAS_ADMIN_PASSWORD`.

### Screenshots (12 total, 4 per feature)

**Fault Diagnosis** (`fault-diagnosis-{01-04}.webp`):
1. User typing fault code query into Open WebUI chat ("What does F-012 mean on a PowerFlex 753?")
2. MIRA's response mid-stream showing cited diagnosis with manual reference
3. Full response with root cause, corrective action, and page citation
4. Auto-created work order confirmation in the chat

**CMMS Integration** (`cmms-integration-{01-04}.webp`):
1. Atlas CMMS work order list view with active/open orders
2. Work order detail showing AI-generated description, parts, priority
3. Asset registry showing equipment with status indicators
4. PM schedule calendar view

**Voice + Vision** (`voice-vision-{01-04}.webp`):
1. Open WebUI chat with photo upload (equipment nameplate or fault screen)
2. MIRA's vision response identifying the component from the photo
3. Full diagnostic response with part number cross-reference
4. Chat showing the complete conversation thread with photo + response

### Capture settings

- Viewport: `1280 x 800`
- Crop: Chat area only (no browser chrome, no Open WebUI sidebar)
- Output: `mira-web/public/screenshots/{feature-slug}-{01-04}.webp`
- Optimization: PIL resize to 640px wide, WebP format (~30-50KB each)
- Total payload: ~400-600KB for all 12 screenshots

### Run command

```bash
uv run tools/capture-screenshots.py --base-url https://app.factorylm.com
```

### Dependencies

```
playwright>=1.49,<2
Pillow>=11,<12
```

Added to a `[tool.uv.sources]` or inline script metadata block. Playwright browser install: `playwright install chromium`.

---

## Part 2: Expandable Gallery Component

### Interaction model (3 states)

**State 1 — Resting:**
- 4 screenshots in a horizontal flex row
- Each thumbnail: ~180px wide, equal height, 6px border-radius
- Subtle border (`var(--border)`) matching existing card style
- Caption label below each image (11px, uppercase, `var(--text-dim)`)
- All 4 visible at once, no scrolling on desktop

**State 2 — Hover Expand:**
- Hovered screenshot grows to ~480px wide via `transition: flex 0.3s var(--ease-out)`
- Siblings shrink proportionally (flex-based, no absolute positioning)
- Description overlay fades in at the bottom of the expanded image
  - Dark gradient background (`rgba(0,0,0,0.7)` → transparent)
  - White text, 14px, max 2 lines
- Expanded card gets amber glow border: `box-shadow: 0 0 20px rgba(240,160,0,0.15)`
- Cursor changes to pointer to indicate clickability

**State 3 — Lightbox:**
- Click expanded screenshot → centered overlay at ~80vw (max 960px)
- Dark backdrop (`rgba(0,0,0,0.85)`) dims the page
- Screenshot at full resolution with rounded corners
- Below the image: full description text (the storytelling currently in telemetry rows)
- "See full feature →" amber CTA button links to `/feature/{slug}`
- Close via: Escape key, backdrop click, or X button (top-right)
- Entry animation: scale from 0.9 → 1.0, opacity 0 → 1, 200ms ease-out

**Mobile (< 768px):**
- Gallery becomes horizontal scroll strip (`overflow-x: auto`, snap scroll)
- No hover state — tap opens lightbox directly
- Swipe to scroll between screenshots
- Lightbox fills 95vw on mobile

### Data structure

Each screenshot is an `<img>` inside the gallery with `data-*` attributes:

```html
<div class="sg-gallery" data-feature="fault-diagnosis">
  <div class="sg-item" 
       data-caption="Ask any fault code"
       data-description="Type or voice a fault code into chat. MIRA searches your uploaded OEM manuals and returns a cited answer in seconds."
       data-feature-url="/feature/fault-diagnosis">
    <img src="/public/screenshots/fault-diagnosis-01.webp" 
         alt="User asks MIRA about PowerFlex F-012 fault code"
         loading="lazy" width="640" height="400">
    <span class="sg-caption">Ask any fault code</span>
  </div>
  <!-- ... 3 more items -->
</div>
```

### CSS classes

| Class | Purpose |
|-------|---------|
| `.sg-gallery` | Flex container, horizontal row, gap 8px |
| `.sg-item` | Flex child, `flex: 1`, transitions flex on hover |
| `.sg-item:hover` | `flex: 3`, amber glow border |
| `.sg-item img` | `width: 100%`, `object-fit: cover`, border-radius |
| `.sg-caption` | Below-image label, 11px uppercase |
| `.sg-overlay` | Description text overlay on hover (gradient bg) |
| `.sg-lightbox` | Fixed overlay, centered, backdrop blur |
| `.sg-lightbox-img` | Large image in lightbox |
| `.sg-lightbox-desc` | Description text below lightbox image |
| `.sg-lightbox-cta` | Amber "See full feature →" button |
| `.sg-lightbox-close` | X button, top-right |

### JS (~40 lines)

Single `<script>` block at bottom of page:
- `click` handler on `.sg-item` → creates/shows lightbox
- `click` handler on `.sg-lightbox-close` / backdrop → closes lightbox
- `keydown` handler for Escape → closes lightbox
- `click` handler on `.sg-lightbox-cta` → `window.location = featureUrl`

No framework. No build step. No external dependencies.

---

## Part 3: Integration Points

### Homepage (`mira-web/public/index.html`)

**Replace** the 3 sets of `.slide` containers (each containing 4 telemetry cards) with `.sg-gallery` containers holding 4 screenshot `<img>` elements each.

**Keep**: The surrounding section layout (`.inner`, section headers, feature descriptions, "Learn more →" links). Only the slide/card area changes.

**Add**: CSS for `.sg-*` classes in the existing `<style>` block. JS handler in the existing `<script>` block.

### Feature pages (`mira-web/src/lib/feature-renderer.ts`)

**Replace** the `renderSlide()` output (`.feature-detail-slide` cards) with the same `.sg-gallery` markup, but scoped to that feature's 4 screenshots.

**Replace** the `FeatureSlide` interface with a new `FeatureScreenshot` interface containing `src`, `alt`, `caption`, and `description` fields. Update the `Feature` type to use `screenshots: FeatureScreenshot[]` instead of `slides: FeatureSlide[]`.

**Add** CSS for `.sg-*` classes in the `renderFeaturePage()` template.

### Screenshot data

Add screenshot metadata to the `FEATURES` record in `feature-renderer.ts`:

```typescript
screenshots: [
  { src: "/public/screenshots/fault-diagnosis-01.webp",
    alt: "User asks MIRA about PowerFlex F-012 fault code",
    caption: "Ask any fault code",
    description: "Type or voice a fault code into chat..." },
  // ... 3 more
]
```

Homepage `index.html` gets the same data as static HTML (no SSR needed — it's already static).

---

## Part 4: File Changes

| File | Change |
|------|--------|
| `tools/capture-screenshots.py` | **NEW** — Playwright capture script |
| `mira-web/public/screenshots/` | **NEW** — 12 WebP screenshot files |
| `mira-web/public/index.html` | Replace `.slide` sections with `.sg-gallery`, add CSS + JS |
| `mira-web/src/lib/feature-renderer.ts` | Add `screenshots` to Feature interface, replace `renderSlide()` with gallery markup |

---

## Part 5: Verification

1. **Playwright script**: Run against VPS, confirm 12 screenshots captured at correct dimensions
2. **Homepage gallery**: Open `localhost:3200`, hover each screenshot expands, click opens lightbox, CTA links to feature page
3. **Feature pages**: Visit `/feature/fault-diagnosis`, confirm gallery renders with that feature's 4 screenshots
4. **Mobile**: Resize to 375px, confirm horizontal scroll + tap-to-lightbox
5. **Performance**: Lighthouse check — lazy-loaded WebP images should not regress LCP
6. **Accessibility**: Lightbox traps focus, Escape closes, all images have alt text

---

## What this does NOT include

- Video embeds (Loom placeholders stay as-is, screenshots replace only the telemetry cards)
- MIRA Connect screenshots (deferred until relay is deployed)
- CI automation of screenshot capture (manual `uv run` for now)
- Screenshot diffing / visual regression testing
