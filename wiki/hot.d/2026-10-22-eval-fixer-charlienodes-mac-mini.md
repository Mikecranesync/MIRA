# eval-fixer run — 2026-10-22 (charlienodes-mac-mini)

- Scorecard: 18/65 passing (27%) — `tests/eval/runs/2026-10-22T0128-offline-text.md`
- Action: issue-filed (comment on rolling tracker #1876)
- 13th consecutive night of the same cause: 43/47 failures reply `MIRA error: [Errno 8]`
  because every cloud provider fails (Groq 400 billing ×12912, Together 402 ×10751, no
  Cerebras key) and the router falls through to the unresolvable compose host `mira-core`.
  Graded tree is `fix/v3-composer-affordances` @ `4306e091b`, 335 behind main, with no
  OpenAI in its cascade. Hard stops hit (47 > 15 patchable, 3 file clusters); nothing patched,
  no baseline eval spent. 51 verdict-identical cards since 2026-10-13T1120.
