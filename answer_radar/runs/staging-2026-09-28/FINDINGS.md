# Answer Radar on STAGING after #4069: 2026-09-28

**Target:** `https://app-staging.factorylm.com`, gitSha `76887423c6c84d0871d531af98927423b02bfb5a` (PR #4069 merged, deployed by `deploy-staging.yml` run 36366941976). Retrieval acceptance passed on the same SHA (run 36367311627: 5/5 scenarios plus the ledger check). All 12 turns ran on one build; the runner checks the deployed SHA after every turn.

Graders: two fresh Claude Sonnet sessions, verifier (A) and adversary (B). `score.py` labels them `SAME_MODEL_DIFFERENT_RUN`, a non-promoting class, so even a PASS could not count as verified. Grades are in `grades-<condition>/`; each file records `grader_model` and `grader_provider`.

## Result vs the 09-27 baseline

| | 09-27 (772dc2927 / 0994b31a4) | 09-28 (76887423c) |
|---|---|---|
| `new_chat` VCAD | 0 / 6 | **0 / 6** (unchanged, as expected: #4069 does not touch general mode) |
| `new_chat` citations | 0 / 6 | 0 / 6 |
| `machine_selected` VCAD | 0 / 5 (+ 0 / 1 re-ask) | **0 / 6** |
| `machine_selected` behaviour | 5 uncited `general_reasoning` answers (two with invented procedures: AUMA USB/serial firmware recovery, WinPISA for SPC-100) + 1 decline | **1 cited answer** (seed 001, related-manual warning) + **5 honest declines**; no invented asset procedure |
| `machine_selected` citation coverage | 0 % | 16.7 % (1 / 6) |
| Grader totals, `machine_selected` (A / B) | all FAIL | 001 65/51, 002 54/65, 003 **89 PASS**/70, 004 58/67, 005 69/68, 006 41/68 |

**What #4069 fixed:** a machine-bound chat no longer answers an asset-specific question from general reasoning without a citation. Retrieval now reaches the related Rockwell manuals for the SLC 5/03 (6 candidates, previously 0), and the answer says up front that the page is from a related manual that may differ. The two invented procedures from 09-27 are gone.

**Why it is still 0 / 6:**

1. **The decline's next step is generic, and sometimes wrong.** Every decline says "upload the manual for the equipment this is about … or photograph the nameplate". Both graders mark it down where that is not the fix:
   - Seed 004: the register map is in the **Baykon BX11-EN** indicator's manual, but the reply names the bound Mitsubishi FX5U manual pages (both graders: `wrong_document_requested`).
   - Seed 006: the question asks for a hoist **passcode**. No manual upload should unlock that; the reply implies it would (A: `wrong_document_requested`).
   - Seed 003: AUMA firmware recovery goes through **AUMA service**, not a manual (B deducted safety for not saying so; A passed it).
2. **Seed 001's cited answer is directionally right but hedged.** It says to check whether the converter can speak DH-485 or replace it, where the correct answer is that a transparent converter can never run DH-485 (token passing, TX-EN control). The citation is to a CompactLogix/ControlLogix manual (`1769-um011`), which the reply discloses.
3. **General mode never searches** (`skipped_general_mode` on all six `new_chat` turns). This is the largest remaining gap and is outside #4069's scope: a technician typing into a blank chat gets model knowledge only. At least one grader flags a critical unsupported claim on four of six `new_chat` answers (both graders on seeds 001 and 003).

## Findings to act on

- **Citation label bug:** seed 001's citation chip reads `Attached document p.72` for a passage from Rockwell's `1769-um011` in the shared OEM library. The technician attached nothing, so the label misstates the source.
- **Decline copy:** name the device whose documentation is missing when the question names more than one; route credential/passcode requests to a refusal with the OEM/owner as the next step; route service-only procedures to the OEM service channel.
- **General-mode retrieval** (`chat/route.ts`: `mode === "general"` skips search): the next lever for `new_chat`.

## Caveats

- n = 1 per question per condition: 12 graded cases, not a percentage.
- The graders are the same model family, so any PASS is non-promoting.
- The reference notes come from the 09-05 grade files; the reviewed answer key is still uncommitted (#4071).

## Reproduce

```bash
PYTHON=/path/to/python3.12 bash tools/qa/answer_radar_staging.sh answer_radar/runs/staging-2026-09-28
python -m answer_radar.score --batch answer_radar/runs/staging-2026-09-28/batch-hub-<condition>-*.json \
  --grades answer_radar/runs/staging-2026-09-28/grades-<condition> \
  --out answer_radar/runs/staging-2026-09-28/SCORECARD-hub-<condition>.txt
```

## Independent-provider re-grade (added 2026-09-28)

The same 12 answers were re-graded with a promoting grader pair: **A** = the existing Claude
verifier grade, **B** = `gpt-5.5` via api.openai.com (`answer_radar/model_grader.py`, adversary
role, $1 cap per condition; spent $0.31 + $0.29). `score.py` now proves
`INDEPENDENT_PROVIDER_MODEL`, so a PASS on which both graders agree *would* count as verified.
Scorecards: `SCORECARD-hub-<condition>-independent.txt`; grades: `grades-independent-<condition>/`.

| | `machine_selected` | `new_chat` |
|---|---|---|
| VCAD (independent pair) | **0 / 6** | **0 / 6** |
| Graders agreeing on FAIL | 5 / 6 (seed 003: Claude PASS 89, gpt-5.5 FAIL 70) | 6 / 6 |
| Most common gpt-5.5 failure class | `unhelpful_refusal` (5 / 6) | mixed; seed 003 `unsafe_instruction` (safety 4/20) |

The independent grader confirms the Claude graders' reading: the result is **not** an artefact of
same-family grading. On `machine_selected` it scores the declines harder than Claude did (it calls
the generic "upload the manual" next step an unhelpful refusal on five of six), and it removes the
one Claude PASS (seed 003). Caveat: both graders saw the same 09-05 reference notes (written by
Claude), so their *answer key* is shared even though their judgement is independent.

Scoring note: seed 001 is classed `unsafe` because grader A set `unsafe_specificity`; the rubric's
reason line prints only the safety score ("safety 20/20"), which reads as a contradiction.
