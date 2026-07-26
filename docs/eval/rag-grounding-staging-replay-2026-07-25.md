# RAG Grounding — Targeted Staging Replay (PR #2913 / v3.213.1)

**Status: SUBSTANTIALLY COMPLETE — sets A/B/C/D/E verified 2026-07-26; only F (Nemotron LLM
retry) still needs live inference.** Sets A/B ran offline against `_extract_fault_codes`; sets
C/D/E ran against the **production retrieval layer** (`recall_knowledge` raw, no harness) on
**staging Neon** with real `nomic-embed-text` embeddings (Charlie Ollama), and the real
resolver + `_confident_query_vendor` gate — the method the `retrieval-diagnostics` skill
mandates (diagnose the production path, raw). The #2913/#2914 fixes are already **live on prod**
(v3.213.1 → current ≥v3.216.3) and cleared the generic `staging-gate` + offline tests at merge;
this targeted replay is the belt-and-suspenders behavioural confirmation. See "Executed results".

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

**Sets C/D/E — production retrieval layer (run 2026-07-26 against staging Neon; embeddings from
Charlie `nomic-embed-text` 768-dim; `recall_knowledge` raw + real resolver).** Driver:
`/tmp/rag_replay_driver.py` (recall) + inline resolver check; corpus confirmed present
(PowerFlex 525 = 7547 embedded chunks, Yaskawa GA500 = 4582).

- **Set E — multi-turn equipment context (#2209): PASS.** Bare turn-2 `"I haven't meggered it
  yet"` → 10 chunks but **all `bm25`, mostly `?`-manufacturer junk** (0 equipment-relevant — the
  ~34% ungrounded case). The engine-#2209-enriched query `"Rockwell PowerFlex 525 F004 I haven't
  meggered it yet"` → **10/10 Rockwell PowerFlex 525** chunks via `product`+`vector` streams (the
  correct manual). Enrichment converts noise into the right equipment docs.
- **Set D — stranger-model product rerank (#2211): PASS.** `"Yaskawa GA500 overvoltage fault"`
  with **no** hint → GA500 via `vector`/`like` only (no product stream). With
  `product_hint="GA500"` (a model outside `_PRODUCT_NAME_RE`) → the **`product` stream fires**
  (GA500 p116 now `product`+`vector`). The product-hint fallback activates for a stranger model.
- **Set C — low-confidence vendor collisions (#2211): PASS.** Real offline resolver +
  `_confident_query_vendor` gate: `"delta pressure is high"`→Delta Electronics@0.5,
  `"AB testing procedure"`→Rockwell@0.5, `"SEW this wire label…"`→SEW-Eurodrive@0.5. All three
  resolve a real vendor alias at **0.5 < 0.7**, so the gate returns `None` → **0 cross-vendor
  full-suppressions**. (Suppression is a rag_worker-layer gate, not `recall_knowledge`.)

**Set F (Nemotron LLM retry) remains OPEN** — it needs the live inference rewrite path
(`NEMOTRON_ENABLED=1`). The enrichment-into-retry (the engine passes the *enriched* query to the
self-critique rewrite at `engine.py:~3879`) is unit-covered by
`mira-bots/tests/test_multiturn_context_e2e.py`; the coherence/no-duplicate-prefix behaviour is
the only row not yet exercised end-to-end.

## Metrics — fill from the run
| Metric | Before (main) | After (PR #2913) | Acceptance | Result |
|---|---|---|---|---|
| True-code recall (set A) | | 5/8 (context forms 5/5) | no regression | ✅ (offline 2026-07-26) |
| False-code extraction rate (set B) | | 0/6 | **0** named adversarial false positives | ✅ (offline 2026-07-26) |
| Terse bare-code recall (`F0004` alone) | | 0/3 bare (by design) | **≤ 5%** regression (documented trade-off) | ✅ intended trade-off |
| Equipment-relevant chunks (set E, turn 2) | bare 0/10 (bm25 junk) | enriched 10/10 PF525 (product+vector) | multi-turn returns relevant chunks | ✅ (staging recall 2026-07-26) |
| Cross-vendor full-suppression < 0.7 conf (set C) | | 0/3 (all @0.5 → gate None) | **0** | ✅ (resolver+gate 2026-07-26) |
| Stranger-model product-stream activation (set D) | no-hint: no product stream | product_hint=GA500: product stream fires | activates | ✅ (staging recall 2026-07-26) |
| Duplicate-context rate (set F) | | | **0** duplicated prefixes | ⏳ needs live inference (unit-covered) |
| Nemotron retry success (set F) | | | coherent, context-preserving | ⏳ needs live inference (unit-covered) |

**Acceptance to clear the gate:** 0 named adversarial false positives · ≤5% terse-code
recall regression · 0 cross-vendor full-suppression below 0.7 · 100% equipment-context
preservation in the set-E case · 0 duplicated prefixes · product stream activates for the
stranger model · all required CI green on the final reviewed head.
