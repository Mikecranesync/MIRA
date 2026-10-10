# OpenAI qualification benchmark errata v1 — 2026-10-10

Issue: [#4342](https://github.com/Mikecranesync/MIRA/issues/4342). Risk: R2, evaluation data only. Independent exact-head review: pending. This document does not qualify a model for production or authorize routing, merge or deployment.

## Immutable starting evidence

Original run: `/Users/charlienode/Documents/Codex/foundations-acceptance-2026-10-07/openai-pilot-2026-10-10/`. Its `REPORT.md`, `HANDOFF.md`, `final-summary.json`, receipts and frozen benchmark remain unchanged. All 40 entries in `artifact-sha256.json` were verified during this continuation.

Frozen source revision: `904f7114fba40b88f7b053b271202c18e1f15922`. Original raw scores: Sol medium **97/100**; Astra medium **97/100**. Both originally disagreed with keys Q8, Q29 and Q30. Those historical scores remain valid statements about the original key version; they are not rewritten.

| Question | Original key / both model answers | Disposition |
|---|---|---|
| Q29 | B / D | Confirmed arithmetic/key defect; future fixture key becomes D. Explicitly state that both efficiencies apply at 50% load. |
| Q8 | A / B | Retain A for historical compatibility; flag as disputed/insufficiently specified. Evidence does not establish a uniquely correct replacement. Do not count B as a proven correct answer. |
| Q30 | B / A | Retain B. AEGIS supports a target below 1 V peak, with system-dependent risk; the stem should not be read as a universal damage threshold. No evidence here justifies rekeying to 500 mV. |

## Q29: reproducible correction

At the stated constant operating load:

`50 HP × 0.746 kW/HP × 0.50 × 8,760 hours × (1/0.90 − 1/0.924) = 4,714.978355 kWh/year`.

D (~4,500 kWh/year) is the closest offered answer. The prior explanation miscomputed the premium-motor losses and then introduced an unstated loading/duty-cycle assumption to select B. The repaired stem clarifies efficiency at operating load; it does not substitute a different schedule.

The [U.S. DOE motor-system guidebook](https://www.energy.gov/sites/default/files/2014/04/f15/amo_motors_guidebook_web.pdf), printed page 6-2 (PDF page 76), equations 6-1/6-2, derives input-power reduction at the operating load and multiplies by annual hours. DOE's conversion factor 0.7457 instead of the common rounded 0.746 gives about 4,713 kWh/year and the same answer D.

`tests/answer_radar/test_mcq_benchmark_errata.py` parses the fixture's stated horsepower, efficiencies, load, hours and numerical options, calculates with Decimal and checks the nearest answer. It fails on the original B key. Restoring B after the repair is the negative-control mutation; it fails again.

## Q8: insufficient evidence to rekey

The [Danfoss VLT HVAC Drive instruction manual MG.11.AC.02](https://assets.danfoss.com/documents/275856/AQ267037536117en-US0001.pdf), Troubleshooting, warning/alarm 4, describes missing supply phase, supply imbalance or an input-rectifier fault as causes of the mains-phase-loss alarm. It directs investigation of supply-side voltage/current. That supports an input-phase-loss diagnosis when that evidence exists, but does not establish that an unspecified asymmetric **output** voltage reading uniquely identifies a blown **input** fuse.

Q8 omits drive topology/model, meter/PWM measurement method, operating load, motor/cable condition and measured input/DC-link evidence. The models' B answers do not prove a ground fault either. Keep this item disputed for qualification interpretation; do not silently change its key, remove it from the historical denominator, or claim a model point recovered here. Replacement wording/key requires a separate source-backed independent review.

## Q30: manufacturer target versus universal threshold

[AEGIS / Electro Static Technology, Electrical Bearing Protection Q&A Part 9](https://blog.est-aegis.com/electrical-bearing-protection-qa-part-9), 2021-03-22, Q3, states: “We like to see shaft voltage under one volt peak.” It also explains that damage depends on the system and discharge behavior, including damage at relatively low amplitudes.

That supports B as the intended manufacturer target. It does not prove that every motor is safe below 1 V or fails above it. A more conservative 500 mV answer is not evidence that A is the intended maximum. Peak and peak-to-peak must remain distinct. Preserve B; document the wording limitation rather than inventing a universal safety threshold.

## Separately labeled sensitivity, without another paid run

Applying **only the confirmed Q29 key correction** to the already recorded answers yields **98/100 for each model**. This is a retrospective key-correction sensitivity calculation against original answers, not an independently administered score on the clarified fixture. Q8/Q30 remain original mismatches; this sensitivity is not product-path acceptance or an incumbent comparison.

## Remaining gates

Cheap lane, independent trusted-base exact-head review, applicable CI and owner merge decision remain distinct from this correction. Paid review awaits applicable spend authorization. Original evidence preservation and the regression/mutation results do not substitute for those gates.
