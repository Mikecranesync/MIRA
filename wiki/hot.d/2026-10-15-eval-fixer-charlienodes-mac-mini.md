# eval-fixer run — 2026-10-15 (charlienodes-mac-mini)

- Scorecard: 18/65 passing (27%), `tests/eval/runs/2026-10-15T0436-offline-text.md`
- Action: issue-filed (comment on rolling tracker #1876: https://github.com/Mikecranesync/MIRA/issues/1876#issuecomment-6184802767)
- 6th identical night. 43 of the 47 failures are `MIRA error: [Errno 8]`. The cascade is down for the graded tree: provider-health canary run 38683602250 shows openai UP, groq DOWN (400, billing), together DOWN (402).
- The graded tree is `fix/v3-composer-affordances` @ `34f8c42c4`, 280 behind `origin/main`, and its router has no OpenAI provider. Main has it (#4349/#4436), so the one provider that is up can't be reached by the code under test.
- Autopatch skipped: 47 patchable > 15, and 3 file clusters.
- Corrected the 10-14 report's "pay the Groq bill" step: Groq is deprecated (owner, 2026-10-14, #4438). The fix is pointing the nightly at an `origin/main` worktree (#2952).
