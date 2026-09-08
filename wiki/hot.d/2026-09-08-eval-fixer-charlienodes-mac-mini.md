# eval-fixer run — 2026-09-08 (charlienodes-mac-mini)

- Scorecard: 52/65 passing (80%) — but **56/65 (86%) once the grader false positive is removed**.
- Action: issue-filed — **two named defects promoted out of the tracker**: #3675, #3676.
  Tonight's report commented on rolling tracker #1876.
- **No patch.** Autopatch hard stop (3 `file_clusters` keys, which also *overlap* —
  `self_critique_low_groundedness_34` is in all three, so they aren't a partition).

## What changed vs 2026-09-07

Yesterday found the same two defects and left both as tracker comments. They produced **zero
action**, and the fragment carrying them is still in unmerged PR #3658. So tonight they were
filed as their own issues — the de-dup rule bans a new *dated* issue per run, not a named defect.

- **#3676 — cross-vendor fault-code bleed (the serious one).** A PowerFlex 525 undervoltage answer
  asserts **CE10**, a Delta/DURApulse GS10 comm code that cannot appear on that drive. Chronic
  **10/10**, `regression`-tagged, reproduces a live phone-battery FAIL from 2026-08-05. This is a
  grounding violation, not a phrasing miss. Four *other* cross-vendor fixtures passed the same run
  (`vfd_siemens_03`, `vfd_ab_03`, `vfd_danfoss_03`, `symptom_switch_25`), so cross-vendor handling
  is healthy in general — what's broken is session context yielding to an explicit new-equipment
  question.
- **#3675 — grader false positive.** `cp_citation_groundedness` scrapes numeric specs from the
  whole reply *including MIRA's own option menu*, so the placeholders at `engine.py:4319`
  (`"3. Sensor reading (e.g. pressure at 120 PSI, temp at 90°C)"`) grade as ungrounded citations.
  `answer_qc.py:95 _assertions_only()` already strips exactly this in production — its own comment
  says "*both false positives were observed live*" — and `grader.py:338` has no equivalent guard.
  4/13 of tonight's failures and **100% of the "needs human review" bucket**. One-line fix proposed.
  Correctly *not* auto-patchable: `grader.py` is on the NEVER-modify list, and a nightly agent
  editing its own scoreboard is exactly what that guard prevents.

## Decomposition — measured, not inferred

Per-fixture pass/fail across the last 10 runs, with controls:

| Class | N | Fixtures |
|---|---|---|
| Chronic (real) | 4 | `topic_switch_gs10_to_pf525_22` 10/10, `pf525_f004_02` 10/10, `self_critique_low_groundedness_34` 10/10, `gs20_cross_vendor_03` 8/10 |
| Grader FP | 4 | `gs4_overload_15`, `pf525_ground_fault_19`, `pf40_undervoltage_21`, `sew_overcurrent_29` |
| Flippers (noise) | 5 | `pf520_17` 5/10, `full_diagnosis_07` 5/10, `pf523_18` 4/10, `pf527_20` 4/10, `vfd_abb_03` 1/10 |

Controls: `safety_escalation_06` 0/10 fails, `gs10_overcurrent_01` 1/10 — the scan is not blind.
(First attempt at this scan *was* blind: `$RUNS` expanded as one filename and every fixture read
`-`. Caught by the positive control, redone in Python.)

## Standing, unfixed

- **Nondeterminism band is wider than yesterday's estimate: 44–58 across 20 runs** (yesterday said
  49–58; the 09-07T1407 run at 44/65 widened it). `offline_run.py` defaults to
  `INFERENCE_BACKEND=cloud`, so "offline" means *no VPS*, not deterministic.
- **Step 7's verify gate remains statistically invalid** — a single before/after full-suite pass
  count cannot detect a patch delta inside ±7; a no-op patch would "verify" ~half the time. Valid
  gate would be N≥3 repeats scoped to the affected chronic fixtures. Skipped Steps 5–7 entirely
  tonight rather than burn ~23 min of live cascade on a night with no patch.
- Two chronic FSM failures not yet filed (no clean single owner): `pf525_f004_02` +
  `gs20_cross_vendor_03` both stop at `Q2` where `DIAGNOSIS` is expected;
  `self_critique_low_groundedness_34` lands `AWAITING_UNS_CONFIRMATION` vs `Q1` — worth checking
  whether that *fixture* predates the current UNS-gate behaviour before treating it as an engine bug.
- Watching, not filing: `pf523_heatsink_18` answered a heatsink-overtemp question with
  `STOP — describe the hazard` (candidate safety over-escalation) but fails only 4/10, so it is
  indistinguishable from noise. If it goes chronic, prior pointer is the LLM router's
  `safety_concern`, not `SAFETY_KEYWORDS`.

Clean tree apart from this fragment; no code changed. Branch at run time:
`feat/flm-ui-v3-prototype` @ `1fdff1739` (read-only run, nothing committed).
