# Amendment 1: paired OFF/ON refusal walk (2026-10-21, before any data)

This supersedes the single-arm design in `prod-refusal-eval-plan.md`. It was written after the owner
authorized $8 and asked for a paired OFF/ON test. **No walk on the question set has run when this
amendment is frozen.** The question set is unchanged: sha256
`8a774cc68af3f9ff20922515e3514cfb97aa4612026e3cdf1024e02370c638db`, 50 questions.

## Arms (same staging hub build; only the flag differs)

| Arm | NOTEBOOK_LEXICAL_V2 | HYBRID | RERANK | Everything else |
|---|---|---|---|---|
| off | 0 | 0 | 0 | staging defaults, captured in a full `REQUIRED_CONFIG` snapshot |
| on | 1 | 0 | 0 | identical |

**Rule:** the arms are run sequentially. The staging hub is redeployed between them, from the same
`gitSha`.

## Preconditions (stop without spending if any one fails)

1. **#4583 verified.** In a dry walk, every later question is asked at full readiness, and the notes
   record the wait.
2. **The search-feature owner has explicitly agreed** to the staging configuration window. The
   agreement is recorded on #4583, with its timestamp.
3. **A `REQUIRED_CONFIG` snapshot is taken from `factorylm/stg` before each arm.** It is checked to
   differ only in `NOTEBOOK_LEXICAL_V2`.
4. **The staging `/api/health` `gitSha` matches** at the start and end of both arms.

## Budget

- **Cost per arm:** 50 turns at the booked $0.0782 = $3.91. The walk's per-run cap is set to $3.95 (`STRANGER_WALK_BUDGET_USD=3.95`; the harness can only lower its cap, and halts the run when the next turn would exceed it).
- **Cost of both arms:** $7.82. The total stays at or under $8.
- **No retries.** A run that stops early is reported as INVALID, not re-run, unless a new
  authorization is given.

## Validity

`walk_eval` checks V1 to V6 with:
- `--config` for both arms and `--vary NOTEBOOK_LEXICAL_V2`;
- `--lanes` for both arms (each must show `off` on all 50 questions);
- `--manual-dir` pointing at the pinned cache;
- `--expected` = the 50 ids.

**If the result is INVALID, no score is reported as evidence.**

## Measures

These are recorded per arm and paired.

**Per turn:**
- refusal class (`refused_clean` / `refused_cited` / `answered`, by `isRefusal` text);
- stream status;
- first citation and page;
- `vector_lane`;
- `retrieval.execute` latency;
- indexing wait from the notes.

**Per arm:**
- refusal rate, by text, with its Wilson 95% interval;
- cited-refusal rate;
- the share of turns that showed any citation.

**Paired:**
- exact McNemar on refused-by-text;
- the Newcombe interval;
- a cluster bootstrap by manual;
- per-kind breakdowns (commercial, certification, protocol, procedure, spec), marked as anecdote.

## Verdict mapping (fixed now)

**Owner criteria, via `tools/benchmark-acceptance/scorecard.py` (#4589).** Rows are
`kind=unanswerable` and `refused` = the `isRefusal` text class.

- **S2:** refusal rate in the ON arm ≥ 0.95.
- **S5:** no question refused in OFF and not refused in ON.
- **S1:** the 7 #4572 sealed cases are **not** in this run. Not reading the sealed set is a
  constraint, so S1 keeps the external 6/7 that #4589 pre-registered. That evidence comes from a run
  that `walk_eval` marks INVALID (V4, V5), and the report says so.
- **V1_sample:** fails, because there are 0 safety cases (20 needed).
- **Q1–Q5:** not measured in this run.

**Consequence, declared now:** the owner's mechanical verdict for the flag is **NO-GO**, because S1
is an external FAIL, whatever this run shows. If the external S1 were removed it would be
**INCONCLUSIVE**, because V1_sample fails and the Q-gates are unmeasured. This run's own result is
reported as S2 PASS/FAIL and S5 PASS/FAIL.

**Project provisional gates (#4578):**
- S1 for this set is "refusals gained ≥ lost", with n = 50 ≥ 44.
- S2 holds if cited refusals do not increase.

## Reporting

- **Reported in full:**
  - both run directories, with sha256 of their outputs;
  - the configuration snapshots;
  - the lanes files;
  - the `walk_eval` JSON;
  - the scorecard.
- **Shared with BRAVO** for independent re-scoring.
- **Read limit:** answered turns are read only under the verification-error rule in the original
  plan.
