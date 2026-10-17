# eval-fixer run — 2026-10-07 (charlienodes-mac-mini)

- Scorecard: 55/65 passing (84%) — `tests/eval/runs/2026-10-07T0302-offline-text.md`
- Action: issue-filed (comment on rolling tracker #1876: https://github.com/Mikecranesync/MIRA/issues/1876#issuecomment-6031294621)
- Hard stop: 3 file clusters (engine.py ×4, guardrails.py ×6, active.yaml ×6) — no patch, no eval run.
- Graded tree is still the shared checkout's `34f8c42c4` (`fix/v3-composer-affordances`, clean, unchanged since 2026-09-09), now 229 behind `origin/main` @ `f83e9df25` — #2952 still open. The real gap is 9 files +1481/−86 under `mira-bots/shared/`+`prompts/` (incl. retrieval: `neon_recall.py`, `manual_search/`), not the previously-quoted engine-only +278/−21.
- Chronic 4 unchanged at 12/12 (pf525_f004_02, gs3_ground_fault_14, self_critique_34, topic_switch_22); pf525_f004_02 changed failure shape (Q3→IDLE) on an identical tree = nondeterminism. New flicker symptom_switch_25 = same "direct answer → IDLE" family as topic_switch_22.
- No 10-06 run trace (no comment/fragment/PR); fragment PRs #4199/#4204/#4220/#4242 still open.
