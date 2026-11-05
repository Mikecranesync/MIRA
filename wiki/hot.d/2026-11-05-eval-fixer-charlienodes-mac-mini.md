# eval-fixer run — 2026-11-05 (charlienodes-mac-mini)

- Scorecard: 18/65 passing (28%)
- Action: issue-filed (commented on tracker #1876, comment 6650975491)
- Hard stop: 47 patchable failures, over the limit of 15. Verdicts are identical to the 0132 card. 43 failures are Errno 8 from the provider cascade falling through (Groq 400 / Together 402) in the graded branch `fix/v3-composer-affordances` @ `4306e091b`, which is 520 behind main. No patch, and no baseline eval was run.
