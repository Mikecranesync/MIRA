# FactoryLM Personal SWE-Bench — Starter Set (§14)

**Date:** 2026-08-15 · **Source:** explorer sweep of merged MIRA PRs (state=merged, <20 files, deterministic tests in-diff, clear problem statement). ~40-50 candidates across 10 capability areas. Every PR below merged with its tests; merge SHAs allow "restore repo immediately before the fix" reconstruction.

## Categories and exemplar cases

| Category | Exemplars | Why they benchmark well |
|---|---|---|
| Engine FSM & dialogue state | #3140 (`eca317a5`), #3141 (`d4c3abf0`), #3142 (`2147f40b`) | deterministic FSM tests; symptom-pivot, repeated-answer guard, conversational lanes |
| Citation compliance & grounding | #3214 (`c5024d01`), #3122 (`34d2c6b7`), #3124 (`52bfdccb`) | integrity checks on every reply; photo-is-not-citation |
| Retrieval & RAG quality | #3133 (`5e51a670`), #3168 (`0d5b9480`), #3051 (`ad02ba57`) | cross-vendor filter stability; per-turn retrieval probe |
| Hub API & migrations | #3223 (`8c8a41c4`), #3229 (`cd93668c`), #3240 (`7d6fa849`) | idempotency (mig 074), validation flows |
| Deploy, ops & infra | #3170 (`b4999550`), #3175 (`525d667f`), #3184 (`ab67c15a`) | workflow-ordering invariants with tests that provably fail pre-fix |
| Testing & CI infra | #3215 (`105179f8`), #3198 (`258ceef2`), #3174 (`6c1e8ef0`) | SQLite xdist isolation, gate enforcement |
| UAT & campaign automation | #3149 (`481e6143`), #3150 (`c0d3722e`), #3171 (`0c55f7d8`) | YAML-scripted, judge/ledger graded |
| Safety & guardrails | #3120 (`0df6d88c`), #3119 (`3bb414cb`), #3108 (`f2a5e1c3`) | classifier parity, phrase-set sync — crisp pass/fail |
| PrintSense & vision | #3117 (`36e6b33d`) + single-call vision tests around #2664 | deterministic parser fixes with golden fixtures |
| Ingest & live-data freshness | #3232 (`37493d4b`), #3059 (`0c75c1ae`), #3062 (`0cc22b4a`) | frozen/replayed verdicts, authorized-ingress proofs |

## Build procedure (per §14)

For each case: (1) `git checkout <merge_sha>^` into an isolated worktree; (2) hide the patch; (3) hand the candidate agent the PR's problem statement (issue text or PR body "What/Why"); (4) run the PR's own tests + current architecture contracts (`tests/test_architecture.py`, boundary gates); (5) score solve/regression/violations/unnecessary-diff/time/tokens against the known implementation.

## Measurement schema

`solve_rate, regression_rate, architecture_violations, unnecessary_modifications (diff-lines outside the known fix's file set), reviewer_findings, wall_time, tokens_cost, false_assumptions (claims contradicted by repo facts)`.

## Notes

- Prefer cases whose tests are **hermetic** (no VPS, no NeonDB) — the FSM/citation/safety/CI categories are the strongest starters.
- The deploy-workflow cases (#3170/#3175) are unusual gems: their regression tests were verified to fail on the pre-fix tree, so grading is fully deterministic.
- Target per §14 is 50–100; this seed lists ~30 strong + categories to mine for the rest (extend by walking `gh pr list --state merged` past #3000).
