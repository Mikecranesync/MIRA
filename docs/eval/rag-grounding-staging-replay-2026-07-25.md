# RAG Grounding — Targeted Staging Replay (PR #2913 / v3.213.1)

**Status: NOT YET RUN.** This is the *targeted* staging validation the review (Finding 6)
requires before deploy. The generic `staging-gate` CI (a broad conversation suite) does
**not** exercise these specific risks. Run this against **staging only** (never prod), on a
build whose deployed SHA == `origin/main` head after PR #2913 merges. Fill in the metrics
table from the run, then attach it to the PR / issue thread.

Offline coverage already proven (see PR #2913 tests): the *mechanics* — fault-code
proximity+shape gate, the min_similarity vector filter, the product-hint fallback, and the
multi-turn enrichment flow. What only staging can prove is the *numbers* on real corpus +
real embeddings.

## How to run
Drive the deployed chat path (mira-pipeline `/v1/chat/completions` or the Telegram staging
bot `@Mira_stagong_bot`) with each prompt below; capture the reply, the cited sources, and
the retrieved-chunk count from `RAG_STAGE_TIMING` / `recall_knowledge` logs. A correct
refusal for genuinely-absent content is **not** a failure — validity-check before scoring.

## A. Fault-code extraction — TRUE positives (must extract + retrieve the code's docs)
`F0004` · `fault F0004` · `drive showing F0004` · `E001` · `error E001` · `E-OC` ·
`alarm OC1` · `A501 warning`

## B. Fault-code extraction — FALSE positives (must NOT extract a code; industrial words present)
`the conveyor in bay 12 stopped` · `the drive in bay 12 stopped` · `please re-do the setup` ·
`please re-do the VFD setup` · `the OC wire goes to terminal 5` · `move the GF wire to terminal 7`
→ Expect: no fault-code stream fires; no ILIKE junk chunks; answer is a normal grounded/asking reply.

## C. Vendor-confidence (low-confidence English collisions must NOT full-suppress)
`delta pressure is high` · `AB testing procedure` · `SEW this wire label onto the cable`
→ Expect: cross-vendor suppression does **not** fire below confidence 0.7 (evidence retained).

## D. Stranger-model product rerank (model outside `_PRODUCT_NAME_RE`)
Use a staging-ingested manual whose model is not in the curated regex — e.g. **Magnetek IMPULSE /
IMPULSE G+**, **MOVITRAC / MOVIDRIVE**, or **Yaskawa GA500**. Ask a model-specific question.
→ Expect: the product-rerank stream activates via the resolved model (product_hint), not silence.

## E. Multi-turn context (the ~34% zero-chunk case)
Turn 1: `I have a Rockwell PowerFlex 525 showing F004`  Turn 2: `I haven't meggered it yet`
→ Expect: Turn 2 retrieval carries Rockwell + PowerFlex 525 + F004 and returns relevant chunks (not 0).

## F. Nemotron retry coherence
Force/allow a first-pass ungrounded result on an active session turn.
→ Expect: the rewritten query still contains the equipment context, stays a coherent question,
is not duplicated (`Rockwell PowerFlex 525 Rockwell PowerFlex 525 …`), and keeps the tech's question.

## Metrics — fill from the run
| Metric | Before (main) | After (PR #2913) | Acceptance |
|---|---|---|---|
| True-code recall (set A) | | | no regression |
| False-code extraction rate (set B) | | | **0** named adversarial false positives |
| Terse bare-code recall (`F0004` alone) | | | **≤ 5%** regression (documented trade-off) |
| Zero-chunk rate (set E, turn 2) | | | multi-turn returns >0 chunks |
| Cross-vendor full-suppression < 0.7 conf (set C) | | | **0** |
| Stranger-model product-stream activation (set D) | | | activates |
| Duplicate-context rate (set F) | | | **0** duplicated prefixes |
| Nemotron retry success (set F) | | | coherent, context-preserving |

**Acceptance to clear the gate:** 0 named adversarial false positives · ≤5% terse-code
recall regression · 0 cross-vendor full-suppression below 0.7 · 100% equipment-context
preservation in the set-E case · 0 duplicated prefixes · product stream activates for the
stranger model · all required CI green on the final reviewed head.
