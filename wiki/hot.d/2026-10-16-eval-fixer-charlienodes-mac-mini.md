# eval-fixer run — 2026-10-16 (charlienodes-mac-mini)

- Scorecard: 18/65 passing (27%), `tests/eval/runs/2026-10-16T0111-offline-text.md`
- Action: issue-filed (comment on #1876: https://github.com/Mikecranesync/MIRA/issues/1876#issuecomment-6208458502)
- 7th night of the same provider outage: 43/47 failures are `MIRA error: [Errno 8]`. Groq is billing-restricted (deprecated), Together returns 402 on completions, Cerebras has no key in prd. OpenAI is up, but the graded tree `34f8c42c4` (288 behind main) has no OpenAI in its router. Autopatch skipped (47 > 15, 3 clusters). Root fix is #2952 (main-pinned nightly checkout).
