# Answer-Distillation Flywheel — Grading Rubric & Benchmark

**Status:** ACTIVE (2026-07-08). Runnable: `python tools/flywheel_benchmark.py`.
**Proves:** the flywheel (`.claude/plans/use-avail-skills-to-functional-wave.md`)
actually turns real Q&A into the *correct* grounded artifacts — not just that unit
tests pass. It grades the real stage code against a ground-truth fixture, and can
also report throughput over real staging data (`--live`).

## Why this exists

Each phase shipped its own unit tests, but "the tests pass" ≠ "the loop works
end-to-end." This benchmark runs the **real** pure cores of every stage over one
scenario with a **known-correct answer key** and scores how faithfully the loop
distills it. It is deterministic and CI-gated, so a regression in any stage drops
the score and fails the build.

The scenario is the real one that motivated the flywheel: technicians repeatedly
ask about GS10 parameter **P01.24**, which the drive pack didn't document — plus
matched (grounded) turns, other packs, an unregistered pack, engine turns, and
human-corrected turns for harvest.

## The stages under test

| Stage | Real code graded | What "correct" means |
|---|---|---|
| Phase 2 — label | `mira-crawler/tasks/eval_scorer.py::label_drive_pack_row` | matched turn → score 5 (grounded); unmatched → 3 (correct decline) |
| Phase 3a — gap report | `tools/drive-pack-extract/gap_report.py::aggregate_gaps` | surfaces exactly the unmatched turns, ranked by ask-frequency |
| Phase 3b — gap → suggestion | `tools/drive-pack-extract/gap_suggestion.py::build_gap_suggestions` | fires for registered packs over threshold only, with manual provenance |
| Phase 4a — harvest | `tools/harvest_golden_cases.py::row_to_proposal` | emits exactly the bad-with-correction turns |
| Phase 4b — relational distill | `tools/relational_distill.py::extract_relation_assertions` | matched **fault** turn → one grounded `HAS_FAILURE_MODE` edge; parameter/unmatched/engine turns → none |

## The rubric (6 criteria, 0–100 each)

Each criterion scores `correct_decisions / total_decisions × 100`. The overall
grade is the **unweighted mean**; the benchmark **PASSES at ≥ 90** (the fixture is
deterministic, so a healthy build scores **100** — the margin exists only to make
the intent explicit, not to tolerate silent drift).

1. **Capture→label accuracy** — every drive-pack turn gets the correct
   grounded/gap score from the real labeler. Catches a labeler that mis-scores
   grounded vs. gap turns.
2. **Gap surfacing** — the gap report lists every real gap token under the right
   pack, ranks the most-asked token first (P01.24), and shows **no** matched turn
   as a gap. Catches a report that misses gaps or invents phantom ones.
3. **Distill precision** — gap→suggestion fires for exactly the registered,
   over-threshold packs (each carrying a `registry_manual_id`), and harvest emits
   exactly the bad-with-correction turns. Catches over- or under-firing.
4. **Relational distillation** — a matched **fault** turn distils into exactly one
   grounded `HAS_FAILURE_MODE` edge (drive family → fault mnemonic); a matched
   *parameter* turn, an unmatched turn, and an engine turn distil into none; the
   model token (GS10) is never mistaken for the fault; no fault mnemonic is
   invented. Catches an extractor that over-fires or fabricates edges.
5. **No-fabrication / no-guess integrity** — no matched turn is ever relabeled a
   gap; no unmatched turn is ever "upgraded" to matched; the report never emits a
   token that wasn't in a real question. Catches the cardinal sin: fabricating an
   answer to make `matched=true`.
6. **Gate safety** — every produced suggestion is `review_only` and carries no
   auto-promote/verified flag; harvest is data-only (marks nothing); the relational
   edge is a `has_fault` proposal type that only a human decide verifies. Catches any
   path that would auto-promote into live packs, the golden set, or the graph
   without a human.

A criterion is only meaningful because the grader is itself unit-tested
(`tests/test_flywheel_benchmark.py`) — a green benchmark asserts the graders can
also *fail* on a broken stage, so 100 isn't vacuous.

## Running it

```bash
# Offline, deterministic — the correctness proof (CI-gated):
python tools/flywheel_benchmark.py [--json]

# Throughput over real captured turns (read-only; needs staging DB):
NEON_DATABASE_URL=…staging… python tools/flywheel_benchmark.py --live
```

Offline mode prints a scored rubric table + overall PASS/FAIL and exits non-zero
on FAIL (so CI enforces it). `--live` mode is **not graded** (no ground truth on
real data) — it reports how many turns were captured, matched vs. gap, the top
gaps, how many packs would get a suggestion, and how many harvest candidates
exist right now. That is the "is it working on real data" view; the score comes
from the offline fixture.

## What this is NOT

- Not a model-quality benchmark (the flywheel does **no** model training — see the
  plan's guardrails). It grades the *distillation plumbing*: does a real question
  become the right reviewable artifact?
- Not a substitute for the real-manual trust gate
  (`feedback_extractor_real_manual_trust_gate`). Distilled gaps/suggestions still
  go through the human `proposed → verified` gates; this benchmark proves they are
  *generated correctly*, not that a pack is trustworthy.

## Cross-references
- Plan: `.claude/plans/use-avail-skills-to-functional-wave.md`
- Spec: `docs/specs/bot-eval-loop-spec.md` (capture/score/harvest loop)
- Harness: `tools/flywheel_benchmark.py`; graders' tests: `tests/test_flywheel_benchmark.py`
