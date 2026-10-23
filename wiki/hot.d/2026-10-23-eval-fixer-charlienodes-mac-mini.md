# eval-fixer run — 2026-10-23 (charlienodes-mac-mini)

- Scorecard: 18/65 passing (28%)
- Action: issue-filed (commented on rolling tracker #1876)
- 14th consecutive night of the inference-provider outage: 43/47 failures are `MIRA error: [Errno 8]` with the FSM in IDLE (Groq 400 billing-restricted, Together 402 out of credit, no Cerebras key in prd, Open WebUI fallback unresolvable outside Docker). 57 verdict-identical cards since 2026-10-13T1120. Graded tree is `fix/v3-composer-affordances` @ `4306e091b`, 337 behind main, so the OpenAI-led cascade from #4349 is not under test. Autopatch hard-stopped (47 > 15, 3 file clusters); no baseline eval spent. Fragment publish hazard still open (41 untracked fragments).
