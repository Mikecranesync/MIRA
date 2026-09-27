# eval-fixer run — 2026-09-27 (charlienodes-mac-mini)

- Scorecard: 50/65 passing (77%) — `tests/eval/runs/2026-09-27T0331-offline-text.md`
- Action: issue-filed (commented on rolling tracker #1876: https://github.com/Mikecranesync/MIRA/issues/1876#issuecomment-5852806602)
- No patch: 3 file clusters (engine.py, guardrails.py, prompts/diagnose/active.yaml), so the multi-file hard stop applied. Ten failures were patchable: FSM stuck at Q2/Q3 (6 fixtures) and missing keywords (5), several of them KB-miss replies on AutomationDirect GS-series fixtures. Five citation-groundedness failures need a human.
- Trend: last 12 runs ranged 50–58/65 with no code changes in between. That is live-inference noise, so tonight is the bottom of the band, not a clear regression.
