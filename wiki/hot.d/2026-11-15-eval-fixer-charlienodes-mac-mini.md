# eval-fixer run — 2026-11-15 (charlienodes-mac-mini)

- Scorecard: 18/65 passing (28%)
- Action: issue-filed (comment on rolling tracker #1876: https://github.com/Mikecranesync/MIRA/issues/1876#issuecomment-6890067428)
- Hard stop: 47 patchable failures (limit 15) across 3 target files (limit 1). No patch, no baseline eval run.
- Cause unchanged: the eval grades the shared checkout (`fix/v3-composer-affordances` @ `4306e091b`, 592 behind `origin/main`), whose router has no OpenAI path. Groq 400 x6045, Together 402 x6045, Errno 8 x5733 in tonight's log; 43/47 failures end on `MIRA error: [Errno 8]`. Provider-health canary on main green x3.
- Fix needed (human): point `com.factorylm.mira-offline-eval` at a checkout of `origin/main`.
