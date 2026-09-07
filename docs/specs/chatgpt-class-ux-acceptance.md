# ChatGPT-Class UX Acceptance — the gate

**Status:** DRAFT for Mike's decision. Nothing built yet.
**Owner:** unassigned (see § Owner — this is the first thing that must be decided).
**Origin:** Mike, 2026-09-07. Design pass: 14-agent orchestration + coordination with the
`fix/canary-ota-nav-audit` session (#3661), which had already hand-built the closest precursor.

## The requirement, in Mike's words

> A technically working screen is not sufficient.

> Instead of you discovering on your phone that there aren't good back buttons, the agent
> should have failed the build before handing it to you.

The gate tests the app **from the glass outward**, the way a technician experiences it —
not whether an API returned 200.

## Definition of done for any meaningful UI change

FactoryLM must pass the same golden technician journey on mobile and web, pass functional
navigation, pass approved visual presentation, and pass an uninstructed stranger walk.

---

## 1. What already exists (reuse before build)

| Asset | Path | Use |
|---|---|---|
| Button-by-button walk, 190/190, with a `no-op by design` class | `apps/factorylm-ui-lab/e2e/zz-button-walk.spec.ts` (on #3661) | **The functional detector.** Do not rewrite. |
| Landing-state correction | `landAsMobileApp()`, same file, line 43 | Generalise into a precondition (§4.1) |
| Back-invariant, with its own positive control | `mira-mobile/src/screens/__tests__/back-handler-invariant.test.ts` (on #3661 **only**) | P0 #1 and #2 |
| Build-stamp pattern that works | `mira-mobile/vite.config.ts:50` + `src/lib/live-update.ts:48-59` | Copy verbatim for the lab (§3) |
| Its guard | `mira-mobile/src/lib/__tests__/native-fingerprint-wiring.test.ts` | Copy the shape |
| Device driving | `tools/mobile-e2e/{journey,device}.py`, `cdp.mjs` | Device layer |
| Phone etiquette + artifact certification | `.claude/skills/mobile-device-acceptance/SKILL.md` | Unchanged, binding |
| Merge-blocking home for the lab | required check `Shared UI contract (bun 1.4.0)` | Where the objective half hangs |

## 2. Decisions taken, with the evidence

### 2.1 Maestro is rejected — on evidence, not on reuse

The reuse argument ("`journey.py` already drives the phone") is **weak**: it never asks
whether either tool can *see* the controls. The real reason is measured.

`uiautomator dump` on the Pixel 9a returns **zero-size bounds** for most of our surface —
`Close navigation`, `New chat`, every notebook title, `Machine`, `Voice`, `Send` all come
back `[0,0]-[0,0]`. Only `Open navigation`, `Add attachment`, `Ask`, `Work` had real
geometry. This is a WebView: the accessibility tree is flattened and most elements never
surface with usable bounds.

**Maestro drives that same accessibility tree, so it inherits the blindness.** A gate that
cannot locate two thirds of the controls would report the controls it *can* see as the
population — a complete-looking list of what the scan can see, presented as a list of what
exists. That is the exact failure this gate exists to catch, built into its foundation.

### 2.2 The device layer splits in three, because CDP cannot attach to a release build

`.claude/skills/mobile-device-acceptance/SKILL.md`: *"Release build (no CDP) — uiautomator
only."* Independently, `dumpsys` on the installed app shows
`flags=[ HAS_CODE ALLOW_CLEAR_USER_DATA ALLOW_BACKUP KILL_AFTER_RESTORE ]` — **no
DEBUGGABLE**. Two paths, same wall.

So the build we most want to certify is the one build where no tool can locate the controls.
The resolution is to stop treating it as one layer:

| Layer | Needs element geometry? | Runs against |
|---|---|---|
| Control-level functional walk | **yes** (DOM) | lab, and debug build via CDP |
| Presentation scoring | **no** — scores pixels | any build, incl. release |
| P0 back/force-close/state | **no** — BACK presses + focus | release build + the back-invariant unit test |

**Open measurement, blocking the shared-detector plan:** can `cdp.mjs` attach to *this*
build at all? Nobody has run it. If it cannot, sharing one detector across web and device
requires a debug variant of the shell — a native change with its own gate. Until that
number exists this is a hypothesis, not architecture.

### 2.3 The fixture is a wish, not a sample

The peer observed on the real device that a citation renders as
`nameplate-12ac8c22-018a-4104-a247-d81c37bdb292.txt` — the core product promise displayed
as a database key — and that the notebook name appears four times in the top third.

**Neither is reproducible in the lab.** `apps/factorylm-ui-lab/src/fake-adapter.ts` contains
**zero** UUID-shaped strings; `SourceViewer.tsx:24-25` renders human-authored fixture values.
A green lab run certifies the citation layer as fine while the product shows a raw key.

> **A fixture-driven gate can only catch defects its fixtures contain, and the fixtures are
> authored by the same people who would fix the defect.**

This is the positive-control rule applied to fixtures rather than tests. Consequence:
**every confirmed teardown finding becomes a fixture**, with the exact string, its repetition
count, and the viewport. A finding that becomes a fixture is a defect that cannot come back;
a finding that becomes a ticket is one that can.

### 2.4 Provenance is the first thing built, before any journey

`docs/promo-screenshots/` holds **938** captures. Exactly one feature has a manifest. Nothing
binds any capture to the commit that produced it.

This is not hypothetical: a green 95/95 lab e2e on #3661 was served from a stale `dist/` and
had tested a bundle containing none of the changes under review. It was caught only by
comparing content-hashed CSS chunk names by hand.

**A presentation gate whose screenshots came from an unidentifiable build is worse than no
gate**, because it produces a confident number about an unknown artifact.

Mechanism: stamp the commit SHA at build time, expose it as `data-build-sha` on `<html>`,
and have the capture step **fail closed** unless it equals `git rev-parse HEAD`. Copy
`mira-mobile`'s working form — Vite's `define` substitutes a **bare identifier** and silently
does not rewrite `globalThis.__X__`, which is why that app shipped `unset` for months.

---

## 3. Increment 0 — build this first (one week, provable)

Nothing else is worth building until captures are trustworthy.

1. Stamp `data-build-sha` into the lab bundle via Vite `define` (bare identifier).
2. A wiring guard in the shape of `native-fingerprint-wiring.test.ts`.
3. Capture step asserts `data-build-sha === git rev-parse HEAD`, fail-closed.
4. **Positive control:** capture against a deliberately stale `dist/` and prove it FAILS.

**What Increment 0 proves:** every subsequent number is about a known build.
**What it does not prove:** anything about the UI.

## 4. The three layers

### 4.1 Functional Journey — blocks merge

The canonical technician walk, one journey, run on web (lab) and device:

cold launch → home → general maintenance question → response streams → attach photo → ask
about it → open Equipment Project → open machine → equipment-specific question → inspect
evidence/citation → navigate backward → conversation history → reopen same conversation →
Settings → return → close app → relaunch → land somewhere sensible with state preserved.

Rules, each derived from a real failure:

- **Landing-state equality is a precondition.** Assert the harness's landing state equals the
  product's before walking anything, and fail closed when it differs. The shared reducer
  defaults `navigationVisible: true`; `mira-mobile` corrects it at `UnifiedChat.tsx:73`, the
  lab does not — so a raw lab load renders the drawer open with its scrim swallowing every
  tap underneath. That produced 42 phantom "dead controls". A gate that walks a screen the
  product never presents is measuring a different app. (#3662)
- **Fingerprint broadly, classify narrowly.** Detect change via a whole-DOM fingerprint (html
  length, dialog count, drawer state, active/pressed counts, visible text) — a 90-character
  text prefix is too coarse and a control can act without moving it. Classify inert-by-design
  from `disabled` / `aria-pressed` / `aria-current` read **before** the click.
- **No assertion inside a `catch`.** Catch-and-continue converts a broken back button into a
  logged milestone.
- **The step ledger is the reporter, not `console.log`.** A test can log 25 milestones while
  asserting nothing.

### 4.2 Presentation Review — advisory, with a mechanical floor

Twelve capture points: Launch, Empty chat, Keyboard/composer, Streaming answer, Completed
answer, Photo attached, Sidebar/history, Equipment Project, Machine page, Citation/evidence,
Settings, Error state.

**The mechanical floor runs first and blocks; the judged score is advisory and never turns a
red mechanical check green.** Two objective checks, both needing no taste:

- **Identifier repetition** — count distinct renderings of the same string per viewport.
- **Citation legibility** — assert no user-facing citation label matches a UUID pattern.

Judged dimensions (Hierarchy, Spacing, Typography, Navigation, Controls, Density,
Consistency, States, Motion, Platform behaviour, Accessibility) are scored against
**FactoryLM's own approved system**, not generic taste.

> ⚠️ **Known gap.** The survey of `docs/design/factorylm-tokens.css`, `factorylm-style.md`,
> and `.claude/rules/ui-style.md` — the one that establishes what the scorecard grades
> *against* — **failed to return** during the design run. Every downstream statement about
> token conformance in this document is therefore **unsurveyed**. That survey must be run
> before the scorecard is built. Do not treat this section as grounded.

Baseline provenance: sits **downstream** of Mike's ChatGPT recon (captured to
`.audit/reference/`, gitignored — third-party pixels are never committed; we read the
patterns out and write them into our own docs). Two baselines is the same mistake as two
golden journeys.

ChatGPT is the **interaction benchmark, not a pixel master**: someone comfortable with
ChatGPT should pick up FactoryLM with almost no instruction. The charter already states this
and does not enforce it — *"Responsive layout may collapse panels into drawers or sheets…
Neither is allowed to create a different mental model."* That sentence is what the
Cross-device consistency dimension should make mechanical.

### 4.3 Stranger Walk — human-gated, and it needs an owner

Uninstructed. The only sentence spoken: *"You are standing in front of a machine that isn't
working. Use this app to get help."* Record SUCCESS / HESITATION (>3s) / WRONG TURN / TRAP /
EXPLANATION REQUIRED. An EXPLANATION REQUIRED on a core workflow is a failure.

**This layer has no owner and will therefore never run.** Naming one is a precondition for
shipping the gate, not a follow-up.

## 5. Score and P0s

| Area | Weight |
|---|---:|
| Core task completion | 25 |
| Navigation / orientation | 20 |
| Visual hierarchy / polish | 15 |
| Chat / composer behaviour | 15 |
| State persistence | 10 |
| Loading / error / empty states | 5 |
| Accessibility / touch targets | 5 |
| Cross-device consistency | 5 |

90–100 release-quality · 80–89 usable, polish required · 70–79 not release-quality · <70 redesign.

The verdict shape is **`FUNCTION PASS / PRESENTATION FAIL`** — never a single number, so a
beautiful broken app and a functional ugly app each fail visibly and separately.

**Four automatic P0 failures regardless of score.** Each needs a detector *and* the
deliberate break that proves the detector fires:

| P0 | Detector | Positive control |
|---|---|---|
| Can't navigate back | back-invariant + journey back step | hide the back control; assert the journey fails **at that step** |
| Requires force-close | ANR/crash watch | inject a crash; assert non-zero exit |
| State lost unexpectedly | relaunch + history assertions | clear storage; assert the persistence step fails |
| Primary action unclear/inaccessible | Send visible, reachable, responsive | hide Send; assert failure at the send step |

A control that fails **at the wrong step** is a failed control, not a pass — otherwise an
unrelated network error is read as the detector working.

## 6. CI wiring — the part that is usually got wrong

**Being in `needs` makes a job wait. Only `require_success` makes it gate.** This repo has
already been bitten: `capability-closure` was added to `needs` by #3329 but its result was
never read, and because `ci-gate` is `if: always()`, it ran on every PR and could not fail
one. The comment recording that sits at `.github/workflows/ci.yml:1453-1460`.

So the gate must be added to **both**, and a validator must assert it:

- `ci-gate.needs` (currently 15 jobs, `.github/workflows/ci.yml:1418`)
- a `require_success ux-acceptance "$UX_RESULT"` call

Additional fail-closed rules:

- **A missing artifact is a merge blocker, not a grace condition.** `jq … || echo UNKNOWN`
  followed by treating UNKNOWN as PASS converts a crashed job into a green gate.
- **No `| tee` on the gate command** unless `set -o pipefail` is in force.
- **A run that skips is not a run that passed** — grep the log for the step names.

## 7. What this gate does NOT prove

Stated explicitly so a green result is not over-read:

- Nothing about the release-signed artifact beyond pixels and P0s (§2.2).
- Nothing about a defect absent from the fixture corpus (§2.3).
- Nothing about token conformance until the failed survey is re-run (§4.2).
- Nothing about real technician comprehension until the Stranger Walk has an owner (§4.3).
- Emulator behaviour is not device behaviour; camera on the emulator is SKIP, never PASS.

## 8. Sequencing

Everything below is behind the existing freeze: #3647 → Slice C → Slice D → #3661. No file
in `packages/factorylm-*`, `apps/factorylm-ui-lab`, or `mira-mobile/src` is touched by this
spec. The back-invariant test lives on #3661 only and is unavailable to a gate built on main
today — it lands with that PR or is cherry-picked, which is a sequencing decision for whoever
owns the freeze.

**Mike's decisions required before any build:**
1. Owner for the gate, and owner for the Stranger Walk.
2. Increment 0 (provenance) first — confirm, or overrule.
3. Whether the gate blocks on web only at first, with mobile advisory until it proves
   non-flaky (proposed criterion: 10 consecutive greens, zero reruns).
