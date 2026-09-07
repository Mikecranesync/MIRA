# Mobile companion to the UX recon — the untested area, walked

**Companion to:** `wiki/reviews/2026-09-07-app.factorylm.com-ux-recon-off-base.md` (PR #3666)
**Tracker:** #3667 · **Gate spec:** #3665
**Surface:** MIRA Android app, Pixel 9a, 1080×2424 physical (CSS viewport 412), production build
`1.1.0` / versionCode 10, sideloaded (`installerPackageName=null`), captured 2026-09-07.
**Evidence:** `.audit/device/*.png`, committed. **Author:** CHARLIE devops/gate session.

---

## Why this file exists

The recon names its own limits, and three of them are things I can close rather than argue with:

> **"Mobile was excluded by scope — all mobile guidance (grammar §8, tests section H) is inference
> from responsive structure and is labelled unvalidated. For a phone-first product this is the
> biggest untested area and should be the next recon."**

This is that recon.

> **"Citation and streaming behaviour in FactoryLM was never observed — generation never succeeded
> during the walk. E-1/E-2 (the citation gates — our whole claim) are untested, not passed."**

On mobile, generation **has** succeeded and citations **do** render. E-1/E-2 move from *untested*
to **tested and failing, with a photograph**. That is the single most load-bearing thing here,
because E-1 is the north-star claim.

> **"Screenshots were captured live but returned no retrievable paths."**

Mine are committed PNGs with reproducible journeys. Both, not either.

**This does not revise the recon.** Its finding — an operations console containing an AI feature,
rather than an AI surface containing operations — reproduces on mobile without amendment. Same
disease, second surface, independent evidence.

---

## The gates the recon could not test, tested

| Gate | Recon status | Mobile status | Evidence |
|---|---|---|---|
| **E-1** inline citation chips naming manual + page | untested | **FAIL** | `01`, `03`, `05` |
| **E-2** unsourced claims explicitly labelled | untested | **FAIL** (no groundedness signal at all) | `03`, `05` |
| **D-5** permanent scope badge naming the machine | — | **FAIL, inverted** | `03`, `05` |
| **D-6** duplicate asset names disambiguated | web only | **FAIL** on mobile too | `02` |
| **B-2** speaker encoded by alignment/bubble | web only | **FAIL** | `01`, `03` |
| **Z-1** stranger reaches an answer in five minutes | fails at step one (web) | **fails at step one** (different cause) | `05` |
| **A-1 / B-1** composer is the home screen | fails | **fails — there is no home** | `05` |

### E-1 — the citation is a database key

The product's entire claim renders as:

```
FILE   nameplate-12ac8c22-018a-4104-a247-d81c37bdb292.txt      p. 1
```

Under the answer *"Serial number 49849 is listed on the nameplate [1]."* The `[1]` marker, the
`FILE` kind label and the page number are all correct — the **name** is a UUID. A technician
cannot tell which manual that is, cannot say it aloud to a colleague, and cannot check it.

The recon's target (`📖 SKF 6205 · p.14`) is exactly right. The gap is not the chip mechanism —
we have a chip, with a locator. It is that nothing resolves the artifact id to a human title.

**Detector, no taste required:** no user-facing citation label may match
`[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`.

### E-2 / D-5 — we spend the badge on what we do *not* know

D-5 asks for a permanent tappable badge naming the machine. Mobile has a permanent badge that
says **"No machine"**, and every turn header repeats **"No machine context"** — four times on one
screen in `03`, beside both `You` and `MIRA`.

So the scope affordance exists and is inverted: real estate reserved for orientation is spent
telling the technician what MIRA lacks. And there is no groundedness signal anywhere — a manual-cited
answer and a general-knowledge answer are typographically identical, which for a product whose
claim is *grounded, cited answers* is the trust failure, not a styling one.

### B-2 — speaker is not encoded

Web breaks this by mis-aligning bubbles. **Mobile has no bubbles at all.** Both roles are
full-width plain text; the only difference is a small bold `You` / `MIRA` label. In plant light,
finding the answer means re-reading the thread.

### Z-1 / A-1 — mobile has no home to fail on

Web fails Z-1 because Command Board opens on KPI tiles. Mobile fails it differently and more
completely: **cold launch drops straight into the last thread**, and the only `New chat` control
lives in the drawer and is **disabled** (`02`). There is no landing surface to redesign — one has
to be created.

---

## Two mobile-only findings not in the web audit

**1. The same identifier renders four times in the top third.** In `01`, "Sensor v0 overnight
2026-08-28" appears as the header title (wrapping to three lines), the breadcrumb, a green
`confirmed` pill, and the composer's `Using:` line — plus a fifth time in the turn header.

This is the mobile form of the recon's system-as-workspace pattern. Four components each decided
the context mattered; none composes with the others. It belongs beside S3-03/S3-04 as *identifier
repetition*.

**Detector:** count distinct renderings of the same string per viewport; more than one is a finding.

**2. `Open navigation` is a 588×118px bordered text box.** It reads as an empty input, consumes a
third of the width, and forces the title to wrap to three lines beside it. Against Material 3's
56dp top app bar with a 24dp leading icon, this is roughly double the height doing less.
*(Already fixed on `fix/canary-ota-nav-audit` — see below.)*

---

## What is already fixed on branch `fix/canary-ota-nav-audit`

Reported so nobody re-fixes it. The device runs `1.1.0`, which predates all of this; **the OTA
path cannot deliver it** (`docs/audits/2026-09-07-unified-shell-ota-nav-audit.md`), so the phone
will keep showing the old surface until a new build is installed.

| Device symptom | Status on branch |
|---|---|
| `Open navigation` text slab | Replaced by a 44×44 three-bar hamburger, label visually hidden |
| Near-black header chrome | Header is the page surface with a hairline |
| Title shoved to the right edge | Title sits beside the control; only the inspector anchors right |
| Composer crowded, text field 62px wide | Two-line pill; field measures 386px at 412 CSS px |
| Back from About & Updates backgrounded the app | Fixed and mutation-verified |
| Closed drawer reachable by Tab | Closed modal layers are `inert` |

**Not fixed, and not attempted:** the citation UUID, identifier repetition, `No machine context`
stamping, absent groundedness signal, absent home/composer surface, disabled `New chat`, drawer
search, message-role encoding. Those are #3667's list, not this branch's.

---

## Honest limits of *this* companion

- **Production build only.** Everything above is `1.1.0`. The branch fixes are verified in the
  Playwright lab at 412×915 and **not on the handset**, because OTA cannot deliver them and I did
  not sideload — replacing a sideloaded install with a differently-signed build forces an
  uninstall, wiping app data and signing the owner out. That is an owner decision.
- **One account, one device, existing data.** No stranger walk, no fresh install, no empty state
  observed. The recon's Z-1 stranger test has *not* been run on mobile; I inferred the launch
  behaviour from an existing session.
- **No competitor mobile app was observed.** Comparisons are against published Material 3 / Apple
  HIG and the recon's own 5-product study. One accidental same-device capture of the Claude
  Android app exists (`REFERENCE-claude-app-same-device.png`) — genuinely useful for app-bar and
  composer proportions, and it is one product, not a convention.
- **Zero-bounds ceiling.** `uiautomator dump` returns `[0,0]-[0,0]` for most controls in this
  WebView — `New chat`, `Send`, `Machine`, every notebook title. Any accessibility-tree driver
  (uiautomator, Maestro, Espresso) inherits that, so an automated mobile control-walk needs CDP
  against the WebView, which requires a debuggable build. Relevant to #3665's device layer.
- **Photographs, not measurements.** Except where a CSS value is quoted from the lab, the mobile
  numbers are read off screenshots at known scale, not computed from a live DOM.

---

## What I am offering, and what I am not touching

Offering: the committed device evidence, the two mechanical detectors above (citation-UUID regex,
identifier-repetition count) as taste-free floors under #3665's judged score, and this companion
in whatever form is most useful — folded into the recon, or kept separate so its provenance stays
clean. Bravo's call.

Not touching: `wiki/reviews/`, PR #3666, issue #3667. They are Bravo's, and my branch is frozen
behind #3647 → Slice C → Slice D.
