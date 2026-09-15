# eval-fixer run — 2026-08-19 (charlienodes-mac-mini)

- Scorecard: 39/65 raw (60%), **gradeable 91.2%**, runtime 2788.9s, **19 timeout fixtures (all-time max)**
- Action: issue-filed (no patch — autopatch hard-stopped: 25 patchable > 15, 3 clusters)
- Filed: commented #1876 (run), #3085 (series + sized timing ask), #3290 (incidence + mechanism). No new issues.

**Read tonight by decomposition, not raw pass.** 26 failures = 19 timeout placeholders (#3085) +
7 genuine. TO=19 is the max across all 68 comparable August cards; the 7 non-timeout failures are the
second-lowest of the last 14 runs (band 6–27, mean 13.6). So this was a *good* quality night wearing a
mediocre 39/65.

**The timeout model has saturated.** `corr(TO, raw) = -0.863` across all 68 cards still holds, but the
residual is now large: non-timeout failures span 6–27 (sd 5.2 over last 14 vs 3.2 over all 68). The
within-band correlation flip (+0.186 on last 14) is *not* evidence against the mechanism — range
restriction attenuates correlation by construction — so the load-bearing claim is the residual spread.
Most of it is one card: `2026-08-18T0627` (27 non-TO failures, gradeable 86.2%, runtime 1746s vs ~2900s
norm) — short, bad, low-timeout. Anomaly to inspect directly, not a trend.

**Per-fixture timing is 3 edits, not a project.** The data is already collected and stored:
`offline_run.py:292` returns `latencies_ms`; `grader.py:434` stores `latency_ms_total` (field at `:76`);
`offline_run.py:406` drops it. Add `latency_ms_max` (grader `:76`, `:434`) + a column
(`offline_run.py:388/389/406`). **Max, not total** — the 30s-ceiling question is per-*turn*. Not
implemented here: `tests/eval/` is outside the allowed edit set and the run hard-stopped first.

**#3290 is 5× bigger than its issue body says.** `pf523_heatsink_18` carries the `STOP — describe the
hazard` escalation on **20 of 26 runs** since 08-14, not 3 nights. Mechanism is the LLM router
(`conversation_router.py:51,57` — "ANY … dangerous situations — ALWAYS route here"), reaching
`engine.py:3443` via `_router_intent`, which is why closing #1834 (a `guardrails.py` keyword-list issue)
never touched it.

**Untracked, watching:** `gs3_ground_fault_14` fails 9/26 runs — 7 retrieval miss, 2 as the #3290 safety
class. Not filed (intermittent, partly double-counted). Needs its own issue if it clears 50% incidence
with a stable retrieval-miss signature.
