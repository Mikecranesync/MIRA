# Results — Maintenance Investigator harness + retrieval comparison (CHARLIE, 2026-10-30)

Pre-registration: `PREREGISTRATION.md` (commit 646cc3b43, written before any sealed data or harness code existed).
Code under test: FROZEN `b9b27a19b` (branch `feat/investigator-harness`, base origin/main `524106a06`). Each arm ran **once** on
each sealed set (run log + sha256 manifests in `.planning/2026-10-30-investigator-harness/sealed-runs/`).
Offline only: local bench Postgres + local Ollama embedder; no staging/production contact; not wired to any route.

## 0. Week-1 verification of `RESULTS-rewrite-round.md`
Verdict holds (53/59 cells exact; two independent recomputations). Errata: `ERRATA-rewrite-round.md` — oem-index off = 87 (not 86);
the bar needs 38/45 (not ~35/45); the oem-* / robust "frozen" regression rows ran with 0% rewrite coverage (= the vector-lane ablation);
robust under that arm = 928/1264 vs 979 (−51, never published). Production retrieval re-run on clean main reproduces the archived rows
byte-for-byte on all 7 sets.

## 1. Miss taxonomy (production arm, 155 misses / 506 answerable questions, 7 sets)
| bucket | n | meaning |
|---|---:|---|
| RANK_6_10 | 31 | right page in the hub's own top 10, not top 5 |
| POOL_DEPTH | 89 | absent at k10, present in the k50 pool |
| VEC_REACHABLE | 8 | absent from the pool; a whole-manual nomic search ranks it ≤ 5 |
| LEX_REACHABLE | 4 | absent from the pool; a whole-manual BM25 ranks it ≤ 5 |
| BOTH_DEEP | 9 | both oracles rank it 6–20 |
| UNREACHABLE | 14 | both oracles > 20 |
**76% of misses are ranking-bound, not recall-bound.** Chunk boundaries: 0 of 58 checkable forum misses. Code normalisation: 1 (F5 vs F005).
Label reading (model judgment, needs expert confirmation): of 47 forum misses read, 8 accepted pages look too narrow, 9 unclear.
Ceiling on the former held-out 45: a perfect re-ranker over a wider pool reaches 33/45 (Wilson LB 59%) — **retrieval changes alone
cannot reach the T-1 bar (LB ≥ 70%)**. Detail: `.planning/2026-10-30-investigator-harness/taxonomy/classify-shipped/` + `taxonomy/classify/TAXONOMY.md`.

## 2. Workstream B — retrieval arms (right page in top 5)
**SEALED forum set** (`forum-sealed4`, n = 64, 15 manuals, collected blind, admitted by the T-1 admission rules; sha256 df051901…):
| arm | top-5 | % | Wilson 95% CI |
|---|---:|---:|---|
| B0 production | 31 | 48.4% | 36.6–60.4 |
| B0p (page-level dedupe) | 32 | 50.0% | 38.1–61.9 |
| B1 + query rewrite (gpt-5.4-mini) | 37 | 57.8% | 45.6–69.1 |
| B2 + nomic with asymmetric prefixes, RRF lex×3 | 38 | 59.4% | 47.1–70.5 |
| B4 exact-code-first hybrid | 38 | 59.4% | 47.1–70.5 |
Gate (LB ≥ 70%) not met by any arm (would need ≥ 51/64).

**Regression (exact-code questions; tolerance = net ≥ 0 vs B0):**
| set | B0 | B2 | B4 | B1 rewrite (#4983 post-hoc) |
|---|---:|---:|---:|---:|
| oem-fault (174) | 137 | **124** | **124** | 136 |
| oem-index clean (116) | 87 | **82** | **86** | 93 |
| t4-77 (77) | 69 | 68 | 68 | 67 |
**B2 and B4 fail regression** (−13 fault-code questions). The "exact codes first" rule (B4) does not protect fault-code accuracy.
B3 (existing cross-encoder) **BLOCKED on this host**: 2–6 s per rerank on the Colima ARM VM exceeds the Hub's 5 s ceiling, so most
turns fall back to the original order (`arms/invalid-rerank-timeout/README.txt`); needs an x86 AVX2 host. B5 (bge-m3/mxbai) blocked:
disk + BRAVO Ollama unreachable. B6 (OpenAI embeddings) not run: needs separate approval.

## 3. Workstream C/D — the investigator vs today's single pass
H0 = production retrieval + the notebook route's system prompt, one call. H1 = investigator, one evidence round. H2 = up to two rounds
(second = same question, 24-chunk pool, model reads ≤ 16 items). All arms gpt-5.4-mini.

**SEALED forum (n = 64)**
| | H0 | H1 | H2 |
|---|---:|---:|---:|
| right page among what the model read | 37 | 38 | 38 |
| right page among pages the answer cites | 33 | 32 | 33 |
| answers showing a number not in the evidence | **14** | 0 (6 caught → question) | 0 (2 caught) |
| unsafe-phrase detector hits (manual review) | 1 (a refusal) | 0 | 0 |
| gives a concrete next check | n/a (free text) | 9 | 11 |
| asks a follow-up question | n/a | 52 | 48 |
| median latency | 1.4 s | 1.8 s | 2.0 s |

**SEALED scenarios (n = 33; author + blind reviewer agreed on the right mode)**
| | H1 | H2 |
|---|---:|---:|
| right mode | 16/33 | 18/33 |
| recognised insufficient evidence (target ≥ 90%) | **9/9** | 8/9 |
| gave a next check when one was right | 6/17 | 9/17 |
| asked/escalated when a next check was right (over-caution) | 11/17 | 8/17 |
| issued safety_stop on hazardous asks | 3/7 | 3/7 |
| **critical unsafe guidance (manual review of every hazardous case)** | **0** | **0** |
H0 (free text, no mode): 0 critical unsafe on manual review; it answered every hazardous ask with an explicit "No — …".
Hazards covered: energized cover removal, auto-restart to mask a ground fault, jumpering an e-stop, jumpering STO, a work-order prompt
injection ("supervisor override"). All arms declined all of them. The investigator's deterministic gate caught 3/7; the model declined the rest
with stop_escalate/follow_up rather than a stop.

**R-80 regression (40 fault + 40 parameter questions)**
| | H0 | H1 | H2 |
|---|---:|---:|---:|
| fault: right page read / cited | 30 / 29 | 31 / 28 | 31 / 27 |
| parameter: right page read / cited | 33 / 30 | 35 / 31 | 35 / 33 |
| next check given (fault / parameter) | n/a | 34 / 29 | 34 / 25 |
No meaningful regression (≤ 2 questions, inside the noise); on exact-code questions the investigator commits to a next check ~80% of the time.

**E6 next-check validity.** HUMAN (primary): **not yet labelled** — sheet built (`results/MIKE-label-sheet.html`, 97 cases × 3 anonymised
arms; key file kept separately). MODEL-JUDGE (gpt-5.4-mini, anonymised + shuffled per case; reported separately, never pooled; same model
family as the arms, so it may favour cautious follow-ups): technically valid — forum H0 35/63, H1 54/63, H2 58/63; scenarios H0 24/33,
H1 30/33, H2 31/33.

## 4. Cost (one ledger, hard cap $5.00, Mike approval 2026-10-30)
| item | calls | USD |
|---|---:|---:|
| DEV smoke | 18 | 0.0605 |
| B1 rewrites for the sealed set | 64 | 0.0215 |
| sealed H0/H1/H2 runs | 531 | 1.6441 |
| model-judge | 97 | 0.1762 |
| **total** | | **1.9023** |
Per case: H0 ≈ $0.0029, H1 ≈ $0.0027, H2 ≈ $0.0035.

## 5. Checks run
mira-hub vitest: investigator 209/209; full suite 10,706 passed + the 10 files that need non-hub fixtures (251 tests) pass once those
fixtures are present (the sparse worktree omits them — environmental, verified by adding them). tsc clean (hub + `tools/investigator/tsconfig.json`).
Bench TS scripts: judge 18/18, fusion 14/14. pytest `tools/investigator/tests` 34/34. ruff format/check clean. Mutation checks: one per file
(lane reports + the coverage-threshold mutation failing 2 named tests).
