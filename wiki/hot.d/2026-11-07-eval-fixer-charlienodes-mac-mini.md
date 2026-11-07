# eval-fixer run — 2026-11-07 (charlienodes-mac-mini)

- Scorecard: 18/65 passing (27%)
- Action: issue-filed (comment on rolling tracker #1876, https://github.com/Mikecranesync/MIRA/issues/1876#issuecomment-6703114542)
- Same provider outage as since 2026-10-10 (43 Errno 8 via the mira-core fallback; groq 400 / together 402). New: the provider-health canary is green 3/3, but the nightly is grading the stale checkout `4306e091b` (530 behind main), whose router has no OpenAI/OpenRouter. Hard stop (47 > 15); no patch, no baseline run.
