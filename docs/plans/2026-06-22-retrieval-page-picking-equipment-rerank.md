# Plan — Fix retrieval page-picking: equipment-aware reranking in production

**Date:** 2026-06-22
**Branch:** `feat/retrieval-equipment-rerank-plan`
**Affects:** `mira-bots/shared/neon_recall.py`, `tests/mira_bench.py`, `mira-bots/shared/workers/rag_worker.py`
**Related:** `docs/specs/agentic-rag-upgrade-spec.md` (DRAFT), `.claude/skills/retrieval-diagnostics`,
PRs #2083 (cross-vendor false-drop), #2085 (NULL-embedding), #2178/#2190 (tenant visibility)

## Problem — VERIFIED on the production path (not assumed)

This session ran the real retriever raw (`recall_knowledge`, the path Telegram / Slack /
mira-pipeline / Hub use) against staging via `tools/seeds/oem-manuals/recall_probe.py`. Findings:

- **Retrieval is vendor/equipment-BLIND.** Query "GS10 overcurrent fault during acceleration" →
  #1 result **Yaskawa V1000**, GS10 only #2. "Micro820 Modbus" surfaces SINAMICS/PowerFlex above
  Micro820. The correct-vendor chunks are usually *retrieved* but *out-ranked* by wrong-vendor
  chunks that match the topic ("overcurrent", "Modbus").
- **Mechanism:** `_merge_results` fuses streams with **RRF** (`1/(RRF_K+rank)`, summed) — correct
  for topic relevance, but it has **no equipment/vendor signal**. A wrong-vendor chunk that ranks
  high in vector *and* BM25 beats a right-vendor chunk strong in only one stream.
- **The fix already exists — but only in the test harness.** `tests/mira_bench.py:_rerank_for_equipment`
  (line 253; comment line 125: "keep PowerFlex chunks out of a GS10 answer") overfetches candidates
  and boosts those whose manufacturer/model matches the query's equipment. It is **harness-only** —
  production `recall_knowledge` never reranks, so every real surface ships vendor-confused results.
- **Bench impact** (`docs/evaluations/runs/2026-06-17-bot-bench-postfix`): avg chunk relevance
  **0.62**; per-question 0.4 (Q01), 0.2 (Q04), 0.0 (Q06/Q07); MIRA grounded scores *worse* than the
  ungrounded LLM on completeness (−0.6) and usefulness (−0.7) — bad chunks constrain answers — while
  winning citation_quality (+2.1). Even with the harness rerank applied, relevance is only 0.62.

### Failure buckets (from raw prod probe + bench)
- **A — vendor/equipment-blind ranking (DOMINANT, fixable now).** Right chunk retrieved, mis-ranked
  below wrong-vendor. Q01/Q04, the GS10/Micro820 probes. → port the equipment rerank to prod.
- **B — content-thin for some asks (smaller).** Q07 "VFD-PLC wiring safety", Q06 "Micro820 in CCW"
  partial — the corpus has little for the exact ask. → self-eval honest-refusal and/or targeted load.
- **C — cosmetic.** The displayed `similarity` field mixes cosine (≤1) with raw stream scores
  (saw 3.6–6.3) and a flat 0.5 for ILIKE; ranking uses `rrf_score` (fine), but the field misleads
  logs/diagnostics. → normalize the display field (observability only).

## Relationship to `agentic-rag-upgrade-spec.md` (don't duplicate)

That DRAFT proposes three behaviors over the same files: **decompose** (C1), **hybrid BM25+RRF**
(C2 — already shipped: `_recall_bm25` + RRF in `_merge_results`), **self-evaluate** (C3). It does
**not** include equipment-scope reranking. This plan is the **narrower, prerequisite fix** the spec
missed and the dominant bucket needs: make production retrieval equipment-aware. Bucket B maps to the
spec's C3 (self-eval / honest refusal) and is sequenced after. This plan **extends**, not replaces,
that spec; update the spec's §2 to reference equipment rerank as shipped once Phase 4 lands.

## Phases

### Phase 0 — Reproduce on the production path  ✅ DONE (this session)
Raw `recall_knowledge` confirms vendor-blind ranking (evidence above). `recall_probe.py` is the
repeatable tool. Gate passed — the mechanism is confirmed, not assumed.

### Phase 1 — Port equipment rerank into production `recall_knowledge` (behind a flag)
- New `_rerank_for_equipment(rows, query_text)` in `neon_recall.py`, modeled on the harness version.
  Extract equipment from `query_text` (reuse `_extract_product_names` + `_extract_fault_codes`);
  overfetch (fetch `limit * OVERFETCH`, default 3–5×), then **boost** rows whose
  `manufacturer`/`model_number` match the query equipment and **demote** cross-vendor rows; keep RRF
  order as the tiebreak within a tier. Pure post-merge reorder — does not touch the streams or RRF.
- Gate behind `MIRA_EQUIPMENT_RERANK` (default off → on after staging gate). No equipment tag in the
  query ⇒ no-op (safe).
- **Gate:** unit-level — given mixed-vendor candidates + a "GS10" query, GS10 rows sort to the top.

### Phase 2 — Validate raw on the production path
- Re-run `recall_probe.py` against staging with the flag on. **Gate:** "GS10 overcurrent" → a
  GS10/AutomationDirect chunk at #1 (not V1000); "Micro820 …" → Micro820 at #1. No wrong-vendor #1
  on the probe set.

### Phase 3 — Bench gate (the measured proof)
- Run `tests/mira_bench.py` with prod rerank ON and the **harness rerank removed** (avoid
  double-rerank — `_rerank_for_equipment` moves from harness to prod; the harness then measures the
  real path). **Gate:** avg relevance ↑ (target ≥0.80), Q01/Q04 recover, Q02/Q03/Q05/Q08 no
  regression, grounded ≥ ungrounded on completeness + usefulness. Record before/after per the
  multi-cause perf discipline.

### Phase 4 — Ship
- Flag default-on after the staging gate; deploy the engine (`mira-bots`) via the normal gate
  (`smoke-test.yml` + eval regime). Verify on a real surface (Telegram or `mira-pipeline` chat) that
  a GS10 question cites GS10, not a foreign drive. Version-bump per the engine cadence. Update
  `agentic-rag-upgrade-spec.md` §2 to mark equipment rerank shipped.

### Phase 5 — Bucket B (content-thin) + self-eval
- For 0.0-coverage asks (Q07 safety, Q06 CCW): decide per-item load (targeted curated chunks, the
  proven `apply_oem_seed.py` path) vs. the spec's C3 self-eval → honest "insufficient documentation"
  refusal instead of a confident wrong answer. Re-run the bench. This is where the agentic-rag spec's
  C3 gets picked up.

## Risks / watch-outs
- **Double-rerank:** if the harness keeps its own rerank while prod gains one, the bench measures a
  fantasy. Phase 3 explicitly removes the harness copy.
- **MIN_SIMILARITY (0.70) interplay:** the cosine gate runs pre-merge on the vector stream; the
  rerank is post-merge — confirm the gate doesn't drop the right-vendor chunk before rerank can boost
  it (the #2085 NULL-embedding lesson: verify the chunk is even in the candidate set first).
- **Equipment extraction misses:** if `_extract_product_names` doesn't catch the model, rerank
  no-ops — acceptable (degrades to today's behavior), but log it.
- **Two retrieval paths:** this fixes the Python `recall_knowledge` path. The Hub TS BM25 path
  (`manual-rag.ts`) is separate and equipment-blind too — note as a follow-up, out of scope here.

## Method discipline
- Diagnose on the production function raw, never through the harness wrapper (retrieval-diagnostics
  skill). Verify each gate with evidence before the next phase. Staging before prod. Commit per phase.

## Progress
- **Phase 0: DONE** — vendor-blind ranking reproduced on raw `recall_knowledge` (staging). Tools:
  `recall_probe.py`, `vector_battery_scoped.py`, `coverage_check.py`.
- **Phase 1: DONE** — `_rerank_for_equipment` + `_equipment_tokens` + `_EQUIPMENT_ALIASES` added to
  `neon_recall.py`; wired into `recall_knowledge` behind `MIRA_EQUIPMENT_RERANK` (default off) with
  `EQUIPMENT_RERANK_OVERFETCH` (default 4): overfetch streams → RRF → equipment rerank → truncate to
  `limit`. Positive-boost only (no harness `v1000/powerflex` denylist — a real PowerFlex/V1000
  question still returns that vendor). Disabled ⇒ exact prior behavior (eff_limit==limit, slice
  no-op). Unit gate: `tests/regime2_rag/test_equipment_rerank.py` 5/5 pass. Known limit:
  `_extract_product_names` regex doesn't recognize `V1000` → no-op for that query (documented
  acceptable degradation; extraction is a separate concern).
- **Phase 2: DONE (PASS).** Re-ran `recall_probe.py` raw on staging with `MIRA_EQUIPMENT_RERANK=1`.
  Vendor confusion eliminated for all 4 equipment-specific probes: "GS10 overcurrent" → all 5 hits
  AutomationDirect GS10 (was Yaskawa V1000 #1); GS11/Micro820 Modbus → all GS11; RS-485 wiring → all
  GS10 incl. the exact Micro820↔GS10 wiring chunk; Micro820 CCW → all Micro820 incl. the exact CCW
  serial-config chunk. Q07 (generic "VFD-PLC safety", no equipment in query) correctly NOT forced to
  a vendor — that's bucket B (Phase 5). Cosmetic `similarity` display still mixes scales (bucket C).
  Charlie restored to committed `neon_recall.py` after the test (scp was test-only).
- Phases 3–5: pending. Phase 3 = bench gate (run with flag on + harness rerank removed).
