# eval-fixer run — 2026-10-19 (charlienodes-mac-mini)

- Scorecard: 18/65 passing (28%) — `tests/eval/runs/2026-10-19T0324-offline-text.md`
- Action: issue-filed (comment on rolling tracker #1876); no patch
- 10th consecutive night of the provider-billing outage first diagnosed 2026-10-10: 43 of 47
  failures reply `MIRA error: [Errno 8] nodename nor servname provided` (cascade fell through to
  the unreachable Open WebUI host). Run log: `groq HTTP 400 (billing)` ×10277, `together HTTP 402`
  ×8117. Provider-health canary red on `a249da17b`. The graded checkout is still
  `fix/v3-composer-affordances` @ `4306e091b`, 302 behind main, with zero `OPENAI_API_KEY`
  references in its router (main has 3 via #4349), so the one working provider is not in the code
  under test. 31 verdict-identical cards since 2026-10-13T1120. Hard stop: 47 patchable > 15 and
  the failures are not a code defect; baseline eval skipped (nothing spent).
