# eval-fixer run — 2026-10-21 (charlienodes-mac-mini)

- Scorecard: 18/65 passing (27%)
- Action: issue-filed (comment on rolling tracker #1876)
- 12th consecutive night of the same provider outage: 43/47 failures are `MIRA error: [Errno 8]` (Groq billing-restricted, Together 402, no Cerebras key → router falls through to unreachable `mira-core` Open WebUI host). 46th verdict-identical card since 2026-10-13T1120. Graded tree is `fix/v3-composer-affordances` @ `4306e091b`, 326 behind main, with no `OPENAI_API_KEY` in its router. Hard stop (47 patchable > 15); no baseline eval run, nothing spent.
