# eval-fixer run — 2026-11-16 (charlienodes-mac-mini)

- Scorecard: 18/65 passing (28%) — `tests/eval/runs/2026-11-16T0159-offline-text.md`
- Action: issue-filed (comment on rolling tracker #1876: https://github.com/Mikecranesync/MIRA/issues/1876#issuecomment-6908694031)
- Hard stop, no patch: 47 patchable failures (limit 15) across 3 file clusters (limit 1). No baseline eval run, no files edited.
- 43 of 47 failures are `MIRA error: [Errno 8]` — the graded checkout (`fix/v3-composer-affordances` @ `4306e091b`, 602 behind `origin/main`) can only call Groq/Together, both refusing (groq 4xx ×6832, together 402 ×6832 in tonight's log). Fix is to point the eval launchd job at `origin/main`.
