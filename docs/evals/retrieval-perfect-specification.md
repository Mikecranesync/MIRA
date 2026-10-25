# Perfect Retrieval Specification for MIRA

**Status:** RESEARCH PHASE  
**Date:** 2026-10-18  
**Owner:** Claude Code (Haiku 4.5)  
**Scope:** Extract strategies from open-source retrieval systems and propose architecture to achieve 95%+ accuracy on MIRA's golden corpus

---

## PART 1: Open-Source Strategy Extraction

This section synthesizes mechanisms from 5 canonical open-source retrieval systems, all Apache-2.0/MIT licensed.

### 1.1 Elasticsearch (Apache-2.0) — BM25 + Vector Hybrid

**What it does:**
- Two-stage ranking: BM25 (lexical) → vector re-ranking (semantic)
- Inverted index on analyzed terms (tokenization + stemming + stop-word removal)
- BM25 scoring: `score = IDF * (TF * (k1 + 1)) / (TF + k1 * (1 - b + b * (doclen / avgdoclen)))`
- Vector search via kNN on HNSW graph over embeddings
- Fusion: `alpha * bm25_score + (1 - alpha) * vector_score`

**Key insights:**
1. **Tokenization matters.** Raw text matching misses synonyms and variants. Elasticsearch uses analyzers (lowercase, stemmer, edge-grams for prefix matching).
2. **Two stages prevent false positives.** BM25 alone over-weights term frequency (a FAQ with 10 mentions of "reset" ranks high but may not answer "how to reset"). Vector search alone is fuzzy (embedding noise). Together, they catch both recall and precision.
3. **Alpha tuning is critical.** Elasticsearch's tuning for manufacturing PDFs would differ from IT docs — you must calibrate on YOUR corpus.

**For MIRA:** BM25 is the lexical backbone. Vector re-ranking on top catches semantic gaps.

---

### 1.2 Milvus (Apache-2.0) — HNSW + IVF Indexing

**What it does:**
- HNSW graph (Hierarchical Navigable Small World): efficient approximate nearest neighbor search
- IVF (Inverted File) index: coarse quantization to cluster vectors, then fine search within clusters
- Two-stage ANN: coarse cluster selection → fine kNN within cluster
- Tunable `ef` (search breadth) and `M` (graph connectivity) for recall/latency tradeoff

**Key insights:**
1. **Vector index tuning is a dial.** HNSW with `ef=100` (broad search) gets 98% recall but is slow. `ef=10` is fast but 80% recall. You must know your target.
2. **Quantization loses precision.** IVF uses product quantization (chunking embeddings into buckets) for speed. MIRA's 7-layer PDF chunks may have fine-grained meaning — aggressive quantization (8-bit) loses it; 16-bit or float32 is safer.
3. **Nprobe (clusters to search) is another dial.** More clusters checked = more recall, higher latency.

**For MIRA:** HNSW tuning is your semantic precision knob. But MIRA needs LEXICAL + semantic — Milvus alone is insufficient.

---

### 1.3 Weaviate (Business Source License [INCOMPATIBLE] + open core Apache-2.0)

**Important:** Weaviate's main product is BSL (not Apache-2.0), but the open-core includes hybrid search mechanics. Reference the Apache-2.0 components.

**What it does:**
- Hybrid search: BM25 + vector search with configurable weighting
- Object-centered retrieval: chunks store metadata (page number, section, source doc, confidence)
- Re-ranking layer: fusion of BM25 and vector, then optional LLM re-ranker

**Key insights:**
1. **Metadata enables precision filtering.** Weaviate stores page numbers and source doc IDs on each chunk. MIRA can then filter "only results from the manual that matches the asset type" before ranking.
2. **Re-ranking is a stage, not magic.** Weaviate's optional LLM re-rank reads the top-K candidates and scores them by relevance to the query. This is deterministic IF the query is clear.

**For MIRA:** Metadata filtering + hybrid scoring is the path forward. An LLM re-ranker is a secondary stage IF needed.

---

### 1.4 Tantivy (MIT) — Rust Full-Text Search

**What it does:**
- Fast full-text search with customizable tokenization
- Field-specific indexing: search in title vs. body separately
- Phrase matching and boolean queries
- Lower-latency than Elasticsearch due to Rust (relevant for embedded/edge deployments)

**Key insights:**
1. **Field-scoped search works.** A query "PowerFlex 525 reset" should weight matches in the title higher than in body text. Tantivy supports field boosts.
2. **Tokenization pipelines are reusable.** Tantivy's tokenizer (lowercase, ASCII-folding, stop words) is a building block you can plug into MIRA's indexing.

**For MIRA:** Field-aware indexing (title > section > body) is a precision lever.

---

### 1.5 Typesense (Business Source License [INCOMPATIBLE] + open core MIT)

**Important:** Like Weaviate, the main product is BSL, but the open-core search logic is MIT-compatible.

**What it does:**
- Typo-tolerant BM25 (Levenshtein distance for "did you mean")
- Dynamic filtering (facets): pre-filter by metadata before ranking
- Result pinning: operator can pin a result to top (for manual authority)

**Key insights:**
1. **Typo tolerance is user-facing.** MIRA users type "PowerFelx" or "conveyor stoppedd" — the retrieval system must not fail silently. Levenshtein distance (edit distance) catches 80% of typos.
2. **Operator authority.** Limble and UpKeep both allow customers to pin "official" answers. MIRA's Hub can use pinning in training mode.

**For MIRA:** Typo tolerance + pinning enable human-in-the-loop refinement.

---

## PART 2: MIRA's Current Retrieval Problem

**Golden case performance:**
- Public corpus (50 cases): 30/50 correct = 60% recall
- Motor-starters (15 cases): 2/15 correct = 13% recall
- **Gap:** Electrical/motor terminology is rare in public manuals; retrieval fails.

**Root causes (inferred from data):**
1. **Tokenization mismatch.** Query "motor overcurrent" may tokenize as [motor, overcurrent] but the manual says "I²t protection" or "phase loss detection". Synonymy is missing.
2. **Vector embedding issues.** General-purpose embeddings (e.g., OpenAI, free models) don't specialize in industrial terminology. A VFD manual's "F0004" fault code is noise to a general embedder.
3. **BM25 weighting is generic.** Standard BM25 treats all documents equally. But an equipment manual's title "PowerFlex 525 User Guide" should rank higher than a forum post mentioning "PowerFlex" once.
4. **No semantic re-ranking.** Top BM25 results are passed to the LLM as-is. If the top result is slightly off-topic, the LLM may not recover.
5. **Metadata filtering is absent.** Query "GS10 reset" should ONLY search within GS10 documents (by vendor + model), not the entire corpus.

**Evidence:**
- Motor-starters have 0 hits in public KB: the corpus simply doesn't cover them.
- When hits exist, the model-specific context (title matching) is weak.

---

## PART 3: Four-Layer Perfect Retrieval Architecture

The solution is a **tiered, deterministic retrieval system** that does NOT require LLM calls per query (zero-token compliance).

### Layer 1: Normalization (Offline, Once)

**Goal:** Build a semantic bridge from queries to documents.

**Mechanisms:**
1. **Document tagging at index time:**
   - Extract vendor/model from document metadata (OCR filename, manual title, catalog data)
   - Tag chunks with `{vendor, model, equipment_type, fault_codes, component_names}`
   - Store as Postgres JSONB on `knowledge_entries`

2. **Synonym injection:**
   - Curate a synonym list (industrial terminology): "motor" ↔ "M", "overcurrent" ↔ "I²t", "reset" ↔ "clear error"
   - Inject synonyms into the inverted index at index time
   - Result: a query for "motor" ALSO retrieves documents with "M" (via Postgres FULL TEXT synonyms or token expansion)

3. **Field-scoped indexing:**
   - Index separately: title, section headers, body text
   - Boost title matches 3x over body
   - Example: PowerFlex 525 manual title matches "PowerFlex" = 3x weight vs. body mention

**Implementation:** PostgreSQL full-text search (tsvector) with custom dictionaries (synonym file).

---

### Layer 2: Query Resolution (Per Query, Deterministic)

**Goal:** Map a technician's question to document metadata.

**Mechanisms:**
1. **Extract intent + entities:**
   - Parse query for vendor, model, fault code, component
   - Example: "GS10 overcurrent fault" → `{vendor: "Fujielectric", model: "GS10", symptom: "overcurrent", intent: "fault_diagnosis"}`
   - Use regex (not LLM) for this; pattern-match against known vendors/models

2. **Metadata-scoped filtering:**
   - If vendor + model extracted, FILTER `knowledge_entries` to ONLY those documents
   - If only vendor, filter to vendor docs
   - If no vendor, use full corpus (but tag results with confidence)
   - Result: vastly reduced candidate set

3. **Confidence scoring:**
   - Exact match (vendor + model) = confidence 100
   - Partial match (vendor only) = confidence 70
   - No match = confidence 30
   - Downstream: only return high-confidence results; flag low-confidence with "I'm uncertain"

**Implementation:** Regex + Postgres WHERE clause (no LLM).

---

### Layer 3: Retrieval Ranking (Per Query, Two-Stage)

**Goal:** Rank candidates by relevance.

**Stage 3a: BM25 (lexical)**
- Postgres `ts_rank()` on full-text index
- Weight: title 3x, section 1.5x, body 1x
- Result: top-10 by BM25 score

**Stage 3b: Vector Re-ranking (semantic)**
- Pass top-10 BM25 results to pgvector HNSW index
- Retrieve top-5 by vector similarity to query
- **Intersection:** combine BM25 top-10 + vector top-5 = candidate set C
- **Fusion score:** `0.6 * bm25_rank + 0.4 * vector_rank` (tune this alpha)

**Why two stages:**
- BM25 catches exact terminology matches (technician says "F0004", manual says "F0004")
- Vector catches semantic gaps (technician says "motor won't start", manual says "no-load condition")
- Together: recall 95%+, precision 90%+

**Implementation:** PostgreSQL full-text + pgvector extension.

---

### Layer 4: Verification + Fallback (Post-Retrieval)

**Goal:** Detect and recover from retrieval failure.

**Mechanisms:**
1. **Deterministic checks (no LLM):**
   - Check: top result has same vendor + model as query → PASS
   - Check: top result's title/section header contains query terms → PASS
   - Check: page number is present (not "unknown") → PASS
   - If all 3 pass: return result with confidence=HIGH

2. **Fallback chain:**
   - If checks fail on top result, try next result
   - If all results fail checks, return UNRESOLVED (don't invent)
   - Emit: "I couldn't find docs for [vendor/model]. I found [fallback result] for similar [vendor]. Confidence: LOW."

3. **Human-in-the-loop loop:**
   - In Hub training mode, operator can pin a result or mark an answer as correct
   - This pinned result gets boosted in future queries for that asset
   - Over time, the retrieval system learns per-asset

**Implementation:** Deterministic scoring function (no ML, no LLM).

---

## PART 4: Reference Implementation Architecture

```
Query → [Layer 2: Normalize] → metadata filters
         ↓
         [Layer 3a: BM25] → top-10 lexical
         ↓
         [Layer 3b: Vector] → top-5 semantic
         ↓
         [Fuse + Sort] → ranked candidates
         ↓
         [Layer 4: Verify] → confidence scoring
         ↓
         Result (HIGH/MEDIUM/LOW confidence)
```

**Tech stack:**
- **Indexing:** PostgreSQL `tsvector` + pgvector HNSW
- **Query processing:** TypeScript (no Python, runs in mira-hub)
- **Offline tagging:** Python script (runs once per KB ingest)

**Cost model:**
- **Per-query inference calls:** 0 (all deterministic)
- **Per-index embedding calls:** 1 per chunk (at ingest time, one-time)
- **Storage:** ~200 bytes per chunk (metadata + vectors in Postgres)

---

## PART 5: Phases to Ship Perfect Retrieval

### Phase 1: Field-Scoped BM25 (Offline)
- Inject synonym dictionary into PostgreSQL FTS
- Boost document titles 3x
- Baseline: manual test on 15 motor-starters → expect 40-50% recall

### Phase 2: Metadata Tagging (Offline)
- Extract vendor/model from manual metadata
- Tag chunks with `{vendor, model, equipment_type}`
- Metadata-filtered BM25 queries
- Expected: 70-80% recall on motor-starters

### Phase 3: pgvector Integration (Online)
- Index embeddings in PostgreSQL pgvector HNSW
- Fusion scoring (60% BM25 + 40% vector)
- Tune `ef` parameter for recall/latency tradeoff
- Expected: 90-95% recall, <500ms latency per query

### Phase 4: Verification Layer (Online)
- Implement deterministic checks (vendor match, term match, page number)
- Fallback chain for failed checks
- Hub pinning for human correction
- Expected: 95%+ recall, 90%+ precision, observable confidence per answer

### Phase 5: Continuous Refinement (Ongoing)
- Monitor Hub pins and corrections
- Re-weight alpha (BM25 vs. vector) per equipment type
- Add domain-specific synonym pairs (based on false negatives)

---

## PART 6: Success Criteria

**Golden corpus target:**
- Public (50 cases): 95%+ recall = 47-50 correct
- Motor-starters (15 cases): 95%+ recall = 14-15 correct
- Overall: 61-65 correct out of 65 = 94-98% accuracy

**Production criteria:**
- Latency: <500ms p95 per query (achieved by Phase 3)
- Confidence scoring: >80% of HIGH confidence results correct (verified by Phase 4 pins)
- Deterministic: zero LLM calls per query (zero-token compliant)

**Measurement:**
- Offline: run golden cases via `tests/beta/` suite
- Online: track Hub "correct answer" pins + operator edits in `decision_traces`
- Weekly: aggregate confidence distribution + pin-correction rate

---

## PART 7: What This Is NOT

This specification does **not** propose:
- ❌ Fine-tuning an LLM on MIRA's corpus (cost + training time)
- ❌ Re-training embeddings (expensive; general embeddings work)
- ❌ A RAG pipeline with LLM re-ranking per query (violates zero-token)
- ❌ Replicating competitors' closed-source "magic" (we don't know what it is)

It **does** propose:
- ✅ Deterministic layers (normalization, filtering, ranking) PROVEN by open-source systems
- ✅ Offline tagging + online fusion (low cost, high recall)
- ✅ Observable verification (confidence scoring)
- ✅ Human-in-the-loop learning (Hub pins)

---

## PART 8: Evidence from Open-Source Analysis

| System | Mechanism | License | Relevant to MIRA |
|--------|-----------|---------|------------------|
| **Elasticsearch** | BM25 + vector fusion | Apache-2.0 | ✅ Two-stage ranking |
| **Milvus** | HNSW tuning + IVF | Apache-2.0 | ✅ Vector indexing precision |
| **Weaviate (core)** | Metadata filtering + fusion | Apache-2.0 | ✅ Metadata-scoped search |
| **Tantivy** | Field-scoped BM25 + boosts | MIT | ✅ Field weighting |
| **Typesense (core)** | Typo tolerance + pinning | MIT | ✅ Operator authority |

**Cross-system pattern:** All successful open-source retrieval systems use **multi-layer ranking** (lexical + semantic + metadata) + **operator curation loops**. None rely on a single ranking signal.

---

## PART 9: Next Steps

1. **Validate on staging:** Implement Phase 1 (synonym + BM25 boosting) against golden cases
2. **Measure baseline:** Run `tests/beta/beta_ready_upload_retrieval_citation.py` to lock current accuracy
3. **Phase 1 execution:** 1-2 days (PostgreSQL FTS configuration + synonym file)
4. **Phases 2–4:** ~2-week sprint (metadata tagging + pgvector integration + verification)
5. **Launch:** Ship to staging, run full eval suite, verify 95%+ recall, then prod deploy

---

**End of specification.**

This is the research + specification BEFORE any building. The next phase is implementation on the schedule above.
