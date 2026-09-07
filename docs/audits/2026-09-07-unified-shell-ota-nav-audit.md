# CANARY-OTA-NAV-AUDIT — unified shell @ 412×915

**Branch:** `canary-ota-nav` (detached from `origin/main` f5f994a78)
**Date:** 2026-09-07 · **Status:** draft PR, held for human canary approval
**Scope honoured:** no native changes, no merge, no deploy.

---

## 1. OTA — reproduce, then fix

Three defects, each reproduced by a failing test before the fix.

### 1.1 "Check now" re-downloaded the bundle already running

**Reproduction (Mike's Pixel):** active bundle `1.1.7-9bfdc185`; the canary manifest
offers `1.1.7-9bfdc185`. Before the fix `checkAndStage` went straight to
`downloadBundle` — the device re-fetched a bundle byte-identical to the one it was
executing, then reported a confusing failure when the plugin rejected the duplicate.

**Fix:** ask the plugin for the active bundle first; if it equals `manifest.bundleId`,
return `{ staged: null, reason: "up_to_date" }` and never call `downloadBundle`.

**Test:** `live-update.test.ts` asserts both the return value *and*
`expect(plugin.downloadBundle).not.toHaveBeenCalled()` — the second assertion is the
one that fails if the guard regresses, because a re-download would still eventually
report "up to date".

### 1.2 A bundle already on disk was re-downloaded rather than reused

If the bundle exists locally but is not the active one, the fix stages it with
`setNextBundle` and returns `reused_local`. The plugin's bundle-enumeration API is
probed defensively (`typeof enumerate === "function"`), so a plugin build without it
falls through to the normal download path rather than throwing.

### 1.3 Every failure said "integrity"

Duplicate, network, checksum and signature failures all collapsed into one message,
so a flaky connection was indistinguishable from a tampered bundle.

`classifyDownloadFailure()` now maps the error to `checksum_mismatch`,
`signature_invalid`, `duplicate_bundle`, `download_failed`, or `verify_failed`, and
`AboutUpdates` renders a distinct line for each. Covered by an `it.each` over the
four classified pairs plus a fallback case.

---

## 2. Navigation

### 2.1 P1 — a pushed screen backgrounded the app

`App.tsx` ends its Back chain with `if (!consumed) void CapApp.minimizeApp()`. With
**About & Updates** open, nothing claimed Back, so the hardware Back button
**minimised MIRA from a non-root screen** — the exact failure the assignment names.

**Fix:** `UnifiedRoot` installs a Back handler while About is open that closes it and
returns to the root, restoring the previous handler on unmount.

**Mutation-verified:** with the fix reverted the new test fails; with it applied it
passes. A test that passes both ways would prove nothing.

### 2.2 Misleading labels

`← More` in `AboutUpdates` and `FilesScreen` named a destination that does not exist
in unified mode. Both now read `← Back`, matching where the control actually goes.

### 2.3 The closed drawer was still reachable by keyboard

Tabbing from the conversation eventually landed on `Close navigation` **inside the
closed drawer**. A closed modal layer is only moved off-screen by a transform, so it
keeps a bounding box, `visibility: visible`, no `inert` and no `aria-hidden` — its 10
controls stayed in the tab order and in the accessibility tree while invisible.

**Fix:** `Overlay` marks a layer `inert` while `modal && !active`. Only when modal —
the desktop sidebar is a permanent region and must stay reachable.

**Ordering matters:** placed after `useFocusReturn`, the effect broke two focus tests,
because opening the drawer moved focus into a subtree that was still inert for one
commit. Clearing `inert` must happen before the focus hook runs.

**Mutation-verified**, and independently confirmed: the tab sequence that used to end
`DRAWER:Close navigation` now ends `Open navigation`.

### 2.4 The drawer toggle is a hamburger, not a label

The top-left control read "Open navigation" as text — which Mike flagged directly as
the confusing part. It is now the conventional three-bar icon (`MenuIcon`, matching the
existing 16×16 icon set), 44×44, with the label moved to a visually-hidden span so the
accessible name is unchanged and every `getByRole("button", { name })` lookup still
resolves.

That change is also why `harness.tsx` needed fixing: its `accessibleName()` used raw
`textContent`, which would have folded a decorative glyph into the name. It now ignores
`aria-hidden` subtrees, matching the ARIA name computation and Playwright.

---

## 3. Visual pass — human aesthetics, token-first

The brief was to match what ChatGPT, Claude and Gemini get right while keeping the
simple styling and the rich features.

**I did not lift any competitor CSS.** Their stylesheets are proprietary and their
chat UIs are login-walled; more importantly `.claude/rules/ui-style.md` requires every
value to come from `docs/design/factorylm-tokens.css` with no hardcoded hexes. What is
shared across those products is a small set of *conventions*, and those are expressed
here as our own tokens:

| Convention | Our change |
|---|---|
| No dark chrome band — header is the page | `--fl-workspace-header` → `--fl-surface` + hairline |
| Comfortable reading type | `--fl-fs-body` 15px → 16px; new `--fl-lh: 1.6` |
| Low-chroma, slightly warm neutrals | `--fl-bg`, `--fl-ink`, `--fl-muted`, `--fl-line` warmed |
| Restrained accent, used only for action | `--fl-accent` `#4f46e5` → `#4b52c9` |
| One rounded composer pill, input above controls | `.fl-composer__row` two-line layout |
| Circular send anchored right | `radius-pill` + `margin-inline-start: auto` |

**The composer was the real defect, not a matter of taste.** Five flex children shared
one line; at 412px the textarea measured **62px**, so the placeholder wrapped across
three lines. It now measures **386px**. `order: -1` moves it visually without moving it
in the DOM, so tab order and accessible names are unchanged.

**The header title** was pushed flush against the right edge by `justify-content:
space-between` whenever the inspector control was absent. The title block now takes the
free space; only the inspector anchors right.

Contrast retained: `--fl-muted` on surface ≈ 5.3:1 and white on `--fl-accent` ≈ 6.3:1,
both above the 4.5:1 AA threshold. `--fl-faint` stays decorative, as before.

**Before/after:** `docs/promo-screenshots/2026-09-07_unified-shell-aesthetics-{before,after}-*_412x915.png`
(4 scenarios × 2 themes × 2 phases).

---

## 4. A finding that dissolved under checking

The first walk reported **42 failures**, headed by `Machine` (13), `Add attachment` (13)
and `Work` (12) as "dead controls". They are not dead.

Probing them directly, every click **timed out on Playwright's actionability check**.
`elementFromPoint` at each control's centre returned `DIV.fl-scrim` and `UL.fl-tree`:
the navigation drawer was **open, covering the conversation**, and its scrim was
swallowing every tap underneath. That is a materially different claim from "the button
does nothing" — and my first report was wrong.

The cause is not a product defect either. The shared reducer initialises
`navigationVisible: true`, which is correct for the desktop permanent sidebar.
`mira-mobile` corrects it for the phone — `UnifiedChat.tsx:73` dispatches
`set-navigation-visible: false` on init — **but the lab harness does not**. So a raw
mobile load in the lab lands inside the drawer, and my walk was auditing a screen the
product never presents.

Worse, my own screenshot harness contained `page.keyboard.press("Escape")`, which
silently dismissed that drawer. The before/after pair looked right while the walk
looked broken, and the two disagreed for a reason neither one reported.

**Corrected:** both harnesses now land the way the mobile app does, via a documented
`landAsMobileApp()` helper, and re-ran. Section 5 reports the corrected numbers.

**Residual (worth a follow-up, not fixed here):** the shared default is desktop-shaped,
so every new mobile consumer must remember the same correction or inherit an open
drawer. A surface-aware default in `createInitialState` would remove the trap. Filed as
a note rather than changed, because it alters shared behaviour beyond this assignment's
scope and belongs with the shell owner.

---

## 5. BUTTON → EXPECTED → ACTUAL → PASS/FAIL

Method: at 412×915, for each scenario, enumerate every visible control, re-navigate to
a clean state before each one, click it, and compare a full-DOM fingerprint (HTML
length, open dialogs, drawer state, active/pressed counts, visible text) before and
after. A control that changes nothing is reported dead. Controls that are `disabled` or
already `aria-pressed`/`aria-current` are classified *no-op by design* rather than dead —
without that distinction the first version of this detector called all 109 controls dead.

Full table: `.audit/button-walk.md` (generated, one row per control).
Harness: `apps/factorylm-ui-lab/e2e/zz-button-walk.spec.ts`.

### Result: 190/190 PASS, zero dead controls

Coverage is every visible control across 13 scenarios in both reachable states —
the landing conversation and the opened navigation drawer — plus the Android Back
action at each layer.

| How it passed | Count |
|---|---|
| navigation closed (drawer item or Close) | 83 |
| no-op by design (disabled / already selected / already current) | 52 |
| view changed | 29 |
| opened a layer (sheet, source viewer, inspector) | 13 |
| navigation opened | 13 |

The 52 *no-op by design* rows are the ones that matter for honesty: they are
controls that correctly did nothing because they were disabled or already in
their target state. The first version of this detector had no such category and
reported all 109 controls it then saw as dead — a 0% pass rate that was entirely
an artefact of comparing a 90-character text prefix.

**Android Back / layer unwinding:** every pushed layer unwinds exactly one step.
No non-root screen backgrounds the app — §2.1 was the one case that did, and it
is fixed and mutation-verified.

### Controls changed as a result of the walk

| Control | Was | Now |
|---|---|---|
| Drawer toggle (top-left) | text button reading "Open navigation" | three-bar hamburger `MenuIcon`, 44px, label kept for assistive tech |
| `← More` (About & Updates) | named a screen that does not exist in unified mode | `← Back` |
| `← More` (Files) | same | `← Back` |
| Closed drawer's 10 controls | reachable by Tab while invisible | `inert` while closed |


---

## 6. Gates

| Gate | Result |
|---|---|
| `mira-mobile` tsc | 0 errors |
| `mira-mobile` vitest | 467/467 |
| lab unit (`bun test ../../packages src`) | 109/109 |
| lab e2e (`playwright test`) | 95/95 |
| OTA guard | "none native" |

**One green run in this session was not real.** An earlier 95/95 was served from a
stale `dist/` bundle: the browser reported accent `#4f46e5`, header `#111827`, no
`--fl-workspace-lh` and `flex-wrap: nowrap` — none of the changes were loaded. I had
invoked `playwright test` directly instead of `bun run test:e2e`, which bootstraps the
shared UI first. The numbers above are from a rebuilt bundle, confirmed live in the
browser before being trusted.

---

## 7. Not done / carried

- The shared reducer's desktop-shaped `navigationVisible` default (§4 residual).
- The drawer's own "Close navigation" is still a full-width text button. An X in
  the drawer's top corner would mirror the hamburger, but the brief named the
  top-left control specifically and I did not widen it unasked.
- Desktop (1440×900) companions for the aesthetic pair: this assignment is
  phone-scoped, and the fixture matrix already regenerates web/hub shots.
