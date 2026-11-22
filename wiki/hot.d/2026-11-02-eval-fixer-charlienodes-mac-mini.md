# eval-fixer run — 2026-11-02 (charlienodes-mac-mini)

- Scorecard: 18/65 passing (27%)
- Action: issue-filed (comment on rolling tracker #1876 — https://github.com/Mikecranesync/MIRA/issues/1876#issuecomment-6570262307)
- No patch, because two hard limits were hit (47 patchable > 15, and 4 file clusters). 43/47 failures are `MIRA error: [Errno 8]` replies: the cloud providers are unavailable, so the router falls back to the compose-only `mira-core` host. The graded checkout is `fix/v3-composer-affordances` @ 4306e091b, about 493 commits behind main. This is the same outage signature seen since 2026-10-10.
