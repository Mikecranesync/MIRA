# 2. Segment and entry offer (internal)

## Recommendation
**Segment:** single-site plants in Polk/Tampa/Orlando, 50–500 staff, small maintenance crew (≈5–30), Allen-Bradley drives/PLCs (PowerFlex, Micro800). Food & beverage, chemical/coatings, and metal/machinery fit best.
**Entry offer:** *Equipment-specific manuals & troubleshooting* — one asset (or one drive family), its approved manuals in a MIRA equipment notebook, used by the crew for 30 days.

## Why this one (evidence)
| Option | Evidence today | Verdict |
|---|---|---|
| Manuals & troubleshooting | Only option on the proven path (P1, P7, P8, P10: 6/6 right page on prod) | **Pick** |
| Digital inspections/measurement | Nothing built (capabilities NOT YET); brake-gap is illustrative only | Later add-on |
| CMMS workflow integration | Read/write not proven (P4); connectors only researched (briefs 2026-10-25-cmms-*) | Optional add-on after pilot |
| Read-only equipment data/faults | No PLC/data read exists | Proposed |
Local evidence: public Lakeland-area job posts ask for training, RCA, CMMS and uptime — the crew-knowledge problem we solve (named plants and a private prospect list are not in this repo). Rockwell is what local integrators standardize on.

## Forward-deployed engineering, plain English
We don't mail you software and wish you luck. Mike comes to the plant, stands at the machine with your techs, loads the right manuals for that machine, tests the answers against your real faults, and fixes what doesn't work — on site, side by side, until it's useful.

## Scope
- **Prerequisites:** one named asset; its OEM manuals (PDF, text not scan) at the approved revision; a maintenance lead as owner; 3–10 techs with phone or browser; a list of 10+ recent faults/questions; IT OK for a cloud web app. No network or PLC access needed.
- **Discovery (free, 60–90 min, justified: it qualifies the asset and builds the test set, no delivery work):** walk the asset, collect manuals + revision, collect recent faults, agree baseline metric.
- **Deliverables:** configured notebook for the asset; frozen test set of the site's own questions with page-checked answers; onsite kickoff + training; weekly check-in; end report (accuracy on test set, usage, time-to-answer vs baseline, gaps found).
- **Duration:** ~2 weeks setup + 30 days use (estimate, no promised dates).
- **Acceptance criteria (agreed at discovery):** ≥ X% of the frozen test questions answered with correct cited page (proposed X=80%); "not in manual" instead of guessing on out-of-scope questions; ≥ N techs used it on real work; baseline vs pilot time-to-find recorded.
- **Pricing hypothesis (INTERNAL ONLY, never public):** paid fixed-fee pilot, [pricing internal] for one asset, credited toward a subscription if they continue. Validate in first 3 discovery calls. Checkout is not ready (#4369) — invoice manually.
- **Support boundaries:** read-only; reference tool, not a work instruction; no PLC/safety changes, no return-to-service calls; techs follow site LOTO and the OEM manual; business-hours support; customer manuals never go to free third-party models.
- **Next step after pilot:** expand to the next 3–5 assets/line on subscription; optional add-ons (CMMS link, inspection checklist) scoped only after this works. MIRA stands alone; connectors are optional.

No Ford affiliation, ever.
