# eval-fixer run — 2026-09-20 (charlienodes-mac-mini)

- Scorecard: 56/65 passing (86%) — up from 49–53/65 across the four 09-19 runs (the 09-19
  fragment's 47/65 "dip" did not persist; intraday spread of live-inference runs, not a regression)
- Action: issue-filed (rolling tracker #1876, no patch)
- 9 failures (7 patchable, 2 skip-only citation-groundedness). Hard-stopped before patching:
  `file_clusters` has 3 keys (`engine.py`, `guardrails.py`, `prompts/diagnose/active.yaml`) —
  third consecutive night on the same stop. No baseline eval run (no-patch night).
  Dispositioned 09-19's flags: the two SAFETY-STOP-fallback fixtures pass tonight; the
  `120PSI`/`90°C` pair went 2→4→1. Seven failures persist from 09-19T2127; two are new —
  `gs1_undervoltage_12` is a clean `uns_resolver` repro (gate proposes "AutomationDirect,
  218V": the voltage was taken as the model), outside the fixer's file set. Flagged 11
  unpublished fragments in `wiki/hot.d/` (09-07→09-19) — `--publish` path not running again.
  Report: https://github.com/Mikecranesync/MIRA/issues/1876#issuecomment-5747761127
