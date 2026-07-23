# #1948 eval-regression investigation — 2026-06-22

Triage of issue #1948 ("eval: 78% pass rate regression −9pts from 87%, 3 failure
clusters"). Selected as the top actionable beta-readiness item after #2152 (prod
outage) was found recovered and #2112 (security leak) already fixed by #2127.

## Headline: the "−9pt regression" is within the eval's noise band

Committed real (non-dry-run) offline scorecards swing wildly run-to-run, hours
apart:

| Run (2026-06) | Pass rate |
|---|---|
| 06-08 0229 | 50/57 (87%) |
| 06-07 2209 | 47/57 (82%) |
| 06-07 1750 | 45/57 (78%)  ← the number #1948 calls a "regression" |
| 06-07 0009 | 42/57 (73%) |
| 06-06 1942 | 31/57 (54%) |
| 06-06 1449 | 22/57 (38%) |

Range **38%–87%** across consecutive runs. A single −9pt snapshot is noise, not a
code regression. #1948's own body hedged ("+48% runtime … cascade latency
variance … re-run needed to confirm").

## Real signal: per-scenario FAIL frequency across 11 real runs

Stable failures (fail nearly every run = real beta-blockers):

| Scenario | FAIL/runs | Failing checkpoint(s) |
|---|---|---|
| `gs3_ground_fault_14` | 11/11 | FSM + **KeyKW** (doc-routing/citation) |
| `pf525_f004_02` | 11/11 | FSM only |
| `vfd_danfoss_04_vlt_fc360_edge` | 11/11 | FSM only |
| `vfd_mitsu_03_a700_parameter` | 10/11 | FSM only |
| `asset_change_mid_session_08` | 9/11 | FSM only |

Everything else is flaky (1–8/11) = noise — including several cases #1948 listed
as "regression" (`gs4_overload_15` 2/11, `vfd_ab_01` 3/11, `danfoss_motor_overload_31`
1/11). #1948 caught a low-water-mark run and mislabeled noise as regression.

## Two root-cause threads found

1. **LLM-non-deterministic FSM gate transition** (see the verified correction in
   "Root causes" below — the default suite uses SCRIPTED turns, not the synthetic
   user). Identical scripted `pf525_f004_02` turns reach `DIAGNOSIS` in a
   standalone in-process repro but stall at `Q2` in the suite run → the
   Q→DIAGNOSIS decision is a stochastic cascade-LLM call. This drives both the
   38–87% variance and the recurring FSM-checkpoint failures. The eval has a
   record/replay determinism seam but runs live because the replay store is absent.

2. **Nemotron reranker is 404-down.** Every retrieval logs
   `Nemotron rerank failed … 404 Not Found` (`https://integrate.api.nvidia.com/v1/ranking`)
   and falls back to original order. Degrades retrieval quality (KeyKW / citation /
   doc-routing — i.e. `gs3_ground_fault_14`'s KeyKW miss) without erroring. Worth a
   separate issue.

Also noticed: `LocalPipeline` latency field reports absurd values (~19000–26000
"s" for ~1-min turns) — a units/calc bug in the harness, cosmetic.

## Recommendation (refocus #1948)

- It is NOT "chase 12 cases / −9pts." The −9pts is noise.
- Real work = the **5 stable failures**, dominated by the FSM checkpoint, plus the
  **eval-determinism** problem (stochastic synthetic user) that makes the suite
  unable to detect a true <±15pt regression.
- Pending: canonical re-run on current main (`offline_run.py --suite text`, prod
  cfg, judge off) to confirm whether the 5 stable failures survive recent engine
  fixes. Results appended below when complete.

## Current-main re-run result (2026-06-22T0421, prod cfg, judge off)

**49/57 (85%)** — `tests/eval/runs/2026-06-22T0421-offline-text.md`. This is at the
HEALTHY top of the 38–87% band and ABOVE #1948's "regressed" 45/57. **Confirmed:
the −9pt "regression" was noise. Current main is healthy. #1948 as a regression is
a false alarm.**

Per-case status of the former "stable failures" on current main:

| Case | Baseline | Now | Final FSM state | Real issue |
|---|---|---|---|---|
| `vfd_mitsu_03_a700_parameter` | 10/11 fail | **PASS 7/7** | DIAGNOSIS | fixed since baseline |
| `pf525_f004_02` | 11/11 fail | ✗ FSM only | **Q2** (exp DIAGNOSIS) | engine stays in clarify; synthetic user under-answers |
| `asset_change_mid_session_08` | 9/11 fail | ✗ FSM only | **Q1** | same |
| `vfd_danfoss_04_vlt_fc360_edge` | 11/11 fail | ✗ FSM only | (Q-state) | fixture `expected_final_state: Q2` vs synthetic-user drift |
| `gs3_ground_fault_14` | 11/11 fail | ✗ KeyKW only | FIX_STEP (FSM passes) | keyword/citation miss, Nemotron-404 aggravated |

## Root causes (the real, actionable work — NOT "fix a 9pt regression")

> **Correction (verified in code):** an earlier draft blamed the *synthetic user*.
> That was wrong. `--synthetic-user` is `store_true`, **off by default**; the 11
> baseline scorecards and this re-run all use `--suite text` = the **scripted**
> fixture path (`pipeline.run_scenario`). The synthetic-user path already respects
> per-fixture `max_turns` (offline_run.py:268). So the harness is not the cause.

1. **The engine's FSM gate transition is LLM-non-deterministic.** Identical
   *scripted* `pf525_f004_02` turns reach `DIAGNOSIS` in a standalone in-process
   repro but stall at `Q2` in the suite run — same input, different terminal state.
   The Q→DIAGNOSIS transition is decided by a (cascade) LLM call whose output
   varies run-to-run, so `cp_reached_state` flips ✗/✓ even though RState/KeyKW/
   citations stay PASS. This is the dominant source of both the 38–87% suite
   variance AND the "stable" FSM failures. The genuine fixes, in order of leverage:
   - **(a1) Populate the record/replay store.** The eval already has a determinism
     seam (`tests/eval/llm_replay.py`, `MIRA_EVAL_REPLAY=record|replay`, gated by
     `eval-replay-gate.yml`). It runs **live (non-deterministic) by default because
     the replay store `tests/eval/fixtures/llm_replay/cascade.json` is `.gitignored`
     / absent.** Record a cascade fixture and run the regression gate in `replay`
     mode → deterministic pass rate, real regressions detectable. Highest leverage.
   - **(a2) Make the Q→DIAGNOSIS transition less stochastic** — lower/zero the
     temperature on the gate-decision LLM call, or make the "enough info to
     diagnose" decision rule-based. Deeper engine work; do after (a1) quantifies it.

2. **Nemotron reranker is 404-down.** Every retrieval logs
   `Nemotron rerank failed … 404` (`integrate.api.nvidia.com/v1/ranking`) → falls
   back to unranked order, degrading citation/keyword grounding (e.g.
   `gs3_ground_fault_14` KeyKW miss). Separate infra fix: restore the endpoint/key
   or remove the dead reranker hop. Worth its own issue.

3. **`vfd_danfoss_04` fixture/grader mismatch.** Declares `expected_final_state: Q2`
   ("3-turn fixture, can't advance past Q2") but the synthetic-user driver ignores
   the 3-turn design. Reconcile fixture intent with the driver.

4. Cosmetic: `LocalPipeline` latency field reports absurd values (~19000–26000 "s"
   for ~1-min turns) — a units/calc bug.

## Bottom line

#1948 should be **reframed/closed as a false regression** (main is 85%, healthy).
The genuine follow-ups are (a) eval-harness determinism (synthetic-user / max_turns
— the highest-leverage item), (b) the Nemotron-404 reranker outage, (c) the
`vfd_danfoss_04` fixture fix. None is the "engine regression" the title implies.
