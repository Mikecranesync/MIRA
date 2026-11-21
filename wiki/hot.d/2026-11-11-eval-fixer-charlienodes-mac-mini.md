# eval-fixer run — 2026-11-11 (charlienodes-mac-mini)

- Scorecard: 18/65 passing (28%) — `tests/eval/runs/2026-11-11T0245-offline-text.md`
- Action: issue-filed (comment on rolling tracker #1876: https://github.com/Mikecranesync/MIRA/issues/1876#issuecomment-6788383853)
- Hard stop, no patch: 47 patchable failures (limit 15) across 3 file clusters (limit 1). No baseline eval run, no code touched.
- 43/47 failures are `MIRA error: [Errno 8] nodename nor servname` → FSM stays IDLE. Verdict-identical to the 2026-11-10T2238 card.
- Cause is environment, unchanged since 2026-10-10: the eval grades `~/MIRA`'s checked-out branch (`fix/v3-composer-affordances` @ `4306e091b`, 569 behind main) whose router has no OpenAI path; Together returns HTTP 402 (2325 lines in the run log), so the router falls through to the Docker-only `mira-core` host.
- Owed by a human: repoint `com.factorylm.mira-offline-eval` at a current-`main` checkout.
