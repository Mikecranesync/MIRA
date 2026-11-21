# Safety architecture research, 2026-10-29 (BRAVO)

Supporting evidence for the design doc https://claude.ai/artifact/A6r1rjru2r2oTJAaVeRnsR (#4372 comment 6494736842).

| File | What |
|---|---|
| 01-current-architecture-map.md | file:line map of the answer-safety stack at main a051e322b, #4931 2c3f67181, #4929 983b93694 |
| 02-codex-bypass-catalogue.md (+ .data.json) | 223 Codex findings, 124 rounds, 19 PRs, classified by root cause |
| 03-standards-and-invariants.md | OSHA 1910.147, 1910.333 and 1910.212; NFPA 70E (secondary sources, clause numbers unverified); vendor discharge facts; candidate invariants |
| 04-guardrails-and-oss.md | OWASP LLM guidance, guardrail and OSS components, licence verdicts |
| probe/*.ts.txt | the indicative unseen-wording probe (authored by the implementer, so **not** a sealed set) |

**Caveats**
- These reports were written by research agents. The design doc lists which claims were re-verified: OSHA text against eCFR as of 2026-10-27, the GS10 manual, the judge's fail-open behaviour and the 10-14 decision.
- Correction to 04: the existing judge does **not** fail closed. `route.ts` serves the answer on an unknown verdict.
- The sealed evaluation set is deliberately **not** stored in this repository.
