# Perfect Retrieval Specification for MIRA

**Date:** 2026-10-18  
**Status:** PROPOSED SPECIFICATION  
**Scope:** Define and implement accurate, deterministic retrieval for maintenance documentation  
**Audience:** Engineering team, product  

---

## Executive Summary

This specification defines what "perfect retrieval" means for MIRA and proposes a multi-strategy approach to achieve it. MIRA promises grounded, cited answers to technicians' maintenance questions. This requires **perfect retrieval** — not merely relevant results, but the *correct* result every time for deterministic queries (e.g., "what page has fault code F0004 in the GS10 manual?").

The specification draws from proven strategies used by production retrieval systems: Elasticsearch (distributed relevance scoring), Qdrant (vector quantization + hybrid search), and Meilisearch (typo tolerance + custom ranking). It proposes a **Four-Layer Retrieval Stack** that combines deterministic lookup, semantic search, statistical ranking, and human validation.

---

## 1. What "Perfect Retrieval" Means

### Definition

**Perfect retrieval** is the ability to return the correct answer to a deterministic query 100% of the time, with measurable confidence. Deterministic queries fall into three categories:

1. **Identifier-based** (answers are unambiguous given an identifier)
   - "Show me page 14 of the GS10 manual" → Should return ONLY page 14 chunks
   - "What fault code is F0004?" → Should return THE definition of F0004 from the manual
   - "Where is part number XYZ-123 mentioned?" → Should return ALL mentions with page numbers

2. **Semantic but bounded** (the answer set is limited by available context)
   - "What are the reset steps for this motor?" → Should return a specific procedure section
   - "How do I wire the proximity sensor?" → Should return the wiring diagram and reference section
   - "What does this error mean?" → Should return the error description from documentation

3. **Open-ended** (the answer requires synthesis, but grounding is perfect)
   - "Why is the conveyor not moving?" → Should cite relevant symptoms, fault codes, and diagnostics
   - "What could cause this vibration?" → Should cite mechanical troubleshooting guide
   - "How do I fix a motor overtemperature?" → Should cite thermal management procedures

### Failure Modes (What We Must Eliminate)

| Failure Mode | Definition | Impact | Example |
|---|---|---|---|
| **Wrong page** | Returns a page that does not answer the query | High | Query: "F0004" → Returns page 3 instead of page 14 where F0004 is defined |
| **Missing context** | Returns a chunk but lacks surrounding pages needed for understanding | High | Query: "reset steps" → Returns step 5 without steps 1-4 |
| **Rank inversion** | Returns relevant result but at position #8, not #1 | Medium | Query: "manual" → 100 results but true answer is ranked 8th |
| **Duplicate/redundant** | Returns the same fact 10 times in different wording | Medium | Same fault definition appears in 10 chunks with subtle wording differences |
| **Hallucinated context** | Returns page number that doesn't exist or never mentioned | Critical | Returns "page 500" when manual has only 200 pages |
| **Tenant leak** | Returns another customer's document in a multi-tenant query | Critical | Tenant A's query returns Tenant B's manual |
| **Stale evidence** | Returns old version of document after newer version uploaded | Medium | Outdated procedure returned instead of updated one |

---

## 2. Proven Strategies from Open-Source Systems

### 2.1 Elasticsearch: Statistical Relevance Scoring

**Core Strategy:** Use global term and document frequencies across all documents to compute relevance scores.

**Mechanisms:**
- **DFS Query Then Fetch**: Score documents using global term statistics, not shard-local statistics
- **Explain API**: Return detailed scoring breakdown for every result
- **Field-level boosting**: Weight title matches higher than body matches
- **Pre-filter sharding**: Reduce shard search space before full ranking

**MIRA Application:**
- Boost exact identifier matches (fault codes, part numbers) with 10x weight
- Boost page-number matches with 5x weight
- Return explain score for every chunk so humans can verify ranking

**Metrics:**
- Ranking position of correct answer (should be position 1 for >95% of queries)
- Score magnitude (correct answer should have >0.5 confidence threshold)

---

### 2.2 Qdrant: Vector Quantization + Hybrid Search

**Core Strategy:** Combine dense vector search (semantic) with sparse vector search (keyword) and select fusion strategy.

**Mechanisms:**
- **HNSW Indexing**: Hierarchical Navigable Small World for O(log n) vector search
- **Vector Quantization**: Reduce embedding dimensions from 1536 → 128, saving 92% RAM while preserving 97%+ accuracy
- **Sparse Vectors**: Full-text inverted index alongside dense vectors
- **Hybrid Fusion**: Combine dense + sparse results using Reciprocal Rank Fusion (RRF) or Dirichlet Base Similarity Fusion (DBSF)
- **Maximal Marginal Relevance (MMR)**: Reduce result redundancy by penalizing similar chunks

**MIRA Application:**
- Dense vectors (1536-d embeddings from `mira-crawler/ingest/embeddings.py`) for semantic matching
- Sparse vectors built from extracted identifiers + keywords at ingest time
- RRF fusion with weights: 40% sparse (identifiers matter most), 60% dense (context matters too)
- MMR reranking to remove duplicate fault definitions

**Metrics:**
- Top-1 accuracy: % of queries where correct answer is #1
- Top-3 accuracy: % of queries where correct answer is in top 3
- Recall: % of relevant pages retrieved (before ranking)
- Diversity: % of results that add new information (not redundant)

---

### 2.3 Meilisearch: Typo Tolerance + Custom Ranking

**Core Strategy:** Accept fuzzy/typo input, then apply custom ranking rules to re-order results.

**Mechanisms:**
- **Typo Tolerance**: Match "F0004" to "F-0004" or "F 0004" variants
- **Faceted Search**: Filter results by document type, date, manufacturer
- **Custom Ranking Rules**: Apply domain-specific ranking: exact match > prefix match > typo match
- **Search-as-You-Type**: Return results under 50ms for interactive use
- **Synonym Support**: Map "motor" → "VFD", "contactor", "drive"

**MIRA Application:**
- Typo tolerance for fault codes: "F004" → "F0004"
- Faceted filter by document type (manual, wiring diagram, datasheet)
- Custom ranking rule: exact page match > document match > semantic match
- Synonyms for domain terms (motor, drive, conveyor, sensor, contactor)

**Metrics:**
- Typo tolerance recall: % of fuzzy queries answered despite typos
- Facet filter correctness: % of faceted queries that exclude wrong document types
- Custom ranking quality: % of queries where custom rule improves rank position

---

### 2.4 BM25 + Embedding Ensemble (Academic Best Practice)

**Core Strategy:** Use BM25 (statistical keyword matching) and embedding similarity (semantic matching) together, not as fallback.

**Evidence:** Multiple academic papers (Dense Passage Retrieval, ColBERT) show ensemble retrieval outperforms either alone.

**Mechanisms:**
- **BM25 Indexing**: Probabilistic keyword relevance; fast, no model dependency
- **Embedding Search**: Semantic similarity; slow, requires model, prone to embedding-space bias
- **Score Fusion**: Normalize both scores (0-1 range) and weight: 0.7×BM25 + 0.3×embedding
- **Re-ranking**: Return top-100 from ensemble, then re-rank with a learned cross-encoder model

**MIRA Current State:**
- ✅ BM25 implemented (`knowledge_entries` FTS)
- ✅ Embeddings implemented (OpenAI/Groq providers)
- ❌ Ensemble disabled (embedding-gate killed BM25 in May 2026; see project memory)
- ❌ Re-ranking missing

**MIRA Application:**
- Restore BM25 as first-pass retrieval
- Ensemble scoring: 0.6×BM25 + 0.4×embedding
- Optional re-ranking stage (stretch goal: train domain-specific cross-encoder)

**Metrics:**
- NDCG@10: Normalized Discounted Cumulative Gain (standard IR metric)
- MRR: Mean Reciprocal Rank (position of first correct answer)

---

## 3. Four-Layer Retrieval Stack (Proposed)

This specification proposes stacking four retrieval layers, each handling a different query pattern:

```
Layer 1: DETERMINISTIC LOOKUP (identifier-based)
  ↓
Layer 2: SPARSE RETRIEVAL (BM25 keyword search)
  ↓
Layer 3: DENSE RETRIEVAL (embedding semantic search)
  ↓
Layer 4: SYNTHESIS RETRIEVAL (LLM-assisted ranking)
```

### Layer 1: Deterministic Lookup (O(1) Cost)

**Purpose:** For queries with explicit identifiers, return the exact answer immediately.

**Mechanism:**
- **Ingest time:** Extract identifiers (fault codes, part numbers, page numbers, component names) from every chunk
- **Index:** Build materialized lookup tables:
  - `(document_id, page_number) → chunk_ids`
  - `(fault_code) → (document_id, page_number, chunk_id)`
  - `(part_number) → (document_id, page_number, chunk_id)`
  - `(component_name, manual_name) → (document_id, page_number, chunk_id)`
- **Query time:** If identifier found in query, look up table → O(1) retrieval

**Example:**
```
Query: "What page has fault code F0004 in the GS10 manual?"
Layer 1 lookup: fault_code_index["F0004"] → (gs10_manual, page_14)
Result: Return chunks from page 14 (+ pages 12-16 for context)
Confidence: 100% (exact match)
Cost: O(1) – deterministic, no ML
```

**Implementation:**
```python
# At ingest time (mira-crawler/ingest/normalize.py or new module)
def build_identifier_index(chunks: List[Chunk], document: Document) -> IdentifierIndex:
    index = {
        "fault_codes": {},    # fault_code → (doc_id, page, chunk_id)
        "part_numbers": {},   # part_num → (doc_id, page, chunk_id)
        "page_lookup": {},    # (doc_id, page) → [chunk_ids]
        "components": {},     # (component, manual) → (doc_id, page, chunk_id)
    }
    for chunk in chunks:
        # Extract identifiers from chunk.text
        fault_codes = extract_fault_codes(chunk.text)
        part_numbers = extract_part_numbers(chunk.text)
        
        for code in fault_codes:
            index["fault_codes"][code] = (document.id, chunk.page_number, chunk.id)
        for part in part_numbers:
            index["part_numbers"][part] = (document.id, chunk.page_number, chunk.id)
    
    return index

# At query time (mira-bots/shared/engine.py or new retrieval module)
def layer1_deterministic_lookup(query: str, identifier_index: IdentifierIndex) -> Optional[List[Chunk]]:
    # Extract identifiers from query
    fault_codes = extract_fault_codes(query)
    part_numbers = extract_part_numbers(query)
    
    # Deterministic lookup
    for code in fault_codes:
        if code in identifier_index["fault_codes"]:
            doc_id, page, chunk_id = identifier_index["fault_codes"][code]
            return retrieve_chunks_near_page(doc_id, page, context_pages=2)
    
    for part in part_numbers:
        if part in identifier_index["part_numbers"]:
            doc_id, page, chunk_id = identifier_index["part_numbers"][part]
            return retrieve_chunks_near_page(doc_id, page, context_pages=2)
    
    return None  # Fall through to Layer 2
```

**Storage:**
- Materialized view or separate table in Neon:
  ```sql
  CREATE TABLE identifier_index (
      document_id UUID NOT NULL,
      identifier_type TEXT NOT NULL,  -- 'fault_code', 'part_number', 'component'
      identifier_value TEXT NOT NULL,
      page_number INT,
      chunk_ids TEXT[],  -- JSON array of chunk UUIDs
      confidence FLOAT DEFAULT 1.0,  -- 1.0 = extracted by rules, <1.0 = extracted by LLM
      UNIQUE(document_id, identifier_type, identifier_value)
  );
  ```

---

### Layer 2: Sparse Retrieval (BM25)

**Purpose:** For keyword-based queries, return relevant documents using probabilistic ranking.

**Mechanism:**
- **Index:** PostgreSQL full-text search (already implemented as `knowledge_entries` FTS)
- **Scoring:** BM25 (Okapi BM25 variant)
- **Filtering:** Tenant scoping (`is_private = false OR tenant_id = $caller`)
- **Top-k:** Return top 50 BM25 results

**Example:**
```
Query: "reset steps for motor"
BM25 ranking:
  1. [doc: GS10 Manual] "Motor Reset Procedure (page 42)" – score 8.5
  2. [doc: GS10 Manual] "Power Reset Cycle (page 18)" – score 7.2
  3. [doc: VFD Guide] "Reset from Fault (page 156)" – score 6.8
Result: Top 50 returned for Layer 3 input
```

**Status:** ✅ Already implemented. Restore from `project_recall_embedding_gate.md` memory: re-enable in retrieval.

---

### Layer 3: Dense Retrieval (Embedding Ensemble)

**Purpose:** Rank Layer 2 results using semantic similarity; combine with BM25 scores.

**Mechanism:**
- **Embedding:** OpenAI `text-embedding-3-small` or Groq embeddings (1536-d)
- **Vector index:** Qdrant (already deployed at `:8000` on CHARLIE)
- **Query embedding:** Generate embedding for the query
- **Similarity search:** Find top-100 vectors nearest to query embedding
- **Fusion:** Combine BM25 scores (from Layer 2) with embedding similarity:
  ```
  fused_score = 0.6 × normalized_bm25_score + 0.4 × normalized_embedding_score
  ```
- **Reranking:** Sort results by fused_score, return top-20

**Example:**
```
Query: "Why is the motor overheating?"
Layer 2 (BM25): Returns [Thermal Management (page 80), Overtemp Fault (page 120), Cooling Guide (page 156)]
Layer 3 (Embedding): "Motor overheating" embedding searches Qdrant → same 3 pages rank highest
Fusion: Fused_score = [0.92, 0.88, 0.85]
Result: Top-20 semantic + keyword matches
```

**Implementation:**
```python
# Restore and enhance retrieval in mira-hub/src/lib/manual-rag.ts or mira-bots/shared/retrieval.py

def ensemble_retrieval(
    query: str, 
    tenant_id: str, 
    bm25_results: List[Chunk],
    embedding_client: AsyncClient,
    qdrant_client: AsyncClient,
    bm25_weight: float = 0.6,
    embedding_weight: float = 0.4
) -> List[Chunk]:
    # Generate query embedding
    query_embedding = await embedding_client.embed_query(query)
    
    # Search Qdrant
    embedding_results = await qdrant_client.search(
        query_vector=query_embedding,
        limit=100,
        filter={
            "must": [
                {"key": "tenant_id", "match": {"value": tenant_id}},
                {"key": "is_private", "match": {"value": False}}  # hybrid corpus rule
            ]
        }
    )
    
    # Normalize scores to [0, 1]
    bm25_scores = {r.id: r.score / max(r.score for r in bm25_results) for r in bm25_results}
    emb_scores = {r.id: r.similarity for r in embedding_results}
    
    # Fuse scores
    fused = {}
    for chunk_id in set(list(bm25_scores.keys()) + list(emb_scores.keys())):
        bm25_score = bm25_scores.get(chunk_id, 0.0)
        emb_score = emb_scores.get(chunk_id, 0.0)
        fused[chunk_id] = bm25_weight * bm25_score + embedding_weight * emb_score
    
    # Re-rank and return top-20
    top_20 = sorted(fused.items(), key=lambda x: x[1], reverse=True)[:20]
    return [chunk_store.get(chunk_id) for chunk_id, _ in top_20]
```

---

### Layer 4: Synthesis Retrieval (LLM-Assisted Ranking, Optional)

**Purpose:** For ambiguous queries, use an LLM to understand intent and re-rank results.

**Mechanism:**
- **Input:** Top-20 results from Layer 3
- **LLM task:** "Given this maintenance question and these 20 candidate answer chunks, which chunk best answers the question? Return the chunk ID."
- **Model:** Fast, lightweight (Claude 3.5 Haiku, not Opus; Groq; local qwen2.5)
- **Cost:** O(top-20) × O(model_call); only for uncertain queries (confidence < 0.7)

**Example:**
```
Query: "My motor keeps tripping on overtemp. What should I check?"
Layer 3 (Ensemble): Returns [Thermal Management, Overtemp Fault, Cooling, etc.] with confidence 0.65
Layer 4 (LLM): "The most relevant is Thermal Management (pages 78-82) because it lists step-by-step diagnostic checks."
Result: Rerank Thermal Management to position #1
```

**Implementation:**
```python
async def layer4_synthesis_ranking(
    query: str,
    top_20_chunks: List[Chunk],
    confidence_threshold: float = 0.7,
    inference_client: AsyncClient = None
) -> List[Chunk]:
    if not inference_client:
        return top_20_chunks  # Skip if not configured
    
    # Check if we need synthesis (low confidence from Layer 3)
    if max(chunk.score for chunk in top_20_chunks) >= confidence_threshold:
        return top_20_chunks
    
    # LLM reranking prompt
    prompt = f"""
    Maintenance Query: {query}
    
    Here are 20 candidate answer chunks. Which chunk most directly answers the query?
    Return only the chunk ID.
    
    Chunks:
    {format_chunks_for_llm(top_20_chunks)}
    """
    
    best_chunk_id = await inference_client.complete(prompt)
    
    # Reorder: best chunk to top
    reordered = [c for c in top_20_chunks if c.id == best_chunk_id]
    reordered += [c for c in top_20_chunks if c.id != best_chunk_id]
    return reordered
```

**Cost Profile:**
- Triggers only for low-confidence queries (~10-20% of traffic)
- Cost: ~0.0001 per call (Groq/Haiku)
- Latency: +200ms (acceptable for async queries)

---

## 4. Complete Implementation Plan

### Phase 1: Foundation (Weeks 1-2)

**Goal:** Restore BM25 + enable Layer 1 deterministic lookup

#### 1.1 Restore BM25 Ensemble (PR)
- [ ] Re-enable BM25 retrieval in `runBm25Query()` (mira-hub/src/lib/manual-rag.ts)
- [ ] Verify `knowledge_entries` FTS index exists and is fresh
- [ ] Add unit test: query "F0004" → returns top result with "F0004" on page 14
- [ ] Benchmark: measure NDCG@10 on golden cases (tests/golden_factorylm.csv)
- [ ] File: PR with "restore BM25 ensemble" commit message

#### 1.2 Extract Identifiers at Ingest (PR)
- [ ] Add `extract_identifiers()` function to mira-crawler/ingest/normalize.py
  - Fault codes: regex `/[A-Z]{1,2}\d{4,5}/` (F0004, E001, oC, A002)
  - Part numbers: regex `/[A-Z]{2,4}-\d{3,8}/` (XYZ-123, PART-00456)
  - Component names: keyword match against approved list (motor, contactor, sensor, etc.)
- [ ] Extract `page_number` from chunk metadata (already present in knowledge_entries.metadata)
- [ ] Write extracted identifiers to chunk.metadata.identifiers field
- [ ] Test: ingest GS10 manual → verify F0004 extracted and page 14 recorded

#### 1.3 Create Identifier Index Table (Migration)
- [ ] Migration: Create `identifier_index` table (schema above)
- [ ] Backfill: Scan all existing chunks, extract identifiers, populate table
- [ ] Index: Add UNIQUE(document_id, identifier_type, identifier_value)
- [ ] Test: `SELECT * FROM identifier_index WHERE identifier_value = 'F0004'` → returns page 14

### Phase 2: Layer 1 Integration (Weeks 2-3)

**Goal:** Query deterministically to identifier index before semantic search

#### 2.1 Layer 1 Lookup Implementation (PR)
- [ ] Add `layer1_deterministic_lookup()` function to mira-bots/shared/retrieval.py
- [ ] Call it at the start of `runBm25Query()` and `answer_question()`
- [ ] If successful, return result + log `retrieval_layer=1` and `retrieval_cost=0.0`
- [ ] If not found, fall through to Layer 2 (BM25)
- [ ] Test: query "What is fault code F0004?" → Layer 1 retrieves page 14 only

#### 2.2 Add Explain Scoring (PR)
- [ ] Return `_explain` field in every retrieval result with:
  - `layer_used` (1, 2, 3, or 4)
  - `confidence` (0.0-1.0)
  - `score` (raw ranking score)
  - `matching_fields` (list of fields that matched: "fault_code", "title", "body", etc.)
- [ ] Example:
  ```json
  {
    "chunk_id": "abc-123",
    "text": "Fault F0004: Motor Overtemperature",
    "_explain": {
      "layer_used": 1,
      "confidence": 1.0,
      "score": 1.0,
      "matching_fields": ["fault_code"],
      "retrieval_cost_ms": 2
    }
  }
  ```
- [ ] Test: Verify explain data appears in Slack/Telegram replies (optional feature: `/debug` mode)

### Phase 3: Ensemble Scoring (Weeks 3-4)

**Goal:** Combine BM25 + embedding scores with optimal weighting

#### 3.1 Implement Fusion Scoring (PR)
- [ ] Restore embedding search: enable Qdrant vector search for Layer 3
- [ ] Normalize BM25 scores: `bm25_norm = bm25_score / max_bm25_score`
- [ ] Normalize embedding scores: `emb_norm = embedding_similarity / 1.0` (already [0,1])
- [ ] Compute fused score: `fused = 0.6 × bm25_norm + 0.4 × emb_norm`
- [ ] Return top-20 results sorted by fused score
- [ ] Configuration: weights in `RETRIEVAL_CONFIG` (env vars or settings.json)
  - `RETRIEVAL_BM25_WEIGHT=0.6`
  - `RETRIEVAL_EMBEDDING_WEIGHT=0.4`

#### 3.2 Tuning & Benchmarking (PR)
- [ ] Benchmark on `tests/golden_factorylm.csv` (66 cases):
  - Measure NDCG@10, MRR (Mean Reciprocal Rank), Top-1 Accuracy
  - Before: BM25 only
  - After: BM25 + embedding ensemble
- [ ] Target: Top-1 Accuracy ≥ 85% (correct answer in position #1)
- [ ] If below target, adjust weights (try 0.5/0.5 or 0.7/0.3) and re-benchmark
- [ ] Commit: "perf(retrieval): BM25 + embedding ensemble (NDCG@10 = X)"

### Phase 4: Redundancy Removal (Week 4)

**Goal:** Apply Maximal Marginal Relevance to reduce duplicate results

#### 4.1 Implement MMR Reranking (PR)
- [ ] Add `rerank_by_mmr()` function:
  ```python
  def rerank_by_mmr(
      results: List[Chunk],
      embedding_client: AsyncClient,
      diversity_penalty: float = 0.7,
      top_k: int = 10
  ) -> List[Chunk]:
      # For each result i, compute:
      #   mmr_score = similarity(query, result_i) - diversity_penalty × max(similarity(result_i, result_j)) for j in selected
      # Greedily select top_k maximizing MMr_score
  ```
- [ ] Apply after Layer 3 ensemble retrieval
- [ ] Return top-10 instead of top-20 to user (diversity improves comprehension)
- [ ] Test: Query "What is fault code F0004?" → Returns page 14 once, not 10x

#### 4.2 Measure Diversity (PR)
- [ ] Add metric: "Unique Information %" = (# unique facts in results) / (total facts)
- [ ] Benchmark: measure before/after MMR
- [ ] Target: >80% unique information (reduce redundancy)

### Phase 5: Re-Ranking (Optional, Week 5+)

**Goal:** Use a learned cross-encoder to improve ranking for ambiguous queries

#### 5.1 Deploy Cross-Encoder (If Budget Allows)
- [ ] Options:
  1. Lightweight: `ms-marco-TinyBERT-L-2-v2` (free, open source, runs locally)
  2. API-based: OpenAI `GPT-4-turbo` re-ranker (paid, high quality)
  3. Fine-tuned: Train on golden cases + MIRA queries (long-term)
- [ ] Implement Layer 4 LLM ranking (above) with configurable model
- [ ] Apply only if ensemble confidence < 0.7

#### 5.2 Fine-Tuning (Stretch Goal)
- [ ] Collect 500+ query-chunk pairs labeled "relevant" / "not relevant"
- [ ] Fine-tune lightweight cross-encoder on this domain
- [ ] Measure improvement in NDCG@10

---

## 5. Metrics & Acceptance Criteria

### Retrieval Quality Metrics

| Metric | Definition | Target | Measurement |
|--------|-----------|--------|-------------|
| **Top-1 Accuracy** | % of queries where correct answer is position #1 | ≥ 85% | Run on `tests/golden_factorylm.csv` |
| **Top-3 Accuracy** | % of queries where correct answer is in top 3 | ≥ 95% | Run on `tests/golden_factorylm.csv` |
| **NDCG@10** | Normalized Discounted Cumulative Gain (IR standard) | ≥ 0.75 | Measure on golden cases with human judgments |
| **MRR** | Mean Reciprocal Rank (average position of first correct answer) | ≥ 0.80 | (1 / avg position of correct answer) |
| **Recall@100** | % of relevant pages retrieved (before ranking) | ≥ 98% | Manually label relevant pages for 20 queries |
| **Precision@10** | % of top-10 results that are relevant | ≥ 80% | Manual judgment on 20 queries × 10 results |
| **Unique Information %** | % of results with non-redundant facts | ≥ 80% | Count unique facts in top-10 results |

### Failure Mode Prevention

| Failure Mode | Detection Method | Target |
|---|---|---|
| **Wrong page** | Top-1 accuracy for deterministic queries | 100% for identifier-based queries (Layer 1) |
| **Missing context** | Pages returned should include ±2 adjacent pages | ≥ 95% of results include context pages |
| **Rank inversion** | MRR should be high | ≥ 0.80 MRR |
| **Duplicate/redundant** | MMR reranking + uniqueness metric | ≥ 80% unique information |
| **Hallucinated context** | Verify all returned pages exist in document | 100% (automated check) |
| **Tenant leak** | Query with tenant_id filter always applied | 100% (unit tests enforce) |
| **Stale evidence** | Compare document version hash | 100% (automated check at retrieval time) |

---

## 6. Risk Mitigation

### Risk 1: Embedding Bias (Embeddings Favoring Certain Words)

**Problem:** OpenAI embeddings may overweight certain domain terms, causing rank inversion.

**Mitigation:**
- Keep BM25 weight at 60% (keyword-grounded retrieval)
- Monitor embedding drift: track how embedding similarity changes for same query across different time periods
- Fallback: If ensemble confidence < 0.5, use BM25 only

### Risk 2: Identifier Extraction Errors

**Problem:** Regex/NLP may misidentify parts as fault codes (e.g., "Model F123" as "F123" fault code).

**Mitigation:**
- High-confidence extraction: regex + manual allowlist only
- Low-confidence extraction: regex + LLM + human approval queue
- Only use high-confidence for Layer 1 deterministic lookup
- Log all extractions for audit trail

### Risk 3: Multi-Tenant Scoping

**Problem:** Identifier index could leak private documents across tenants.

**Mitigation:**
- **Always filter by tenant_id** in every query (Layer 1-4)
- Schema: Include `tenant_id` in identifier_index table
- Unit tests: For every retrieval function, test with tenant A query should NOT return tenant B's documents
- Audit: Monthly scan of retrieval logs for any cross-tenant queries

### Risk 4: Stale Index

**Problem:** Identifier index or embeddings could drift from live documents.

**Mitigation:**
- Re-index identifier_index on every document upload
- Embeddings: Re-embed on every document version change
- Monitoring: Track mismatch between identifier_index and knowledge_entries (should be 1:1)
- SLA: Any detected drift → flag and rollback document upload until fixed

---

## 7. Expected Outcomes

### After Phase 1 (Restore BM25)
- ✅ Top-1 Accuracy: 70% → 78%
- ✅ Cost: Reduced (no embedding calls for keyword queries)
- ⏳ Ready for Phase 2

### After Phase 2 (Layer 1 Deterministic)
- ✅ Top-1 Accuracy: 78% → 88% (identifier queries hit 100%)
- ✅ Retrieval Cost: O(1) for deterministic queries
- ✅ Ready for Phase 3

### After Phase 3 (Ensemble + MMR)
- ✅ Top-1 Accuracy: 88% → 92%
- ✅ Unique Information: 65% → 85%
- ✅ MRR: 0.75 → 0.82
- ✅ Ready for Phase 4

### After Phase 4 (Optional Re-Ranking)
- ✅ Top-1 Accuracy: 92% → 95%+
- ✅ Ready for production

---

## 8. Configuration & Deployment

### Environment Variables (factorylm/prd or dev Doppler)
```bash
RETRIEVAL_LAYER_1_ENABLED=true
RETRIEVAL_BM25_WEIGHT=0.6
RETRIEVAL_EMBEDDING_WEIGHT=0.4
RETRIEVAL_MMR_ENABLED=true
RETRIEVAL_MMR_DIVERSITY_PENALTY=0.7
RETRIEVAL_LAYER4_ENABLED=false  # Re-ranking (optional)
RETRIEVAL_LAYER4_MIN_CONFIDENCE=0.7
RETRIEVAL_TOP_K_RESULTS=10
RETRIEVAL_EXPLAIN_ENABLED=true
IDENTIFIER_EXTRACTION_CONFIDENCE_THRESHOLD=0.95  # High confidence only
```

### Database Migrations
- Migration 072: Create `identifier_index` table
- Migration 073: Backfill `identifier_index` from existing chunks
- Index: `identifier_index.document_id, identifier_index.identifier_value`

### Feature Flags
```python
class RetrievalFeatureFlags:
    LAYER_1_ENABLED = os.getenv("RETRIEVAL_LAYER_1_ENABLED", "true") == "true"
    LAYER_2_ENABLED = os.getenv("RETRIEVAL_BM25_WEIGHT", "0.6") != "0"
    LAYER_3_ENABLED = os.getenv("RETRIEVAL_EMBEDDING_WEIGHT", "0.4") != "0"
    LAYER_4_ENABLED = os.getenv("RETRIEVAL_LAYER4_ENABLED", "false") == "true"
    MMR_ENABLED = os.getenv("RETRIEVAL_MMR_ENABLED", "true") == "true"
    EXPLAIN_ENABLED = os.getenv("RETRIEVAL_EXPLAIN_ENABLED", "true") == "true"
```

---

## 9. Success Criteria (Done Definition)

A retrieval system is **done** when:

- [ ] All unit tests pass (retrieval layers 1-4)
- [ ] All integration tests pass (golden cases + acceptance suite)
- [ ] Top-1 Accuracy ≥ 92% on `tests/golden_factorylm.csv` (66 cases)
- [ ] MRR ≥ 0.82
- [ ] No tenant leaks (verified by security test)
- [ ] Identifier extraction > 95% precision on sample of 100 documents
- [ ] Unique Information % ≥ 80%
- [ ] Performance: avg retrieval latency < 500ms (Layer 1-3) or < 2s (Layer 4)
- [ ] Documentation: CLAUDE.md updated with retrieval strategy
- [ ] Deployed to staging, tested with real technicians for 1 week
- [ ] Zero regressions: existing chat functionality unaffected
- [ ] Monitoring: Retrieval metrics exported to Prometheus + Grafana dashboard

---

## 10. References & Further Reading

### Open-Source Systems Analyzed
- **Elasticsearch:** DFS Query Then Fetch, relevance scoring
- **Qdrant:** HNSW indexing, vector quantization, hybrid search
- **Meilisearch:** Typo tolerance, custom ranking, faceted search
- **LangChain:** Retrieval abstractions (not used here per PRD §4)

### Academic Papers
- Dense Passage Retrieval (DPR): Dense, Sparse, and Hybrid Retrieval
- ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT
- BM25: Probabilistic Ranking Framework (Okapi BM25)

### MIRA Docs
- `.claude/rules/materialized-evidence.md` – Ingest-once, recall-before-recompute doctrine
- `.claude/rules/knowledge-entries-tenant-scoping.md` – Hybrid corpus, per-tenant filtering
- `docs/specs/maintenance-namespace-builder-spec.md` – UNS context for retrieval
- `project_retrieval_precision_2026_06_17.md` – Historical precision work

### Tools & Services
- **Qdrant:** Vector search (already deployed at :8000 on CHARLIE)
- **Neon:** PostgreSQL (already hosting knowledge_entries)
- **OpenAI / Groq:** Embeddings providers (already integrated)

---

## Appendix A: Query Examples & Expected Outcomes

### Deterministic Query (Layer 1)
```
Query: "What is fault code F0004 in the GS10 manual?"
Layer 1: identifier_index lookup → "fault_code='F0004'" → page 14
Result: [GS10 Manual page 14: "Fault F0004: Motor Overtemperature..."]
Confidence: 1.0 (exact match)
Cost: O(1), 2ms
```

### Keyword Query (Layer 2)
```
Query: "How do I reset the motor after a fault?"
Layer 1: No identifier found → fall through
Layer 2: BM25 search → "reset" + "motor" → [page 42, page 18, page 156]
Layer 3: Embedding → semantic match on "reset procedure" → re-rank
Result: [GS10 Manual page 42: "Motor Reset Procedure", ...]
Confidence: 0.88
Cost: O(1) BM25 + O(1) embedding lookup, 80ms
```

### Semantic Query (Layer 3)
```
Query: "Why is my motor making a noise?"
Layer 1: No identifier → fall through
Layer 2: BM25 → "noise", "motor" → [page 156, page 89, page 34]
Layer 3: Embedding (semantic) → "audible anomaly" / "vibration" → re-rank
Layer 4: LLM re-rank (optional) → "Mechanical troubleshooting is most relevant" → reorder
Result: [GS10 Manual page 156: "Troubleshooting Guide - Noise", ...]
Confidence: 0.75
Cost: O(1) BM25 + O(1) embedding + O(top-20) LLM, 200ms
```

---

## Appendix B: Identifier Extraction Regex Patterns

```python
# Fault Codes: [A-Z]{1,2}[0-9]{4,5}
# Examples: F0004, E001, oC, A002
FAULT_CODE_PATTERN = r'\b[A-Z]{1,2}\d{4,5}\b'

# Part Numbers: [A-Z]{2,4}-[0-9]{3,8}
# Examples: XYZ-123, PART-00456, PS-004, CTRL-1234567
PART_NUMBER_PATTERN = r'\b[A-Z]{2,4}-\d{3,8}\b'

# Component Names (keyword match, not regex)
# Examples: motor, contactor, proximity sensor, thermal relay
COMPONENT_KEYWORDS = [
    "motor", "contactor", "capacitor", "relay", "sensor", "proximity",
    "thermal", "overload", "limit switch", "terminal", "fuse", "breaker",
    "winding", "bearing", "shaft", "coupling", "pulley", "belt"
]
```

---

**END OF SPECIFICATION**

Generated: 2026-10-18  
Status: PROPOSED  
Next Step: Advisor review + Phase 1 implementation plan
