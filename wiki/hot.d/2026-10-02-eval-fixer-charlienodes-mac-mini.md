# eval-fixer run — 2026-10-02 (charlienodes-mac-mini)

- Scorecard: 51/65 passing (78%) — `tests/eval/runs/2026-10-02T0119-offline-text.md`
- Action: issue-filed (comment on rolling tracker #1876: https://github.com/Mikecranesync/MIRA/issues/1876#issuecomment-5945901050)
- 14 failures (11 patchable, 3 human-review). Autopatch skipped: 3 file clusters (engine.py, guardrails.py, active.yaml). Most notable: pf40_undervoltage_21 and danfoss_vlt_undervoltage_27 hit a safety STOP on "welders running" / "transformer work", which look like safety false positives.
