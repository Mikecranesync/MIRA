# eval-fixer run — 2026-08-09

- Scorecard: 54/65 passing (83%) — `tests/eval/runs/2026-08-09T0324-offline-text.md`
- Action: issue-filed (no patch — multi-cluster hard stop, night 10+)
- 11 failures / 11 patchable / 3 file clusters → hard stop per spec. Two root causes only:
  6 `cp_reached_state` (engine.py, contradictory directions) + 6 `cp_keyword_match`
  (guardrails.py + active.yaml, which the watchdog always maps to 2 targets — so one
  keyword failure alone is enough to trip the multi-cluster stop; that's #2759).
- Confirmed the suite is still non-deterministic at the new 65-fixture size: `origin/main`
  HEAD is c0d3722e (2026-08-07 20:47), nothing landed since, and the only local commit
  (828494d4 / PR #3154) touches `tools/hooks/safe-cron-pull.sh` only — yet seven
  consecutive runs on that identical code scored 51/52/55/53/54/54/54 (±4 fixtures,
  6.2 pp). The autopatch verify gate is `new_pass > baseline_pass`, a +1 threshold inside
  that band — so loosening #2759's cluster gate *alone* would convert "0 patches/night"
  into "~1 noise-justified patch/night". Both halves must ship together.
- CORRECTION recorded on #1876/#2759: neither finding was new. #3116 already documents the
  variance (σ=2.46, n=20) and #3086 already tracks the FSM pacing deadlock — I initially
  suggested filing `docs/issues/fsm-determinism-rewrite-uns-gate-intent-check.md` as a new
  issue, which would have duplicated #3086. Corrected before anyone acted on it.
- Commented: #1876 (report + correction), #2759 (mechanism + proposed watchdog/verify fix),
  #3116 (confirming data at 65 fixtures). No new issues filed — all three already exist.
- Root-cause fix already exists and is inert: **#2258** — the `llm_replay` record/replay seam
  runs live only because `tests/eval/fixtures/llm_replay/cascade.json` is gitignored/absent.
  Landing it dissolves #3116 and moots #2759's verification half. Human-run (live keys + PII
  eyeball).
- Owner actions: merge PR #3154 (green, MERGEABLE/CLEAN — fixes stale nightly grading #2952);
  then #2258 → #2759(a) → #3086 (needs a product owner for qualification pacing).
- Also noted: scorecards record no commit SHA, so scores can't be attributed to code changes.
