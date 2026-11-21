# eval-fixer run — 2026-11-03 (charlienodes-mac-mini)

- Scorecard: 18/65 passing (28%)
- Action: issue-filed (comment on rolling tracker #1876, 6596646316)
- Hard stop: 47 patchable failures, which is over the limit of 15. Verdicts match the 11-02T2331 card (~119 identical cards since 10-13T1120). Cause is unchanged: the graded branch `4306e091b` is 497 behind main and its cascade (Groq 400 / Together 402 / OWUI Errno 8) has no working provider. The canary is green on main (OpenAI→OpenRouter). No baseline eval run, no code changed.
