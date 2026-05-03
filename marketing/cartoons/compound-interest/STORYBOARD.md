# Storyboard — "Fault Lookup, Without MIRA / With MIRA"

## What this cartoon sells

**One feature, dramatized:** MIRA reads cryptic drive fault codes and walks
the technician through the fix. Without MIRA, the tech has the manual and
a wall of useless "CONSULT FACTORY" entries. With MIRA, they get specific
steps in seconds.

This cartoon goes on the dark-theme landing page (`feat/landing-dark-theme`)
as a single hero image — Marvel-comics split-panel convention with a thick
diagonal divider and thought balloons doing the narrative work.

## Panels

| # | File | Role |
|---|------|------|
| 3 | `panel-3.png` | **HERO — combo split-panel WITHOUT/WITH MIRA, diagonal divider, thought balloons** (landing-page deliverable) |
| 1 | `panel-1.png` | Standalone WITH-MIRA scene (alternate / source material) |
| 2 | `panel-2.png` | Standalone WITHOUT-MIRA scene (alternate / source material) |

Panel 3 is what drops into the page. Panels 1 and 2 are kept in the repo as
fallback (in case we ever want the same story told as two adjacent panels
instead of one combo image) and as iteration evidence.

## Panel 1 — AFTER: "With MIRA, walked through it" (right slot)

**Already on disk.** Painterly comic, Rico facing the VFD, phone in hand,
MIRA chat visible on phone screen with the cryptic code "F-012 fault on
PowerFlex 525" + a clearer second line ("Searching..." or steps). Cool
steel-blue dairy hall, three silos, "CEDAR CREEK DAIRY" placard
letter-perfect, HUD bottom-right reads "NETWORK: 1 PLANT · 0 PRIOR
INCIDENTS." Warm amber phone glow is the heroic light source — that's the
visual signal that *help has arrived*.

Known minor compositional gaps in the current take:
- Rico in deep profile, no name patch visible
- Reading glasses missing
- Multi-tool on belt reads more like a flashlight holster

Acceptable for now. If panel 2 nails the character details (3/4 view, RICO
patch visible, glasses, multi-tool), we may re-roll panel 1 to match — but
that's a separate decision after panel 2 lands.

## Panel 2 — BEFORE: "The Manual" (left slot)

**To generate next.** Same Rico, same VFD, same dairy hall — but the
prop is a paper user manual instead of a phone, and the lighting/mood
is intentionally colder.

Key visual elements:
- Rico in **3/4 view**, slightly turned toward camera so chest patch and
  expression are both visible (fixes the panel-1 framing gap)
- **"RICO"** name patch clearly embroidered on coveralls — gpt-image-2
  should now nail this where gpt-image-1 wrote "DALE"
- Reading glasses on, multi-tool clipped to belt
- Holding a thick spiral-bound user manual open in both hands; title on
  the spread reads **"POWERFLEX 525 · FAULT CODE REFERENCE"**
- Manual page shows a long three-column table: CODE / NAME / ACTION.
  Codes visible: F-008 through F-013-ish. The ACTION column repeats
  "CONSULT FACTORY" almost line after line — a wall of useless. His
  finger traces the F-012 row.
- Phone is NOT in frame
- VFD red FAULT LED still flashing in his peripheral vision
- **No warm amber light anywhere** — that absence is the storytelling
  point: without MIRA, there's no helper glow
- HUD bottom-right: **"WITHOUT MIRA · MANUAL ONLY · ETA UNKNOWN"**
- Mood: lonely, paper-bound, slow. Same dairy hall but emotionally
  colder than panel 1.

## Panel 3 — HERO combo split-panel (the landing-page deliverable)

**On disk.** Single 1792x1024 image. Thick black diagonal divider runs
from upper-left to lower-right, with a thin warm-red accent stroke
echoing the FAULT LED. Same Rico in 3/4 view on both sides, each turned
slightly toward the divider so they face each other across it.

- **Left half — "WITHOUT MIRA":** paper manual open to the PowerFlex 525
  fault-code reference, "CONSULT FACTORY" column repeating down the page,
  cold steel-blue light only. Thought balloon: chaotic guesses —
  *"F-012 AGAIN / INTAKE? P035? MOTOR? / HOW LONG TILL THE LINE'S COLD?"*
- **Right half — "WITH MIRA":** phone in hand, MIRA chat reply visible,
  warm amber phone-screen glow lighting his face. Thought balloon:
  definite next-steps — *"F-012 = INTAKE OVERLOAD / CLEAR THE GUARD /
  FOUR MINUTES"*

The contrast is the point: questions vs. statements, uncertainty vs.
timed action, cold light vs. warm helper-light. All readable at a glance,
which is what a landing-page hero has to do.

## Out of scope (future cartoons, not this one)

If we ever want a richer arc showing MIRA's network compounding across
plants, that's a *separate* cartoon — call it "The Tenth Call / The
Hundredth Call":

- **Tenth call** panel: different tech, different plant (e.g. beverage
  bottling line), same kind of drive fault. MIRA replies instantly:
  "Same fault as Cedar Creek 2026-Q4 — likely intake clog. Check P035."
  HUD: "NETWORK: 6 PLANTS · 9 PRIOR INCIDENTS · ETA: 90 SEC."
- **Hundredth call** panel: tech barely engaging, MIRA already pushed
  the suggestion to the shop-floor display. HUD: "NETWORK: 47 PLANTS ·
  99 PRIOR INCIDENTS · ETA: 12 SEC."

That's a different feature (network learning) and a different page slot.
Captured here so we don't forget the idea, but **not part of this cartoon**.

## Workflow rule (don't lose pictures)

Each panel commits to git **immediately after generation**. The
generator script overwrites `panel-N.png` on every run, so the only
rollback is git. Workflow:

1. Edit `generate_panel.py` to add/update the prompt for panel N
2. Run: `doppler run --project factorylm --config prd -- python marketing/cartoons/generate_panel.py N`
3. Inspect the result
4. If keeping: `git add marketing/cartoons/compound-interest/panel-N.png && git commit -m "feat(marketing): generate panel N — <summary>"`
5. If rerolling: commit the rejected version first as
   `panel-N-rejected-<reason>.png` (mv the file), THEN edit the prompt
   and rerun. Never overwrite without first committing.
