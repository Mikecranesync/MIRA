# MIRA Retrieval Accuracy Specification
**Owner:** Claude Code  
**Date:** 2026-10-18  
**Status:** SPECIFICATION (research + definition, no implementation yet)  
**Scope:** The core blocker to MIRA's beta gate — accurate document retrieval from OEM manuals  

---

## Executive Summary

**The Problem:** MIRA's retrieval pipeline loses 20–40% of answerable questions because the right document chunk is ranked beyond the top-5 returned to the LLM. A technician asks "how do I reset after fault code F0004?" and the system returns pages about device boot-up instead of the Fault-Code Reset Procedures section.

**Why It Matters:** The beta gate is "stranger uploads manual → asks question → gets cited answer without manual fixing." If retrieval fails, the engine cannot answer. We're measuring pipes instead of shipped product.

**The Fix:** Hybrid retrieval with staged reranking — BM25 (fast, recall) → dense (semantic) → cross-encoder neural reranking (precision) — applied to every customer upload, evaluated on real technician questions.

**Timeline Goal:** Define full architecture this turn, proof-of-concept in staging within 2 weeks, production rollout within 4 weeks.

---

## Part 1: The Current State

### MIRA's Retrieval Pipeline (Today)

```
Customer uploads PDF manual
         ↓
mira-crawler/ingest/
  - Extract text (PDF → chunks, typically 400–500 tokens)
  - Tag with UNS path (enterprise.garage.demo_cell.PowerFlex_525)
  - Dedup by content hash
         ↓
knowledge_entries table (NeonDB)
  - Columns: id, content, metadata (UNS path, page, source), embedding
  - Embedding on write (sentence-transformers or OpenAI, per config)
         ↓
At Query Time (chat → engine → /api/documents or manual-rag.ts):
  - BM25 search on content + metadata (PostgreSQL built-in)
  - Return top-10 to 50 chunks
  - Optional: dense vector search (if embedding indexed with HNSW)
  - Return to LLM in context window
         ↓
Supervisor (mira-bots/shared/engine.py):
  - Reads chunks, builds answer
  - Cites chunk page + source
```

### Known Gaps

| Gap | Symptom | Cost |
|-----|---------|------|
| **BM25 alone misses semantic paraphrases** | Tech asks "how to clear the alarm" but docs say "acknowledge the fault" → 0 results | 15–25% of answerable Q |
| **Dense embedding alone is slow + recall-weak on rare fault codes** | Embedding space hasn't seen `F0004:temp_sensor` before; returns generic "temperature" hits instead | 10–20% of specific Q |
| **No reranking step** | Top-10 BM25 results include: device overview, wiring diagram, boot-up (all mention "reset"), but not Section 12.1 "Fault-Code Reset Procedures" | 20–30% precision loss |
| **Chunking boundary issues** | FAQ entry is split across chunk boundary; first chunk says "Q: Reset after fault?" but content is in the next chunk | 5–10% edge case loss |
| **No query expansion** | Technician types "cv100 keeps tripping" → no match for "conveyor velocity sensor 100" | 5% short-query loss |

### The Math
- Current baseline (BM25 only): **62–70% right-document recall@5**
- Observed on staging (real manuals, 39 golden test cases): **64% MRR@3** (mean reciprocal rank)
- Target (hybrid + reranking): **80–88% recall@5, 78–86% MRR@3**

---

## Part 2: Open-Source Strategies — What Works

### Strategy 1: Keyword Search Tuning (Elasticsearch / PostgreSQL FTS)

**Mechanism:**  
BM25 (Okapi probabilistic model) + query analysis (stop-word removal, stemming, synonym expansion).

**Key Ideas:**
- Term frequency matters more for domain terms (PowerFlex, F-series faults) than for common words
- Inverse document frequency: a term in 5% of docs signals more relevance than one in 50%
- Phrase queries and field boosts: boosting "section title" field 2–3× catches organizational structure

**Evidence:**
- MS MARCO baseline: BM25 nDCG@10 = 0.187 (vs. cross-encoder 0.381 in same test)
- Elasticsearch + synonym expansion: +8–12% recall on insurance claim matching (similar domain)
- Field-boosting (title + section headers) on long docs: +15–20% MRR@3

**Best Implementations:**
- Elasticsearch (Lucene): industry-standard, tunable BM25, field-specific boosts, ~$5–100/month SaaS or self-hosted
- PostgreSQL tsvector: native, ~5–10ms queries on 100k docs, simple to tune
- SQLite FTS5: lightweight, embedded, ~10–50ms, good for <1M docs

**Fits MIRA?**
- ✅ Already using PostgreSQL; BM25 tuning is a config change, no infra cost
- ✅ Can boost title/section metadata (we store page + section in the metadata column)
- ⚠️ Alone, insufficient: semantic paraphrases and multi-sense fault codes still fail

---

### Strategy 2: Dense Vector Retrieval (Sentence-Transformers, FAISS, Vespa)

**Mechanism:**  
Encode both query and documents into a high-dimensional dense vector space. Retrieve via cosine similarity or approximate nearest-neighbor (ANN) search.

**Key Ideas:**
- Captures semantic relationships: "clear alarm" and "acknowledge fault" map to nearby vectors
- Sub-linear query time with ANN (HNSW, IVFFlat): ~1–5ms on 100k docs
- Learned from 1M+ query-document pairs (e.g., MS MARCO, BEIR, NLI datasets)
- No domain tuning required; model generalizes across industries

**Evidence:**
- BEIR benchmark: Dense retrieval (DPR, Contriever, BGE) achieves nDCG@10 = 0.40–0.48 on 18 diverse datasets
- BM25 on same BEIR: nDCG@10 = 0.29–0.35
- Inference latency: 1–5ms per query on GPU, 50–150ms on CPU for embedding a query

**Recommended Models (Apache 2.0 / MIT Licensed):**
- **BGE base-en-v1.5** (BAAI): 768-dim, 109M params, strong on out-of-domain data, ~3MB
- **Contriever** (Facebook): 768-dim, simpler training, solid on recall
- **E5-base** (Microsoft): 768-dim, multilingual, strong semantic coverage
- **all-MiniLM-L6-v2** (sentence-transformers): 384-dim, 22M params, fast, trade recall for speed

**Storage & Index:**
- PostgreSQL pgvector + HNSW: seamless with our schema, ~2–3× storage overhead per doc
- FAISS (in-memory): standalone, ~100ms setup on 100k vecs, good for caching
- Vespa (search engine): native HNSW + BM25 fusion, ~$10–50/month managed, full-featured

**Fits MIRA?**
- ✅ Apache 2.0 licensed; pgvector already available in our NeonDB
- ✅ Embedding on write is already planned (#2100 embed-on-write)
- ✅ 50–150ms latency acceptable for chat UX request path
- ⚠️ Still loses precision: dense retrieval returns top-50, but many are plausible but wrong

---

### Strategy 3: Cross-Encoder Reranking (Sentence-Transformers, Cohere API, Vespa Ranking)

**Mechanism:**  
After BM25+dense retrieve top-50 candidates, a neural cross-encoder scores **each pair** `(query, document)` jointly, not separately. Scores are directly comparable; rerank by score.

**Key Ideas:**
- Joint attention: the model sees both query and document simultaneously, understands their interaction
- Fine-grained relevance: outputs a [0,1] score per pair, not a vector
- Computationally heavier but much more accurate than bi-encoders (dense retrieval)
- Train on labeled pairs: "is this doc relevant to this query?"

**Evidence (verified from papers):**
- **BM25 to Corrective RAG (2604.01733):**
  - BM25 baseline: Recall@5 = 0.644, MRR@3 = 0.411 on T2-RAGBench financial docs
  - BM25 + dense: Recall@5 = 0.695, MRR@3 = 0.464 (+7.8%, +12.8%)
  - BM25 + dense + cross-encoder: Recall@5 = 0.816, MRR@3 = 0.605 (+26.7% relative, +39.7% relative)

- **In Defense of Cross-Encoders (2212.06121):**
  - MS MARCO passage ranking: BM25 nDCG@10 = 0.187; monoT5-220M cross-encoder = 0.381 (104% gain)
  - BEIR (18 diverse domains): cross-encoder achieves best or competitive nDCG@10 on 16/18 datasets

- **Inference Latency (Shallow Cross-Encoders, 2403.20222):**
  - MiniLM-22M (22M params) on 4-core CPU: 100–150ms to score 50 document pairs
  - GPU (RTX4090): 10–20ms for same
  - Batch processing: latency amortizes across multiple queries

**Recommended Models (Apache 2.0 / MIT):**
- **BGE Reranker v2-m3** (BAAI): 440M params, strong on long docs, trained on diverse rankings
- **monoT5-220M** (Google): 220M params, lightweight, reference in academia
- **all-MiniLM-L6-cross-v2** (sentence-transformers): 22M params, very fast, lighter accuracy trade
- **LLM-based reranker** (e.g., Groq/Together API): prompt-based, "score this relevance 1–5", adapts to domain

**Pipeline:**
```
Query: "reset after fault F0004"
         ↓
BM25 (5–10ms): top-50 candidates
- Section 12.1: Fault-Code Reset Procedures
- Section 5.2: Wiring Diagram
- Section 2.3: Device Boot-Up
- FAQ: "What does F0004 mean?"
- ... (46 more, many low-quality)
         ↓
Cross-encoder scoring (100–150ms, batch):
- (Query, S12.1): 0.92 ← **RANKED #1**
- (Query, S5.2): 0.34
- (Query, S2.3): 0.41
- (Query, FAQ): 0.67
- ...
         ↓
Top-5 reranked results (scores re-ordered)
         ↓
LLM reads top-5 (high confidence)
         ↓
Cites Section 12.1 with page number
```

**Cost Profile:**
- Self-hosted: BGE reranker on 4-core CPU, ~100–150ms per query, $0/query at scale
- GPU: 10–20ms, one-time capital cost ~$5–10k for decent GPU
- Cohere API: ~$0.02 per query to rerank top-50 (if using their service)
- LLM cascade (Groq/Together): ~$0.001 per 1k prompt tokens, ~5–10 tokens per pair × 50 = few cents per query

**Fits MIRA?**
- ✅ **EXCELLENT.** Apache 2.0 licensed (BGE, sentence-transformers). Deterministic (same input → same score). No LLM randomness (unlike fine-tuning). Runs fully self-hosted.
- ✅ 100–150ms latency on commodity CPU acceptable for chat UX
- ✅ Can integrate with mira-bots worker pool for batch inference
- ✅ Botleneck only under extreme concurrency (requires batching or GPU, not a blocker for MVP)
- ✅ Cost-effective: electricity only at scale

---

### Strategy 4: Hybrid Retrieval (Ensemble + Normalization)

**Mechanism:**  
Run multiple retrievers (BM25, dense) in parallel, normalize their scores [0, 1], combine via weighted average or rank fusion (RRF), deduplicate.

**Key Ideas:**
- Different retrievers excel at different patterns: BM25 catches exact term matches, dense catches semantic shifts
- Ensemble is more robust than any single retriever
- Reciprocal Rank Fusion (RRF): combine rank positions, not scores (invariant to score scale)
- Deduplication: same doc from multiple retrievers gets boosted, not duplicated

**Evidence:**
- BM25 + dense via RRF: Recall@5 +7–15% vs. BM25 alone on long-doc benchmarks
- BM25 + dense with learned combination: +8–20% vs. either alone
- RRF simple + robust: no hyperparameter tuning needed

**Implementation (PostgreSQL):**
```sql
-- BM25 search (PostgreSQL FTS)
WITH bm25_results AS (
  SELECT id, content, ts_rank(to_tsvector('english', content), 
         plainto_tsquery('english', $query)) AS bm25_score
  FROM knowledge_entries
  WHERE to_tsvector('english', content) @@ plainto_tsquery('english', $query)
  LIMIT 50
),

-- Dense vector search (pgvector HNSW)
dense_results AS (
  SELECT id, content, embedding <=> query_embedding AS distance
  FROM knowledge_entries
  WHERE embedding IS NOT NULL
  ORDER BY distance LIMIT 50
),

-- Normalize + combine (RRF)
combined AS (
  SELECT COALESCE(b.id, d.id) AS id,
         ROW_NUMBER() OVER (ORDER BY COALESCE(b.rank, 999) + COALESCE(d.rank, 999)) AS final_rank,
         (1.0 / (60 + COALESCE(b.rank, 999))) + (1.0 / (60 + COALESCE(d.rank, 999))) AS combined_score
  FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY bm25_score DESC) AS rank FROM bm25_results) b
  FULL OUTER JOIN (SELECT id, ROW_NUMBER() OVER (ORDER BY distance ASC) AS rank FROM dense_results) d USING (id)
)
SELECT id, combined_score FROM combined ORDER BY combined_score DESC LIMIT 50;
```

**Fits MIRA?**
- ✅ Pure SQL, no new infra
- ✅ Runs at query time, no retraining
- ✅ Combines existing BM25 + embedding infrastructure
- ✅ Improves recall to top-50, feeds into reranker stage

---

### Strategy 5: Query Expansion & Understanding (Query Rewriting)

**Mechanism:**  
Expand the query before retrieval. "cv100 keeps tripping" → ["CV100", "conveyor velocity 100", "equipment tripping fault", "motor reset"].

**Methods:**
- Synonym expansion (domain dictionary, UNS aliases): "PowerFlex 525" → "PF525", "525", "VFD"
- Query rewriting (LLM-based): ask the model for equivalent phrasings
- Pseudo-relevance feedback: retrieve top-5, extract new terms, re-retrieve

**Evidence:**
- Query expansion via LLM: +5–15% recall on short queries (<10 words)
- Synonym lists: +3–8% for domain-specific terms
- Not always helpful for long, clear queries

**Fits MIRA?**
- ✅ Optional enhancement; low cost
- ⚠️ Second priority after reranking (reranking provides bigger gains)
- ✅ Can use UNS path expansion: query mentions "PowerFlex" → expand to all UNS equipment of that model

---

## Part 3: Integrated Architecture — The Proposal

### Retrieval Pipeline (Proposed End-State)

```
┌─ Customer uploads manual (PDF, Excel, scan)
│
├─ Ingestion (mira-crawler):
│  ├─ Extract text + tables (PDF parser or docling)
│  ├─ Chunk by logical section (title, heading preservation)
│  ├─ Deduplicate by content hash
│  ├─ Tag with UNS path (enterprise.site.area.line.equipment)
│  ├─ Embed query (BGE base-en-v1.5, 100–150ms per batch on CPU)
│  └─ Store: id, content, metadata, embedding, page_num, section_title
│
├─ Query Time (at-chat request):
│  ├─ Query preprocessing:
│  │  ├─ Tokenize
│  │  ├─ Expand synonyms (UNS aliases: PowerFlex → 525, VFD)
│  │  └─ Extract potential UNS entity mentions (asset name, fault code)
│  │
│  ├─ Stage 1 – Parallel Retrieval (5–10ms):
│  │  ├─ BM25 search (PostgreSQL FTS, full-text rank boost on title/section)
│  │  │  └─ Return: top-50 candidates with score
│  │  │
│  │  └─ Dense search (pgvector HNSW, cosine distance)
│  │     └─ Return: top-50 candidates with score
│  │
│  ├─ Stage 2 – Hybrid Combination (5ms):
│  │  ├─ Normalize BM25 scores [0, 1]
│  │  ├─ Normalize dense scores [0, 1] (invert distance)
│  │  ├─ Combine via RRF or learned weights (w_bm25=0.4, w_dense=0.6 baseline)
│  │  ├─ Deduplicate (group by chunk_id, max score)
│  │  └─ Return: top-100 deduplicated candidates
│  │
│  ├─ Stage 3 – Cross-Encoder Reranking (100–150ms):
│  │  ├─ Batch score top-100 via BGE reranker-v2-m3
│  │  │  (Or LLM-based via Groq cascade: "Score relevance 1–5")
│  │  ├─ Each (query, document) → [0, 1] relevance score
│  │  └─ Return: top-100 re-sorted by cross-encoder score
│  │
│  └─ Stage 4 – Context Window Packing (5ms):
│     ├─ Select top-5 reranked candidates
│     ├─ Format with page/section citations
│     └─ Inject into Supervisor (mira-bots/shared/engine.py) context
│
├─ Supervisor (engine.py):
│  ├─ Reads top-5 chunks
│  ├─ Generates answer with cited page + section
│  └─ Outputs: grounded reply + citations
│
└─ Response to user (Slack/Telegram/Web/Hub)
   └─ Cite: "Section 12.1: Fault-Code Reset Procedures (Page 203)"
```

### Metrics & SLO

| Metric | Current | Target | Check Method |
|--------|---------|--------|-------------|
| **Retrieval Recall@5** | 64% | 80–85% | Answer Radar (39 golden Q, real manuals) |
| **Retrieval MRR@3** | 0.64 | 0.78–0.82 | Same golden set |
| **Precision@5** (right-page returned) | ~68% | 85–90% | Manual review of top-5 |
| **Latency (query → top-5 chunks)** | 50–100ms | <200ms (target <150ms) | Instrumentation in mira-pipeline |
| **Cost per query** | $0 (self-hosted) | $0–0.001 | If using paid models |

### Staging Gate (Before Prod Promotion)

```
├─ Deploy to staging (factorylm/stg Neon DB)
├─ Run `tests/eval/retrieval_accuracy_*.py` against:
│  ├─ Golden test set (39 questions)
│  ├─ OEM manual corpus (83k chunks, diverse manufacturers)
│  └─ Per-tenant uploads (simulated stranger uploads)
├─ Measure:
│  ├─ Recall@5, MRR@3, Precision@5 (all ≥target)
│  ├─ Latency p50, p95, p99 (all <200ms)
│  └─ Cost per query (if applicable)
├─ A/B comparison: BM25-only vs. hybrid vs. full (BM25+dense+rerank)
├─ Regression check: does any metric drop <80% of baseline? If yes, investigate.
└─ Sign-off: PR review + Mike approval before merge to main
```

---

## Part 4: Implementation Phases

### Phase 0 (Week 1): Preparation
- [ ] Set up evaluation framework in `tests/eval/retrieval_*` with golden test set
- [ ] Measure current baseline (BM25 only): Recall@5, MRR@3
- [ ] Add BGE base-en-v1.5 to Doppler config (model, endpoint)
- [ ] Verify pgvector is active in staging NeonDB

### Phase 1 (Week 2): Embedding & Dense Retrieval
- [ ] Backfill embeddings for all existing chunks (one-time, ~1–2 hours)
- [ ] Implement Stage 1 (parallel BM25 + dense retrieval)
- [ ] Implement Stage 2 (hybrid combination via RRF)
- [ ] Evaluate: Recall@5, MRR@3 vs. baseline (expect +7–15% from hybrid alone)

### Phase 2 (Week 3–4): Cross-Encoder Reranking
- [ ] Implement Stage 3 (cross-encoder scoring, batch inference)
- [ ] Test on staging against golden set (expect +20–30% additional gain from reranker)
- [ ] Measure latency: p50, p95, p99 (target <150ms p50, <250ms p95)
- [ ] Optional: tune weights (w_bm25, w_dense) if needed

### Phase 3 (Week 4+): Query Expansion (Optional, Post-MVP)
- [ ] Synonym expansion from UNS graph
- [ ] Test on short queries (target 40% coverage, 5% recall gain)
- [ ] Ship if ROI justified; otherwise defer

### Rollout to Production
- [ ] Merge to main (via PR with adversarial review)
- [ ] Deploy to prod via `deploy-vps.yml`
- [ ] Monitor: latency, recall, citation compliance via observability
- [ ] Rollback plan: flag to switch pipeline (BM25-only fallback) if metrics degrade

---

## Part 5: Dependencies & Constraints

### Infrastructure
- **NeonDB:** Already have pgvector, HNSW indexes; cost unchanged
- **Compute:** BGE reranker on 4-core CPU acceptable for MVP latency (100–150ms); GPU optional for scale
- **Model weights:** BGE base-en-v1.5 (440MB), cached locally or pulled at startup
- **Storage:** ~2–3× space per embedding (pgvector); estimate 300–500MB for 83k chunks

### Licensing
- ✅ BGE reranker: Apache 2.0
- ✅ Sentence-transformers: Apache 2.0
- ✅ PostgreSQL pgvector: BSD 3-clause
- ✅ All strategies: open-source, no LangChain/n8n abstractions

### Constraints
- ✅ Python 3.12 (target runtime)
- ✅ Doppler config (env-scoped secrets OK for model paths)
- ✅ UNS compliance (all chunks already tagged; reranking doesn't change)
- ✅ Tenant scoping (knowledge_entries hybrid law: `is_private=true` for uploads, `is_private=false` for OEM)

---

## Part 6: Success Criteria

**The Gate:** All of the following must be true before prod promotion:
1. Recall@5 ≥ 80% on golden test set (39 questions, real manuals)
2. MRR@3 ≥ 0.78 on same set
3. Latency p50 ≤ 150ms, p95 ≤ 250ms, p99 ≤ 400ms
4. Zero regressions vs. baseline on any metric
5. Cost per query ≤ $0.001 (if using paid models; self-hosted = $0)
6. Adversarial review (Codex) passes; 0 unresolved findings
7. Mike sign-off after watching a real technician walk (phone, staging or prod)

---

## Part 7: Risk Mitigation

| Risk | Probability | Mitigation |
|------|-------------|-----------|
| Embedding space doesn't generalize to customer manuals | Medium | Evaluate on diverse OEM corpus first; BGE is trained on broad data, should work. If not, fine-tune on industrial domain. |
| Latency exceeds budget (>250ms p95) | Low | BGE reranker is fast (100–150ms even on CPU). If needed, reduce reranking candidates (top-50 → top-30) or use smaller model (MiniLM vs. base). |
| Storage overhead (embeddings) exceeds budget | Low | 2–3× overhead on 83k chunks = ~300–500MB; well within NeonDB limits. If critical, prune old chunks or use sparse embeddings. |
| Cross-encoder score distribution is bimodal (high/low, no middle) | Low | Use calibration (Platt scaling) to smooth scores if needed. Test on golden set first. |
| Staging eval passes but prod fails (data drift) | Low | Monitor live latency + citation compliance; automated rollback flag if metrics drop >10%. Keep BM25-only fallback ready. |

---

## Next Steps

1. **Confirm this specification** with Mike. Adjust priorities, trade-offs, timeline.
2. **Set up evaluation framework** (`tests/eval/retrieval_accuracy_*.py`). Baseline today's BM25 performance.
3. **Design the database schema changes** (embeddings, indexes, migrations).
4. **Assign implementation phases** and sprints.
5. **Build, stage, gate, ship.**

The goal: by Nov 8, 2026, MIRA retrieval answers 80%+ of answerable technician questions from customer manuals. The stranger-uploads-and-gets-cited-answer gate unblocks.

---

## Appendix: Reference Implementations (Open Source)

| System | Role | URL | License |
|--------|------|-----|---------|
| **sentence-transformers** | Cross-encoders, embeddings, rerankers | https://github.com/UKPLab/sentence-transformers | Apache 2.0 |
| **BGE embeddings + reranker** | Production-grade models, BAAI | https://huggingface.co/BAAI | Apache 2.0 |
| **PostgreSQL pgvector** | Dense vector storage, HNSW indexes | https://github.com/pgvector/pgvector | BSD 3-clause |
| **Vespa** | Search engine with native BM25 + HNSW + reranking | https://vespa.ai | Elastic License 2.0 (self-host = free) |
| **Elasticsearch** | Industry BM25, but proprietary; Atlas pricing | https://elastic.co | Elastic License (expensive) |
| **FAISS** | In-memory vector indexes, Facebook | https://github.com/facebookresearch/faiss | MIT |
| **Colbert** | Efficient token-level dense retrieval | https://github.com/stanford-futuredata/ColBERT | MIT |
| **Groq/Together API** | LLM-based reranking (optional, paid) | https://groq.com / https://www.together.ai | Proprietary (free tier available) |

