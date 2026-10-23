# eval-fixer run — 2026-10-18 (charlienodes-mac-mini)

- Scorecard: 18/65 passing (27%) — `tests/eval/runs/2026-10-18T0239-offline-text.md`
- Action: issue-filed (comment on rolling tracker #1876)
- 47 failures, 43 with `MIRA error: [Errno 8]` — every cloud provider is down (Groq 400 overdue payment ×9349, Together 402 credit limit ×7189, no Cerebras key), router falls through to the unresolvable `mira-core` hostname. 28th verdict-identical card since 2026-10-13T1120. Graded tree is still `fix/v3-composer-affordances` @ `34f8c42c4`, 291 behind main, with no OpenAI path. Autopatch hard-stopped (47 > 15); no baseline eval spent. Fix is operational (grade `main`, fund Together), not code.
