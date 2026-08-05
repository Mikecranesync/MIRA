# PrintSense Free Technician Hook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/printsense` into a Telegram-first free technician hook that makes one action obvious: send one print or fault question and get a cited, read-only answer.

**Architecture:** Keep the existing Hono route and backend lead-capture behavior in `mira-web/src/routes/printsense.ts`. Treat PR #2979 as design reference only; do not merge its static `mira-web/public/printsense.html`, mock form, unverified pricing, emoji icons, or unverified metrics. Use the current route's server-rendered page, existing `_tokens.css` dark datasheet tokens, and route tests as the source of truth.

**Tech Stack:** Bun, Hono, server-rendered HTML string, inline route CSS, existing FactoryLM CSS tokens, `bun:test`, in-app browser visual QA.

## Global Constraints

- Primary conversion is the free technician action: `Try one print in Telegram`.
- Secondary conversion is the paid package path: `Have a full package? Talk to Mike`.
- No `$49`, plan tiers, "MOST POPULAR", "5 free reads", or other unverified pricing.
- No unverified proof metrics such as `68,000+`, `0 confident misreads`, or `<60s`.
- Keep the honest claims: `does not replace engineering review`, human review, read-only behavior, synthetic examples, unresolved gaps, and safety escalation.
- Keep F004 truth aligned with the vendored drive pack: PowerFlex 525 `F004 = UnderVoltage`.
- Use existing `--fl-dark-*` tokens. Do not introduce hardcoded hex color literals inside `mira-web/src/routes/printsense.ts`.
- Do not add emoji icons to the routed page; keep inline SVG or text badges.
- Do not add browser upload to this page. The free entrypoint is Telegram.
- Do not change live email/send behavior.

---

## File Structure

- Modify: `mira-web/src/routes/printsense.ts`
  - Owns the `/printsense` HTML, CSS, Telegram CTA copy, interest form copy, and content-free funnel events.
- Modify: `mira-web/src/__tests__/printsense-landing.test.ts`
  - Locks the free technician hook, honesty constraints, CTA hierarchy, and no-unverified-claims rules.
- Modify: `mira-web/src/lib/sitemap.ts`
  - Adds `/printsense` to static indexable marketing pages after the page version is accepted.
- Modify: `mira-web/src/lib/__tests__/sitemap.test.ts`
  - Locks `/printsense` as an indexable page.
- Optional later modify: `mira-web/src/views/_topbar.ts` and related tests
  - Only if the visual review decides PrintSense should be in shared navigation now. The first implementation should avoid this unless requested, because nav changes affect multiple pages.

---

### Task 1: Lock the Free Technician Hook Contract

**Files:**
- Modify: `mira-web/src/__tests__/printsense-landing.test.ts`

**Interfaces:**
- Consumes: `printsensePage.request("/printsense")`
- Produces: A test contract that later route changes must satisfy.

- [ ] **Step 1: Add the failing test for Telegram-first positioning**

Add this test near the existing GET test:

```ts
test("GET /printsense is a free technician hook, not a pricing page", async () => {
  const res = await printsensePage.request("/printsense");
  expect(res.status).toBe(200);
  const html = await res.text();

  expect(html).toContain("Try one print in Telegram");
  expect(html).toContain("Have a full package? Talk to Mike");
  expect(html).toContain("Send one print page or one fault question");
  expect(html).toContain("read-only");
  expect(html).toContain("does not replace engineering review");

  expect(html).not.toContain("$49");
  expect(html).not.toContain("MOST POPULAR");
  expect(html).not.toContain("5 free reads");
  expect(html).not.toContain("68,000");
  expect(html).not.toContain("confident misreads");
});
```

- [ ] **Step 2: Add the CTA hierarchy test**

Add this test:

```ts
test("GET /printsense keeps Telegram as the primary action", async () => {
  const res = await printsensePage.request("/printsense");
  const html = await res.text();

  const telegramCount = (html.match(/https:\/\/t\.me\/FactoryLM_Diagnose/g) ?? []).length;
  expect(telegramCount).toBeGreaterThanOrEqual(3);
  expect(html).toContain('data-cta="printsense-hero-telegram"');
  expect(html).toContain('data-cta="printsense-final-telegram"');
  expect(html).toContain('href="#pilot"');
});
```

- [ ] **Step 3: Run test to verify it fails**

Run:

```bash
cd mira-web
bun test src/__tests__/printsense-landing.test.ts
```

Expected: FAIL because the current page says `Try in Telegram` and `Analyze my complete machine package`, not the new hook copy.

- [ ] **Step 4: Commit**

Do not commit yet if running in a detached Codex worktree. If on a normal branch, commit after Task 2 passes with:

```bash
git add mira-web/src/__tests__/printsense-landing.test.ts
git commit -m "test(printsense): lock free technician hook"
```

---

### Task 2: Redesign the Hero Around the Cited Answer Card

**Files:**
- Modify: `mira-web/src/routes/printsense.ts`
- Test: `mira-web/src/__tests__/printsense-landing.test.ts`

**Interfaces:**
- Consumes: The test contract from Task 1.
- Produces: Updated `PAGE` HTML with Telegram-first hero and stronger cited-answer card.

- [ ] **Step 1: Change the nav and hero CTAs**

In `PAGE`, replace the visible CTA copy:

```html
<a class="ps-nav-cta" href="https://t.me/FactoryLM_Diagnose" data-cta="printsense-nav-telegram">Try one print in Telegram</a>
```

In the hero, use:

```html
<h1>Ask about a print. Get the answer and its source.</h1>
<p class="ps-lede"><strong>Send one print page or one fault question.</strong>
PrintSense returns a cited, read-only answer with the source attached, the gaps called out,
and safety limits escalated. It does not replace engineering review.</p>
<a class="ps-cta" href="https://t.me/FactoryLM_Diagnose" data-cta="printsense-hero-telegram">Try one print in Telegram</a>
<a class="ps-cta-ghost" href="#pilot" data-cta="printsense-hero-package">Have a full package? Talk to Mike</a>
<p class="ps-note">No browser upload here. Telegram is the free entrypoint. Read-only, cited, and honest about uncertainty.</p>
```

- [ ] **Step 2: Make the answer card feel like the product**

Keep the existing F004/PowerFlex 525 facts, but update the card labels to make the proof structure more legible:

```html
<div class="q">&ldquo;PowerFlex 525 keeps tripping F004 overnight. What should I check first?&rdquo;
  <small>Example answer shape. Synthetic material.</small></div>
<div class="a">F004 on this drive is an <strong>UnderVoltage</strong> trip. The manual's
  fault list points to DC bus voltage falling below the minimum. With an overnight-only
  pattern, check incoming supply for off-shift sag before changing drive parameters.
  Anything unreadable from the print stays unresolved below the answer.</div>
<div class="ps-cites">
  <span class="ps-cite">${I_DOC} PowerFlex 525 User Manual &middot; fault list</span>
  <span class="ps-cite">${I_DOC} submitted print &middot; page + location</span>
</div>
<div class="ps-foot"><span class="ps-badge ok">${I_CHECK} CITED</span>
  <span><strong>Source attached.</strong> Gap list included. Human-reviewed before use.</span></div>
```

- [ ] **Step 3: Tighten first-viewport CSS**

Adjust only these selectors in `printsense.ts`:

```css
.ps-hero{padding:62px 0 52px;border-bottom:1px solid var(--fl-dark-line);display:grid;
  grid-template-columns:minmax(0,0.95fr) minmax(360px,1.05fr);gap:44px;align-items:center}
.ps-answer{background:var(--fl-dark-surface);border:1px solid var(--fl-dark-line-hi);
  border-radius:8px;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.32)}
.ps-answer.hero-card{transform:translateY(8px)}
@media(max-width:900px){.ps-hero{grid-template-columns:1fr}.ps-answer.hero-card{transform:none}}
```

Add `hero-card` to the hero answer card:

```html
<div class="ps-answer hero-card">
```

- [ ] **Step 4: Run the focused test**

Run:

```bash
cd mira-web
bun test src/__tests__/printsense-landing.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

If on a normal branch:

```bash
git add mira-web/src/routes/printsense.ts mira-web/src/__tests__/printsense-landing.test.ts
git commit -m "feat(printsense): make landing page Telegram first"
```

---

### Task 3: Replace the Middle Page With a Technician Trial Flow

**Files:**
- Modify: `mira-web/src/routes/printsense.ts`
- Test: `mira-web/src/__tests__/printsense-landing.test.ts`

**Interfaces:**
- Consumes: Existing CSS classes `.ps-block`, `.ps-card`, `.ps-gallery`, `.ps-answer`, `.ps-badge`.
- Produces: A page sequence that answers "what happens if I try this right now?"

- [ ] **Step 1: Add a test for the trial flow**

Add:

```ts
test("GET /printsense explains the one-print trial flow", async () => {
  const res = await printsensePage.request("/printsense");
  const html = await res.text();

  expect(html).toContain("Try it in three steps");
  expect(html).toContain("1. Send the print or fault question");
  expect(html).toContain("2. Get a cited answer");
  expect(html).toContain("3. Use the answer as evidence, not sign-off");
  expect(html).toContain("UNRESOLVED");
  expect(html).toContain("IMPORT HELD");
  expect(html).toContain("STOP &middot; ESCALATE");
});
```

- [ ] **Step 2: Replace the current `The same rigor, in three shapes.` heading**

Use this section shell:

```html
<section class="ps-block">
  <h2>Try it in three steps.</h2>
  <p class="ps-sub">The free path is intentionally small: one print page or one fault question,
  one cited answer, one honest verdict about what was proven and what was not.</p>
  <div class="ps-steps">
    <div class="ps-step"><span>1</span><h3>Send the print or fault question</h3><p>Use Telegram. A phone photo is enough for the trial path.</p></div>
    <div class="ps-step"><span>2</span><h3>Get a cited answer</h3><p>The answer names its manual source, print page, or unresolved gap.</p></div>
    <div class="ps-step"><span>3</span><h3>Use the answer as evidence, not sign-off</h3><p>PrintSense is read-only and does not replace engineering review.</p></div>
  </div>
</section>
```

- [ ] **Step 3: Keep the trust-state gallery, but make it support the trial**

Keep the existing `IMPORT HELD` and `STOP &middot; ESCALATE` cards. Add `UNRESOLVED` as a visible badge in the hero or gallery copy:

```html
<span class="ps-badge held">${I_PAUSE} UNRESOLVED</span>
```

Use surrounding text:

```html
If a contact, wire number, or source page cannot be proven, it is labeled unresolved rather than guessed.
```

- [ ] **Step 4: Add compact step CSS**

Add:

```css
.ps-steps{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
@media(max-width:860px){.ps-steps{grid-template-columns:1fr}}
.ps-step{background:var(--fl-dark-surface);border:1px solid var(--fl-dark-line);
  border-radius:8px;padding:18px}
.ps-step span{display:inline-grid;place-items:center;width:28px;height:28px;
  border:1px solid var(--fl-dark-accent-line);border-radius:6px;color:var(--fl-dark-accent);
  font-family:var(--fl-dark-mono);font-size:12px;font-weight:700;margin-bottom:12px}
.ps-step h3{font-size:15px;margin-bottom:6px}
.ps-step p{font-size:13.5px;color:var(--fl-dark-muted)}
```

- [ ] **Step 5: Run the focused test**

Run:

```bash
cd mira-web
bun test src/__tests__/printsense-landing.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

If on a normal branch:

```bash
git add mira-web/src/routes/printsense.ts mira-web/src/__tests__/printsense-landing.test.ts
git commit -m "feat(printsense): explain the one-print trial flow"
```

---

### Task 4: Demote the Package Pilot Without Removing It

**Files:**
- Modify: `mira-web/src/routes/printsense.ts`
- Test: `mira-web/src/__tests__/printsense-landing.test.ts`

**Interfaces:**
- Consumes: Existing `POST /printsense/interest` form and `wantsPilot` capture.
- Produces: Paid package capture remains available, but no longer competes with the free hook.

- [ ] **Step 1: Add a test for the paid path being secondary**

Add:

```ts
test("GET /printsense keeps the package pilot secondary", async () => {
  const res = await printsensePage.request("/printsense");
  const html = await res.text();

  const pilotIndex = html.indexOf("Have a complete package?");
  const telegramIndex = html.indexOf("Try one print in Telegram");
  expect(telegramIndex).toBeGreaterThanOrEqual(0);
  expect(pilotIndex).toBeGreaterThan(telegramIndex);
  expect(html).toContain("The free trial is for one page or one question.");
  expect(html).toContain("The package pilot is for teams that want a whole-machine evidence layer.");
});
```

- [ ] **Step 2: Replace the paid section copy**

Use:

```html
<section class="ps-block" id="pilot">
  <h2>Have a complete package?</h2>
  <p class="ps-sub">The free trial is for one page or one question. The package pilot is for teams
  that want a whole-machine evidence layer from a full print set.</p>
  <div class="ps-card"><p>Send the complete print package; we return searchable, cited
  troubleshooting knowledge for the machine. It stays reviewed, confidential, and read-only.</p>
  <form method="post" action="/printsense/interest" class="ps-form">
    <label>Work email <input type="email" name="email" required></label>
    <label><input type="checkbox" name="pilot" checked> I want to talk about a complete-package pilot</label>
    <button class="ps-cta" type="submit" data-cta="printsense-pilot-contact">Talk to Mike</button>
  </form></div>
</section>
```

- [ ] **Step 3: Keep POST behavior unchanged**

Do not alter this route logic except CTA copy in returned HTML if needed:

```ts
record("leads.jsonl", { at: Date.now(), email, wantsPilot });
record("funnel.jsonl", {
  at: Date.now(),
  event: wantsPilot ? "package_request_submitted" : "interest_submitted",
});
```

- [ ] **Step 4: Run the focused test**

Run:

```bash
cd mira-web
bun test src/__tests__/printsense-landing.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

If on a normal branch:

```bash
git add mira-web/src/routes/printsense.ts mira-web/src/__tests__/printsense-landing.test.ts
git commit -m "feat(printsense): demote package pilot on hook page"
```

---

### Task 5: Add Indexing Discovery for `/printsense`

**Files:**
- Modify: `mira-web/src/lib/sitemap.ts`
- Modify: `mira-web/src/lib/__tests__/sitemap.test.ts`

**Interfaces:**
- Consumes: `buildSitemapXml(baseUrl, today, blogPosts, faultCodes)`
- Produces: `/printsense` appears in generated sitemap.

- [ ] **Step 1: Add the failing sitemap assertion**

In `mira-web/src/lib/__tests__/sitemap.test.ts`, update the marketing page loop:

```ts
for (const path of ["/", "/cmms", "/printsense", "/pricing", "/blog", "/blog/fault-codes", "/assess", "/buy"]) {
  expect(xml).toContain(`<loc>${BASE}${path}</loc>`);
}
```

- [ ] **Step 2: Run the sitemap test to verify it fails**

Run:

```bash
cd mira-web
bun test src/lib/__tests__/sitemap.test.ts
```

Expected: FAIL because `/printsense` is not yet in `STATIC_PAGES`.

- [ ] **Step 3: Add `/printsense` to `STATIC_PAGES`**

In `mira-web/src/lib/sitemap.ts`, add it after `/cmms`:

```ts
{ loc: "/printsense", priority: "0.9", freq: "weekly" },
```

- [ ] **Step 4: Run sitemap test**

Run:

```bash
cd mira-web
bun test src/lib/__tests__/sitemap.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

If on a normal branch:

```bash
git add mira-web/src/lib/sitemap.ts mira-web/src/lib/__tests__/sitemap.test.ts
git commit -m "feat(printsense): add landing page to sitemap"
```

---

### Task 6: Visual QA and Browser Iteration

**Files:**
- Verify: `mira-web/src/routes/printsense.ts`
- Verify: `mira-web/src/__tests__/printsense-landing.test.ts`
- Verify: `mira-web/src/lib/__tests__/sitemap.test.ts`

**Interfaces:**
- Consumes: Running local server at `http://localhost:3217/printsense`
- Produces: Browser-verified first visual version ready for user iteration.

- [ ] **Step 1: Run all focused tests**

Run:

```bash
cd mira-web
bun test src/__tests__/printsense-landing.test.ts src/lib/__tests__/sitemap.test.ts
```

Expected: PASS.

- [ ] **Step 2: Start local preview**

Run:

```bash
cd mira-web
PORT=3217 PRINTSENSE_LEADS_DIR=/tmp/printsense-leads-preview bun run src/server.ts
```

Expected: Server prints `Started development server: http://localhost:3217`.

- [ ] **Step 3: Inspect desktop first viewport**

Open:

```text
http://localhost:3217/printsense
```

Expected visual result:

- H1 and primary Telegram CTA are visible without scrolling.
- Cited answer card is visible beside the hero on desktop.
- The paid package CTA is visible but visually secondary.
- No text overlaps the answer card, nav, or CTAs.
- The first viewport does not read as a pricing page.

- [ ] **Step 4: Inspect mobile first viewport**

Use a narrow browser viewport or device preview.

Expected visual result:

- H1, lede, and `Try one print in Telegram` are visible before the answer card.
- Button labels fit without clipping.
- The cited card starts immediately after the CTA area, not far below unrelated copy.
- No horizontal scrolling.

- [ ] **Step 5: Inspect form behavior**

Run:

```bash
cd mira-web
bun test src/__tests__/printsense-landing.test.ts
```

Expected: Lead capture tests still pass, proving CRM file contains email while `funnel.jsonl` remains content-free.

- [ ] **Step 6: Final focused status**

Report:

- Which tests passed.
- Desktop and mobile visual observations.
- Any copy/layout questions for the next iteration.
- Whether the package pilot CTA should stay on the page or move to footer-only.

---

## Self-Review

- Spec coverage: The plan covers free technician CTA, honest claims, route-only implementation, lead capture preservation, sitemap discovery, and browser QA.
- Placeholder scan: No task depends on unspecified copy, unspecified selectors, or future pricing.
- Type consistency: All referenced exports already exist: `printsensePage`, `buildSitemapXml`, `BLOG_POSTS`, and `FAULT_CODES`.
- Scope check: The plan avoids shared nav changes in the first pass. Adding PrintSense to the global topbar can be a later task after the user sees the page version.
