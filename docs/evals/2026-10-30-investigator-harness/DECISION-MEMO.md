# Decision memo — Maintenance Investigator research mission (2026-10-30)

Evidence: `RESULTS.md` (same folder). Nothing here is production- or pilot-ready; all results are offline, on sealed sets, run once.

## Keep / reject / investigate
| item | verdict | why (numbers in RESULTS.md) |
|---|---|---|
| Investigator harness (read-only, hazard gate first, deterministic post-checks) | **INVESTIGATE NEXT** (keep the prototype) | Removes ungrounded numbers reaching a technician (14/64 → 0), 0 critical unsafe guidance on the sealed safety cases, no fault/parameter regression, ~2 s, ~$0.003/case. But it is over-cautious: asks instead of answering on ~75–80% of forum posts and on 8–11 of 17 scenarios where a next check was right. Whether those questions are the *right* move is unlabelled (human sheet pending). |
| Bounded second evidence round (research question 4) | **INVESTIGATE** — not shown | Sealed forum: same evidence recall as one round (38 vs 38). Scenarios: 18 vs 16 right mode, 9 vs 6 next checks given — inside the noise at n = 33. The DEV gain (+9 pages) did not transfer. |
| Insufficient-evidence recognition (research question 5) | **KEEP** | 9/9 (H1), 8/9 (H2) on sealed scenarios (target ≥ 90%). |
| Query rewrite (B1) | **KEEP as the candidate retrieval change** | +6/64 on the sealed forum set; non-negative on codes in #4983's post-hoc arm. Still far from the T-1 bar. |
| Prefixed-nomic fusion (B2) and exact-code-first hybrid (B4) | **REJECT** | Lose 13 fault-code questions; "codes first" does not protect codes. |
| Cross-encoder re-ranker (B3) | **BLOCKED** | Too slow on CHARLIE's ARM VM (2–6 s vs the Hub's 5 s ceiling); measure on x86. |
| T-1 gate via retrieval alone | **Not reachable** | Best sealed arm 38/64 (LB 47%); taxonomy ceiling with a perfect re-ranker is LB 59%. |

## Smallest justified next step
1. **Human labels** on a 30-case slice of `MIKE-label-sheet.html` (all 7 hazard cases + 23 sampled), so "technically valid next check" has a
   human number instead of a model's opinion.
2. On DEV only: tune the synthesis step to commit to a next check when the cited evidence covers the question (the over-caution), then
   collect a fresh sealed set and run once — the current sealed sets are now spent.
3. Hazard asks: when the gate does not fire but the model declines, render an explicit stop line (H0's "No — …" pattern) instead of a question.

## Not done / blockers
- Equipment history and live data: no read path offline — every trace records `unavailable`.
- B3/B5/B6 retrieval arms (see above). Supervisor-role workflows (research question 6): not built.
- Safety gap found in production code (report only, not changed): notebook chat `route.ts:2100` returns the identity 422 before the
  energized-work stop when no phrase trigger fires (`inventory/safety.md` §3). The investigator runs its hazard gate first and does not
  have this gap.
