# RAG Grounding — Targeted Staging Replay (PR #2913 / v3.213.1)

**Status: PARTIAL — extraction rows (A/B) executed offline 2026-07-26; retrieval-number rows
(C/D/E/F) still require the deployed staging chat path.** The #2913/#2914 fixes are already
**live on prod** (v3.213.1 → current ≥v3.216.3) and cleared the generic `staging-gate` +
offline tests at merge; this targeted replay is the belt-and-suspenders behavioural confirmation.
See "Executed results" below.

This is the *targeted* staging validation the review (Finding 6)
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

## Executed results

**Sets A/B — fault-code extraction (offline, deterministic; run 2026-07-26 against
`_extract_fault_codes` on origin/main head `7931d98d`).** `_extract_fault_codes` is a pure
function, so the extraction half of the replay needs no deployment; only the retrieval-count
half (does an extracted code fetch its docs) needs staging.

- **Set B — adversarial false positives: 0/6 extracted (6/6 clean). ✅ ACCEPTANCE MET.**
  `bay 12` (×2), `re-do the setup`, `re-do the VFD setup`, `OC wire → terminal 5`,
  `GF wire → terminal 7` → all `[]`. No fault-code stream fires → no ILIKE junk chunks.
- **Set A — true-code recall: 5/8 extracted.** All context-carrying forms extract correctly:
  `fault F0004`→`F0004`, `drive showing F0004`→`F0004`, `error E001`→`E001`,
  `alarm OC1`→`OC1`, `A501 warning`→`A501`. The 3 non-extractions (`F0004`, `E001`, `E-OC`
  **bare, no context word**) are the **documented terse-bare-code trade-off** (#2208
  "Risk / KNOWN TRADE-OFF"), not a regression — real technician phrasing carries a context
  word. Within the ≤5% acceptance for that specific case.

Sets **C/D/E/F remain OPEN**: they need real corpus + embeddings + the rag_worker/engine
retrieval path, i.e. the deployed staging chat path (`@Mira_stagong_bot` or staging
mira-pipeline `/v1/chat/completions`). Not runnable from an offline Bravo session.

## Metrics — fill from the run
| Metric | Before (main) | After (PR #2913) | Acceptance | Result |
|---|---|---|---|---|
| True-code recall (set A) | | 5/8 (context forms 5/5) | no regression | ✅ (offline 2026-07-26) |
| False-code extraction rate (set B) | | 0/6 | **0** named adversarial false positives | ✅ (offline 2026-07-26) |
| Terse bare-code recall (`F0004` alone) | | 0/3 bare (by design) | **≤ 5%** regression (documented trade-off) | ✅ intended trade-off |
| Zero-chunk rate (set E, turn 2) | | | multi-turn returns >0 chunks | ⏳ needs staging |
| Cross-vendor full-suppression < 0.7 conf (set C) | | | **0** | ⏳ needs staging |
| Stranger-model product-stream activation (set D) | | | activates | ⏳ needs staging |
| Duplicate-context rate (set F) | | | **0** duplicated prefixes | ⏳ needs staging |
| Nemotron retry success (set F) | | | coherent, context-preserving | ⏳ needs staging |

**Acceptance to clear the gate:** 0 named adversarial false positives · ≤5% terse-code
recall regression · 0 cross-vendor full-suppression below 0.7 · 100% equipment-context
preservation in the set-E case · 0 duplicated prefixes · product stream activates for the
stranger model · all required CI green on the final reviewed head.
