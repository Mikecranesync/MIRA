# eval-fixer run — 2026-10-30 (charlienodes-mac-mini)

- Scorecard: 18/65 passing (28%)
- Action: issue-filed (tracker #1876, comment 6515384350)
- Same provider outage as every night since 2026-10-10: 43/47 failures reply `MIRA error: [Errno 8]` because Groq (400, overdue payment), Together (402) and Cerebras (no prd key) are all down and the Open WebUI fallback host is unresolvable outside Docker. 97 verdict-identical cards since 10-13T1120; canary red ×3. Hard-stopped (47 patchable > 15), no baseline eval spent. Graded tree is still `fix/v3-composer-affordances` @ `4306e091b`, 457 behind main, so #4349's OpenAI-led cascade is not under test.
