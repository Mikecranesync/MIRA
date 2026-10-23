# eval-fixer run — 2026-10-20 (charlienodes-mac-mini)

- Scorecard: 18/65 passing (27%)
- Action: issue-filed (commented on rolling tracker #1876)
- 11th consecutive night of the provider-outage signature: 43/47 failures are `MIRA error: [Errno 8]` (Groq 400 billing, Together 402, no Cerebras key → Open WebUI hostname unresolvable). Verdict-identical to the prior card; 40 such cards since 10-13T1120. Autopatch skipped (47 > 15 cap; not a code defect). Graded tree is `fix/v3-composer-affordances` @ 4306e091b, 314 behind main, with no OpenAI lane. $0 spent — no baseline eval run.
