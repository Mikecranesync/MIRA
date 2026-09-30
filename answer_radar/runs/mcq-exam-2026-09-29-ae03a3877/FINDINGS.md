# Technician exam re-benchmark on staging `ae03a3877` (2026-09-29)

**Why:** Mike asked to re-benchmark after the exam recommendations shipped:
#4096 (teach the isolation step without a voltage number), #4094 (decline next-step
copy for passcodes / firmware recovery), #4092 (independent gpt-5.5 grader). Baseline:
`../mcq-exam-2026-09-28/FINDINGS.md` (staging `76887423c`).

**How:** `tools/qa/mcq_exam_staging.sh <out> --diagnostics`, same 100 questions, one blank
chat per question, throwaway stranger account (swept). Then three re-ask passes of the
questions that moved (`--ids 3,6,9,24,30,70,77`, `reask-pass{1,2,3}/`). Free-tier inference only.
Staging confirmed at `ae03a3877912…` (`/api/version`) before the run.

## Result

| | Committed key | Corrected key (Q29=D; Q3, Q16 excluded) |
|---|---:|---:|
| MIRA 09-28 (`76887423c`, regraded) | 92 / 100 | 93 / 98 |
| MIRA 09-29 (`ae03a3877`) | 91 / 100 | 90 / 98 |
| Bare gpt-oss-120b (09-28) | 94 / 100 | — |
| gpt-5.5 direct (09-28) | 96 / 100 | — |

**One full run is within noise** (earlier finding: a delta under ~6 is noise). The re-asks
are what separate MIRA's layer from model variance:

| Q | Full run | Re-asks 1/2/3 | Reading |
|---|---|---|---|
| 3 | A ✓ | A ✓ / A ✓ / A ✓ | **#4096 fixed it**; 09-28 was blocked (UNPARSED) |
| 6 | A ✓ | A ✓ / A ✓ / **blocked** | improved, not eliminated |
| 77 | **blocked** | A ✓ / **blocked** / A ✓ | same gate class, a textbook RTD question (PT100 vs PT1000) |
| 9 | C ✗ | B ✓ / C ✗ / C ✗ | **letter/reasoning mismatch** (below) |
| 24 | C ✗ | D ✓ / D ✓ / C ✗ | model variance |
| 30 | A ✗ | B ✓ / B ✓ / D ✗ | model variance; gpt-5.5 also misses it |
| 70 | C ✗ | C ✗ / C ✗ / C ✗ | the bare gpt-oss-120b also answers C; gpt-5.5 answers A: a model knowledge gap |

## Findings

1. **The exact-rating answer gate still refuses correct general answers.** On this build it
   blocked 3 of 12 asks across Q3/Q6/Q77 (`answer_gate.reason=unsupported-specificity:exact-rating`).
   For Q3/Q6 it was 1 of 8, versus 2 of 4 on 09-28. #4096 cut the rate; it did not remove it.
   Q77 shows the class is wider than isolation voltages: "1,000 Ω at 0 °C" is a definitional
   value, not a machine rating. This was an accepted trade-off in the handoff (Q6-style
   restatements); the data says it's still roughly 1 in 4 on these questions.
2. **Q9: MIRA's reasoning says B, its letter says C** (3 of 4 asks). The text computes
   "(½)³ ≈ 0.125 … about one-eighth (12.5%)", which is option B, then leads with "C". The bare
   model answers B. The harness sends the same stem and options in the same order as
   `tests/mira_eval.py`, so the mismatch comes from MIRA's layer (prompt or answer shaping), not
   the exam. Not yet diagnosed.
3. **Q70 is a gap in gpt-oss-120b's knowledge, not MIRA's layer.** MIRA and the bare gpt-oss-120b
   both answer C (200 °F) every time; gpt-5.5 answers A (160 °F, the key). Grounding (a cited
   hydraulic-oil spec) is the fix, not a prompt.

## Hazard ledger
- Exact-rating false refusals: still ~1 in 4 on gate-prone questions. Filed as #4098 (owner
  decision: exempt definitional values?).
- Q9 letter mismatch: undiagnosed; filed as #4099.
- Q70: model knowledge gap; no key change proposed.
