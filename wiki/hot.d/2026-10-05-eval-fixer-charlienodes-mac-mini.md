# eval-fixer run — 2026-10-05 (charlienodes-mac-mini)

- Scorecard: 54/65 passing (83%), `tests/eval/runs/2026-10-05T0323-offline-text.md`
- Action: issue-filed (commented on the rolling tracker #1876: https://github.com/Mikecranesync/MIRA/issues/1876#issuecomment-5988421050)
- Autopatch skipped because of the hard stop: 3 file clusters (engine.py, guardrails.py, active.yaml). The measured tree is still the stale shared checkout `34f8c42c4`, now 212 commits behind `origin/main` (#2952 is still open). The same 4 fixtures failed in 12 of the last 12 cards, and the last 12 cards sit in the 48–58 noise band. New finding: `cp_citation_groundedness` flags numbers that echo the technician's own turn (`230V` in `pf40_undervoltage_21`), which is the same family as #3675.
