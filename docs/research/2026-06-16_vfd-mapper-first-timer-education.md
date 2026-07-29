# VFD Analyzer wizard — designing for a true first-timer

**Question (Mike):** "Imagine I'd never used something like the mapper. What would I need presented to
make good *choices*? Bake it into the wizard — it should educate **without trying to**."

**Date:** 2026-06-16 · branch `feat/vfd-analyzer-auto-map`.

## The reframe

The earlier novice audit (`2026-06-16_vfd-analyzer-mapper-novice-walk.md`) asked "can a beginner *click
through*?" This asks something harder: "can a beginner *choose well*?" Clicking through with wrong
picks produces a confidently-wrong map. The wizard currently tells you **how to click** but not **how to
decide**.

## The principle: educate without a tutorial

A tutorial (splash screen, coachmarks, a "Help" panel) is "trying to" educate — it interrupts. **Ambient
education** is a byproduct of the decision UI itself. Three mechanisms:

1. **Plain-language micro-copy at the decision** — the explanation lives *in* the control you're using,
   visible only while it's relevant.
2. **Show the reasoning** — when the system suggests something, it says *why*. The user learns the rule
   by seeing it applied.
3. **The live value as teacher** — pair every reading with an expected range, so "what good looks like"
   is learned by comparison, not memorized.

Smart defaults are the fourth: making the right first choice *for* the user, visibly, teaches by example.

## The 4 decisions a first-timer faces

| Step | Decision | Today | What they need | Status |
|---|---|---|---|---|
| Connect | "Which folder is my drive?" | Raw folder tree + jargon | **Recognition help** — flag the folder that *looks like* a VFD ("10 drive-ish tags — start here") | ⏳ next |
| Verify | "Is this the right, healthy source?" | Live values, must click Test | **A verdict** — "✓ This looks like a live VFD (freq, current, fault all present + good)" not just numbers | ⏳ next |
| **Map** | **"Which cryptic tag is 'Output frequency' — and what IS that?"** | Role name + tag list | **What each signal is, what a good reading looks like, why a tag was suggested** | ✅ done (role `about`+`typical`); ⏳ suggestion-why |
| Save | "What did I do? Safe? Done?" | Approve toggle + note | Mostly there (train-before-deploy note) | ✅ adequate |

## Implemented (commit `c25c9f82`)

**Role education on the Map step.** The `signal_roles` catalog now carries, for the 7 required+recommended
roles, a plain-language `about` ("How fast the motor is actually spinning right now. When running it
should be near the setpoint; 0 means stopped.") and a `typical` reading ("0-60 Hz"). The Map right pane
renders it under "for: Output frequency" via `mira_setup.role_about()`. So when a first-timer taps a slot,
they see *what the signal is* and *what a good value looks like* — exactly where they choose, gone when
they move on. No tutorial.

This also seeds the next pieces: the same `about`/`typical` data drives the suggestion-why copy and the
range check below.

## Roadmap (cheapest-highest-leverage next)

1. **Suggestion "why"** — `suggest_for_role` returns the matched keyword; the Map "Chosen" line reads
   "Suggested because its name contains 'frequency' and it reads 0.0 Hz (plausible). The setpoint
   `vfd_freq_sp` reads 30.0 Hz — that's the *target*, not the actual." Teaches the freq-vs-setpoint trap
   at the moment it bites, and builds trust in Accept-all. (Small change to `suggest_for_role` + view.)
2. **Range check on the live value** — compare the scaled preview to `typical`; show "✓ in range" / "⚠ out
   of range — sure this is the right tag?". Turns the preview into a sanity check a first-timer can act on.
3. **Connect recognition** — score each folder for "VFD-ness" (count of drive-ish tag names) and badge the
   likely one ("Looks like a VFD — 10 matching tags"). Auto-select it as the default so the first, hardest
   choice is made *for* them, visibly.
4. **Verify verdict** — turn the count into a sentence: "✓ This looks like a live VFD — frequency,
   current, and fault-code signals all present and reading good."

## Why this order
Map is where a first-timer is most lost (cryptic tags + unfamiliar signal names), so role education ships
first. Suggestion-why + range-check reuse the same data for the most trust per line of code. Connect/Verify
recognition are higher-effort (heuristics) and lower-frequency (one decision each), so they follow.

## Deploy
All of the above is gateway-side; see it via `plc/ignition-project/testing/DEPLOY_TESTING.ps1` (elevated).
`c25c9f82` (role education) needs a redeploy to render on the Map step.
