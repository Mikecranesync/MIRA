# eval-fixer run — 2026-10-04 (charlienodes-mac-mini)

- Scorecard: 51/65 passing (78%), from `tests/eval/runs/2026-10-04T0119-offline-text.md`
- Action: issue-filed (comment on rolling tracker #1876: https://github.com/Mikecranesync/MIRA/issues/1876#issuecomment-5976783217)
- Autopatch skipped: 3 file clusters (engine.py / guardrails.py / active.yaml), so the hard stop applied. 10 patchable, 4 human-review (3 are the #3675 `120PSI`/`90°C` grader bug).
- Measured tree is `34f8c42c4` (`fix/v3-composer-affordances`), not main. That is now 202 commits behind `origin/main`, with +278/−21 on engine/guardrails/rag_worker (#2952). The chronic 4 (`pf525_f004_02`, `gs3_ground_fault_14`, `self_critique_34`, `topic_switch_22`, each 12/12 cards) are UNKNOWN on main until #2952 is fixed.
