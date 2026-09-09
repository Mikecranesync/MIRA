# eval-fixer run — 2026-09-09 (charlienodes-mac-mini)

- Scorecard: 55/65 passing (85%) — top of the last-10 band (`53 44 52 53 52 53 50 52 55 55`).
  The +3 vs 09-08 is the four #3675 grader-false-positive fixtures happening to pass, not a fix.
- Action: issue-filed — **#3713** (new chronic defect) + tonight's report commented on rolling
  tracker #1876.
- **No patch.** Autopatch hard stop: 3 `file_clusters` keys (`engine.py` ×6, `guardrails.py` ×5,
  `active.yaml` ×5), overlapping (`pf520_17` and `self_critique_34` in all three). Steps 5–7
  skipped — a single before/after full-suite count can't see a delta inside ±7 (#2759).

## New tonight — #3713 `gs3_ground_fault_14`, chronic 9/10

Missed by yesterday's chronic list. Turn 6 (post-`PROCEED`, "what's causing the ground fault")
gets the KB-miss clarifier asking **who made the equipment** on a session that resolved GS3 on
turn 1 and is in `DIAGNOSIS`. That variant is only emitted by `rag_worker.py:312
_build_clarification_request` when `asset_identified` is empty — so the session asset is not
reaching the worker on the post-PROCEED turn. Same family as #3676 (context not surviving into a
later turn). Hypothesis until a single-fixture repro shows the call site.

## Decomposition (last 10 runs, measured)

| Class | N | Fixtures |
|---|---|---|
| Chronic | 5 | `pf525_f004_02` 10/10 (#3676), `topic_switch_22` 10/10, `self_critique_34` 10/10, `gs3_ground_fault_14` 9/10 (#3713), `gs20_cross_vendor_03` 8/10 |
| Flippers | 4 | `full_diagnosis_07` 5/10, `pf520_17` 5/10, `gs10_01` 3/10, `yaskawa_j1000_24` 3/10 |
| Citation scrape | 1 | `yaskawa_a1000_ov_23` 5/10 — `400V`/`660V` lifted from the reply's own `[Source: … E1-01 <400V Vdc=660V]` tag; #3675's class, different surface |

Controls: `safety_escalation_06` 0/10; `pf523_heatsink_18` 4/10 (still watching for STOP
over-escalation, still noise).

## Two "flippers" are turn timeouts

`gs10_overcurrent_01` and `pf520_hw_overcurrent_17` both hit `Slowest 30.0s`; gs10's final reply
is the "taking longer than usual" placeholder. Provider-health canary red on every run since
2026-09-07 21:35Z (Cerebras 402, #3711; latest red 09-09T04:51Z) — cascade is on two providers.
Correlation only, not proven, but rule it out before reading those two as engine failures.

Clean tree apart from this fragment; no code changed. Branch at run time: `feat/hub-v3-surface`
@ `4a01ae8f9` (read-only run, nothing committed — standing #2952: nightly grades the checked-out
branch, not `main`).
