# eval-fixer run — 2026-09-30 (charlienodes-mac-mini)

- Scorecard: 52/65 passing (80%)
- Action: issue-filed
- 13 failures (8 patchable, 5 human-review) spanning 3 file clusters (engine.py, guardrails.py, active.yaml), which hits the multi-cluster hard stop, so no patch was applied. Report is on rolling tracker #1876 (https://github.com/Mikecranesync/MIRA/issues/1876#issuecomment-5904405114). Top lead: the ungrounded `120PSI`/`90°C` repeats across two unrelated GF fixtures, which suggests a leaking prompt example.
