# #4122 step-energy checker: measured on 140 blind-labeled answers

**Question:** can a deterministic check catch the answers where a step is both locked out and powered, without flagging safe checklists? Two prompt rounds had plateaued (23 → 13 → 12 of 35 answers).

## Labels (never edited)
- **Set 1:** `docs/proofs/2026-09-29-4122-step-safety-ab/`. 70 answers, the strict-rubric union of two blind judges.
- **Set 2:** `set2/`. 70 answers from the slice-2 A/B, judged blind by X (forward order) and Y (reverse order); a flag counts if either raises it.
- **Positives:** 62 answers with `loto_contradiction` true.

## Scorer
`mira-hub/src/capabilities/step-energy-labeled-set.ts` plus `step-energy-measure.test.ts`. It is controlled both ways: the labels themselves score P = R = 1, and a never-fire detector scores R = 0.

## Result (zero tokens)

| detector | TP | FP | FN | precision | recall |
|---|---|---|---|---|---|
| `validateAnswer` on main (before) | 9 | 3 | 53 | 0.75 | 0.15 |
| `stepEnergyContradiction` alone | 47 | 3 | 15 | **0.94** | **0.76** |
| `validateAnswer` with the check wired in | 49 | 6 | 13 | 0.89 | 0.79 |

- **Pass bar:** precision ≥ 0.85 and recall ≥ 0.60, fixed before tuning and gated in CI.
- **Tuning:** five iterations maximum, fixed in advance. All five were used; the change after each is recorded in the PR.
- **The two staging answers a technician marked unsafe** (#4101 review, build `9e4bf1f2`) are pinned as tests:
  - ask 1: "If the breaker is reset … if it trips again";
  - ask 3: "reset it and watch for immediate re-trip" under an opening lockout;
  - plus the technician's own example, tightening scheduled for after power is restored.
- **Remaining false positives (3):** "check the control-power supply (e.g., 24 VDC…) for … wiring" and "confirm with a test-lead on the supply terminals". Those are inspections phrased like readings.

**Limits:** the labels come from Claude-family judges; the technician review confirmed the two staging cases. This is a floor under the prompt rule, not a replacement for it. #4111 (open, Foreman-held) adds a separate live-measurement-after-lockout rule; the two are independent.
