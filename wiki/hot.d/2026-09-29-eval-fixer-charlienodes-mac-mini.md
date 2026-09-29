# eval-fixer run — 2026-09-29 (charlienodes-mac-mini)

- Scorecard: 48/65 passing (74%) — `tests/eval/runs/2026-09-29T0328-offline-text.md`
- Action: issue-filed (comment on rolling tracker #1876: https://github.com/Mikecranesync/MIRA/issues/1876#issuecomment-5883965654)
- Autopatch skipped: `file_clusters` spanned 3 files (engine.py, guardrails.py, prompts/diagnose/active.yaml), which hits the one-file hard stop. 10 of the 17 failures were patchable, 7 need human review.
- Key finding: 5 citation-groundedness failures flag the same `120PSI`/`90°C` tokens. They come from the example text in the clarification template at `engine.py:4319`, not from hallucinated values. Separately, `pf523_heatsink_18` ("F41, heatsink overtemp") got a safety STOP reply, which looks like a false positive.
