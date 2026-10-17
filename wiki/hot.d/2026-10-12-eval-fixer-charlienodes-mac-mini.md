# eval-fixer run — 2026-10-12 (charlienodes-mac-mini)

- Scorecard: 18/65 passing (27%)
- Action: issue-filed (comment on rolling tracker #1876)
- Not an engine regression, and NOT the "transient DNS outage" the 10-10/10-11 runs reported:
  eight identical runs since 2026-10-10 21:27. Direct probes with the prd keys show Groq
  restricted for overdue payment (400), Together out of credits (402), no Cerebras key in prd.
  With all three down the cascade falls through to Open WebUI at the compose hostname
  `mira-core`, which is what throws `[Errno 8]` on CHARLIE. OpenAI key works (200) but
  the eval runs this checkout (`fix/v3-composer-affordances` @ 34f8c42c4, Sept 9, 252 behind
  main), which predates #4349, so it can't use it. Autopatch correctly hard-stopped (47 > 15,
  3 clusters). Human actions: settle Groq / top up Together / add CEREBRAS_API_KEY to prd;
  move the launchd eval checkout to main; add a provider preflight to the wrapper.
  Report: https://github.com/Mikecranesync/MIRA/issues/1876#issuecomment-6118086509
