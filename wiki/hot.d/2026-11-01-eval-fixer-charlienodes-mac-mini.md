# eval-fixer run — 2026-11-01 (charlienodes-mac-mini)

- Scorecard: 18/65 passing (27%)
- Action: issue-filed (comment on #1876: https://github.com/Mikecranesync/MIRA/issues/1876#issuecomment-6553674525)
- Hard stop: 47 patchable is more than the 15 limit. Verdicts match the last card exactly (107 cards since 10-13T1120). The cause is the graded branch `4306e091b`, 480 behind main: its router has no working provider, so replies come back as Errno 8. Not a code bug. No baseline eval was run.
- Re-run same day: newest card is still `2026-11-01T0215`, already reported in the comment above. No second comment posted (would be a duplicate). Nothing changed.
