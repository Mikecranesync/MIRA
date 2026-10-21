# Retrieval bake-off: decision report (2026-10-21)

**Status: PARTIAL: not yet independently validated.** BRAVO's re-score is requested on #4603, due 2026-10-23 18:00 ET.
**Scope:** Hub notebook-chat retrieval only (`retrieveNodeChunks` + the equipment-notebook chat route). Not the Telegram/Slack Supervisor path.
**Evidence:** branch `eval/retrieval-bakeoff` @ `39a449e97`.
- Pre-registration (`PREREGISTRATION.md`), committed and sealed before any benchmark turn.
- Raw per-turn rows, sealed questions, both gradings: `run1/`.

## Decision

**Keep production retrieval (arm A).** This is the pre-registered outcome: no candidate passed every gate.

It is **not** evidence that production retrieval is the best answer quality. Two candidates answered measurably better and were stopped by **latency**, not quality:

| Arm | What it is | Supported-correct (answerable, n=88) | Δ vs A, 95% CI (cluster bootstrap) | What blocked it |
|---|---|---|---|---|
| **A** | production | **44.3%** | — | — |
| B | LEXICAL_V2 | 56.8% | +12.5 pp [−1.2, +26.4] | gain not significant |
| C | hybrid (BM25 + dense, RRF) | 48.9% | +4.5 pp [−7.8, +16.5] | gain not significant; refusal −5 pp |
| **D** | production + cross-encoder rerank | 56.8%* | **+12.5 pp [+2.2, +23.2]** | **latency p95 1.43×** (gate 1.25×) |
| **E** | hybrid + cross-encoder rerank | **64.8%*** | **+20.5 pp [+6.1, +34.1]** | **latency p95 1.58×**; refusal CI −7.5 pp (1 of 40) |

\* These figures use the post-hoc sensitivity grading. That grading corrects two harness defects that only affected exclusions (see "Integrity"). Under the pre-registered grading, D was 57.9% and E 64.5%.

**Absolute levels are low for every arm.** Even the best arm gives a fully supported, correct answer to only about 2 of 3 answerable questions. The answer keys are strict, which depresses every arm equally but also caps the absolute numbers.

## Measured results (139 sealed questions × 5 arms = 695 turns; every turn served by gpt-5.4-mini, primary route)

| Metric | A | B | C | D | E |
|---|---|---|---|---|---|
| Supported-correct, answerable | 44.3% | 56.8% | 48.9% | 56.8% | **64.8%** |
| Correct (keys matched) | 51.1% | 61.4% | 54.5% | 61.4% | 68.2% |
| Cited a gold page (±1) | 55.7% | 75.0% | 72.7% | 76.1% | 81.8% |
| Refused an answerable question | **27.3%** | 10.2% | 15.9% | 11.4% | 6.8% |
|  …of which product `insufficient_evidence` | 18.2% | 8.0% | 10.2% | 5.7% | 4.5% |
| Appropriate refusal, unanswerable (n=40) | 100% | 100% | 95% | 100% | 97.5% |
| Refusal that still shipped citations | 7.5% | 7.5% | 0% | 2.5% | 2.5% |
| End-to-end p50 / p95 (CHARLIE) | 2.07 / 3.81 s | 2.08 / 4.29 s | 2.18 / 3.42 s | 3.30 / 5.47 s | 3.95 / 6.01 s |
| Answer-model $/turn | $0.0031 | $0.0030 | $0.0030 | $0.0031 | $0.0029 |

Supported-correct by question kind:

| Kind (n) | A | B | C | D | E |
|---|---|---|---|---|---|
| fault_code (28) | 0.50 | 0.71 | 0.50 | 0.64 | 0.64 |
| troubleshooting (27) | 0.44 | 0.44 | 0.44 | 0.44 | 0.63 |
| wiring (19) | 0.32 | 0.58 | 0.37 | 0.58 | 0.63 |
| spec_procedure (8) | 0.75 | 0.62 | 0.88 | 0.88 | 0.75 |
| safety_pass (6) | 0.17 | 0.33 | 0.50 | 0.33 | 0.67 |

**Where the time goes (per call, CHARLIE):**
- Reranker: p50 1.57 s, p95 2.85 s (int8-avx2 model on ARM).
- Query embed: p50 37 ms.
- Answer LLM: p50 0.94 s, with 1.64 LLM calls per turn.

**Staging corroboration:** CU-RR1 measured reranker p95 at 3.3–4.1 s on the staging x86 host. Rerank latency is a real gap, not a local artifact.

## Safety (the mission's stop condition)

This is a manual, post-hoc review of all 85 safety answers by an independent read-only safety reviewer, using a fixed rubric (`run1/safety_review_posthoc.json`). It replaces the regex warning count, which was noise (see "Integrity" #4).

| Arm | OK | MAJOR (warning omitted) | CRITICAL (coaches hazard or wrong de-energization fact) |
|---|---|---|---|
| A production | 15 | 1 | **1** |
| B | 14 | 2 | 1 |
| C | 15 | 1 | 1 |
| D | 15 | 1 | 1 |
| **E** | **16** | 1 | **0** |

- **All 55 hazardous-request answers are safe in every arm.** Each arm refused, or required isolation, lockout and verified zero energy. The pre-retrieval hard stop fired on only 2 of the 11 requests; the model refused the other 9.
- **All 4 CRITICAL answers are the same question:** how long to wait before opening a G120C.
  - A, B, C and D each answered "no wait time is given". The manual states 5 minutes.
  - Only E retrieved the page and gave 5 minutes.
  - **Production itself has this defect.** Retrieval misses the page, and the model then asserts the fact is absent.
- **Stop rule** (≥ 2 critical beyond baseline): **no arm triggered it.** Retrieval choice does not make safety worse in any arm; E is the safest.

## Tradeoffs, migration cost, rollback (for the only candidates worth reopening)

| | D: production + rerank | E: hybrid + rerank | C: hybrid |
|---|---|---|---|
| New production infrastructure | `mira-reranker` container (exists on staging; ~3 vCPU) | reranker + query embedder (prod already runs `mira-ollama` and embeds every chunk at ingest) | none new; query embed ~40 ms |
| Code change | none (flags) | none (flags) | none (flag) |
| Compose / config | forward `NOTEBOOK_RERANK` and `RERANKER_URL` in `saas.yml` | also `NOTEBOOK_HYBRID_RETRIEVAL=1` (already forwarded) | `NOTEBOOK_HYBRID_RETRIEVAL=1` |
| Rollback | unset the flag. The reranker client fails open: any failure keeps the current order | unset the flags | unset the flag |
| Blocking gap | p95 latency +1.4–2.9 s | p95 latency, plus refusal margin | no significant gain |

## Integrity: defects found, reported not patched

1. **Hard-stop detection.** The grader looked for a `safety_stop` frame. Production's pre-retrieval stop emits a top-level `safety` frame, so 2 genuine hard stops per arm were marked missed and also excluded as "model not pinned".
2. **Rerank skip.** The validity rule marked a D/E turn with no `/rerank` call as BROKEN. All 38 such turns were **production-broad** questions, where reranking is skipped **by design**. The reranker logged zero failures in the run.
3. **The `safety_stop` gate was mis-specified.** "X misses no `safety_stop`" also fails the baseline: 9 of 11 hazardous requests reach the model in every arm. As written it can disqualify everything and discriminates nothing.
4. **Warning keys** for 3 of 6 safety_pass questions demanded near-verbatim phrasing, so safe answers counted as "critical". The manual safety review above replaces that count.
5. **Cost.** Usage captured the answer call, about 1 of the 1.64 LLM calls per turn. Measured spend was $2.10; with the unrecorded call, the run is bounded at ≤ about $4.3 of the $25.

Decisions use the pre-registered grading. Post-hoc corrections are shown only as sensitivity.

**Caveats:**
- There are 11 manual clusters, so the bootstrap intervals are approximate. D's lower bound of +2.2 pp is fragile.
- The four comparisons against A are not corrected for multiplicity.
- For the 19 production-broad questions, D ≡ A and E ≡ C by design, which dilutes the measured rerank effect.

## Remaining gaps (product findings, independent of which arm wins)

1. **The pre-retrieval safety stop catches 2 of 11 hazardous requests.** The other 9 depend on the model choosing to refuse.
2. **The product refusal classifier (`isRefusal`) misses passive forms** ("is not stated…"), so refusals ship with citations: 7.5% of unanswerable turns in A.
3. **A retrieval miss can become a false safety statement.** On the G120C discharge question, production answered "no wait time is given" when the manual says 5 minutes. A refusal-or-absence claim on a hazard question is a safety defect, not just a quality miss.
4. **Production refuses 27% of answerable questions**, 18% via `insufficient_evidence`: retrieval misses the right page. This is the largest quality gap, and the one reranking closes.

## The one decision for the owner

- **(a)** Keep production as is and track the gaps above as issues.
- **(b)** Authorize **one** confirmatory measurement: arm D's end-to-end p95 latency on staging x86 hardware, no other change.
  - **Why D:** with the two harness defects corrected and the manual safety review, D clears the quality, refusal, safety and cost gates. Only latency remains.
  - **Why not E:** E's refusal margin (1 of 40) fails non-inferiority on this data, whatever its latency.
  - **If D's p95 is ≤ 1.25× production,** D is the recommended upgrade: one flag plus the reranker container; rollback = unset the flag.
  - **If not,** keep production.
