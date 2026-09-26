# eval-fixer run — 2026-09-21 (charlienodes-mac-mini)

- Scorecard: 49/65 passing (75%) — down from 56/65 on 09-20, inside the 49–53 spread of the
  four 09-19 runs (live-inference intraday noise; not a confirmed regression)
- Action: issue-filed (rolling tracker #1876, no patch)
- 16 failures (7 patchable, 9 skip-only citation-groundedness). Hard-stopped before patching:
  `file_clusters` has 3 keys (`engine.py`, `guardrails.py`, `prompts/diagnose/active.yaml`) —
  fourth consecutive night on the same stop. No baseline eval run (no-patch night).
  New finding: the `120PSI`/`90°C` "ungrounded citations" (8 of the 9 skips tonight) are the
  example values from the engine's own canned clarification menu (`engine.py:4319`), not
  model output — a grader false positive that tracks how many fixtures end on that turn.
  Two best-seeded fixtures (`pf525_f004_02`, `full_diagnosis_happy_path_07`) hit the KB-gap
  prefix — a recall miss on the most-covered vendors; flagged for `retrieval-diagnostics`.
  12 unpublished fragments in `wiki/hot.d/` (09-07→09-20) — `--publish` still not running.
  Report: https://github.com/Mikecranesync/MIRA/issues/1876#issuecomment-5755630541
