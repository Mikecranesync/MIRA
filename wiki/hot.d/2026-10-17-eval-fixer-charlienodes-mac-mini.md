# eval-fixer run — 2026-10-17 (charlienodes-mac-mini)

- Scorecard: 18/65 passing (27%), `tests/eval/runs/2026-10-17T0155-offline-text.md`
- Action: issue-filed (comment on #1876: https://github.com/Mikecranesync/MIRA/issues/1876#issuecomment-6229921862)
- Same provider outage as 10-10 onward: 43/47 failures are `MIRA error: [Errno 8]` (Groq billing 400 ×155, Together 402 ×155). This is the 22nd consecutive identical card. The graded tree is `34f8c42c4`, 291 behind main, and its router has no OpenAI. Autopatch hard-stopped (47 > 15, 3 clusters), so no baseline eval ran. Fix is #2952 (main-pinned checkout).
