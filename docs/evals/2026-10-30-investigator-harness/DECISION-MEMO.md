# Decision memo — Maintenance Investigator research mission (2026-10-30)

Evidence: `RESULTS.md` (same folder). Nothing here is production- or pilot-ready; all results are offline, on sealed sets, run once.
"Baseline" below means the single-pass baseline as built in this study (H0), not the production chat route (RESULTS §3 lists the gap).

## Keep / reject / investigate
| item | verdict | why (numbers in RESULTS.md) |
|---|---|---|
| Investigator harness (read-only, hazard gate first, deterministic post-checks) | **INVESTIGATE — not better than the baseline yet** | Ties the baseline on evidence (forum: right page read 38 vs 37, cited 32–33 vs 33), no fault/parameter regression, 0 critical unsafe on the 7 sealed hazard asks (so did the baseline), ~2 s, ~$0.003/case, and it recognises missing information (9/9). But it is over-cautious: asks instead of answering on 48–52 of 64 forum posts and 8–11 of 17 scenarios where a next check was right. Its number check produced false positives that caused 7 of those downgrades. |
| Bounded second evidence round (research question 4) | **INVESTIGATE — not shown** | Sealed forum: same evidence recall as one round (38 vs 38). Scenarios: 18 vs 16 right mode, 9 vs 6 next checks given — inside the noise at n = 33. The DEV gain (+9 pages) did not transfer. |
| Insufficient-evidence recognition (research question 5) | **KEEP** | 9/9 (H1), 8/9 (H2) on sealed scenarios (target ≥ 90%). |
| Deterministic number-grounding check | **FIX before any further run** | 0 of 14 baseline flags and 7 of 8 investigator flags were not real: product/catalog names, numbers quoted from the question, citation markers. |
| Query rewrite (B1) | **KEEP as the candidate retrieval change** | +6/64 on the sealed forum set; non-negative on codes in #4983's post-hoc arm. Still far from the T-1 bar. |
| Prefixed-nomic fusion (B2) and exact-code-first hybrid (B4) | **REJECT** | Lose 13 fault-code questions; "codes first" does not protect codes. |
| Cross-encoder re-ranker (B3) | **BLOCKED** | Too slow on CHARLIE's ARM VM (2–6 s vs the Hub's 5 s ceiling); measure on x86. |
| T-1 gate via retrieval alone | **Not reachable** | Best sealed arm 38/64 (LB 47%; the gate needs 52/64); taxonomy ceiling with a perfect re-ranker is LB 59%. |

## Smallest justified next step
1. **Human labels** on a 30-case slice (all 7 hazard asks + 23 by sha256 order, all three answers in the same plain-prose shape), so
   "technically valid next check" has a human number instead of a model's opinion.
2. On DEV only: (a) make the number check ignore numbers that appear in the question, catalog/model identifiers and citation markers;
   (b) tune synthesis to commit to a next check when cited evidence covers the question; (c) when a hazard ask gets past the gate and the
   model declines, render an explicit "No —" stop line instead of a question. Then collect a fresh sealed set and run once — the current
   sealed sets are spent.

## Not done / blockers
- Equipment history and live data: no read path offline — every trace records `unavailable`.
- B3/B5/B6 retrieval arms (see above). Supervisor-role workflows (research question 6): not built.
- Safety gap found in production code (report only, not changed): notebook chat `route.ts:2100` returns the identity 422 before the
  energized-work stop when no phrase trigger fires (`inventory/safety.md` §3). The investigator runs its hazard gate first and does not
  have this gap.
