# eval-fixer run — 2026-10-01 (charlienodes-mac-mini)

- Scorecard: 53/65 passing (82%) — `tests/eval/runs/2026-10-01T0330-offline-text.md`
- Action: issue-filed (comment on #1876: https://github.com/Mikecranesync/MIRA/issues/1876#issuecomment-5925068362)
- Autopatch skipped: 3 file clusters (engine.py / guardrails.py / active.yaml), so the hard stop applied. 8 patchable failures, 4 need human review.
- Finding: 3 of the 4 citation-groundedness failures flag the phantom values `120PSI`/`90°C` from the hardcoded example option at `mira-bots/shared/engine.py:4319`.
