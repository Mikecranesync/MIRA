# MIRA RAG Pipeline — Recommendations Report

**Date:** 2026-03-27
**Branch:** feature/vim (13+ commits ahead of main)
**Session work:** Phase 1 LIKE fallback, Phase 2 table-aware chunking, Rule 15 uncertainty guard
**Test status:** 55 passing, 0 regressions

---

## 1. IMMEDIATE — Fix Before Anything Else

### 1a. Wire NEON_DATABASE_URL + MIRA_TENANT_ID into deployed bot containers

**What:** The docker-compose.yml for bots already declares `NEON_DATABASE_URL=${NEON_DATABASE_URL:-}` and `MIRA_TENANT_ID=${MIRA_TENANT_ID:-}`. If Doppler has these keys and you start with `doppler run -- docker compose up -d`, they should propagate. The bug is one of:
- Doppler `factorylm/prd` doesn't have these keys set
- Bravo containers were started without `doppler run` (e.g., bare `docker compose up -d`)
- Containers were built/restarted after a `docker cp` deploy that didn't refresh env vars

**Why:** Every line of Phase 1-5 code is dead in production until this works. `neon_recall.recall_knowledge()` returns `[]` when URL is empty — the fail-open design that silently makes everything useless.

**Fix:**
1. SSH into Bravo → `doppler secrets get NEON_DATABASE_URL MIRA_TENANT_ID --project factorylm --config prd` — confirm they exist
2. If missing: `doppler secrets set NEON_DATABASE_URL="postgresql://..." MIRA_TENANT_ID="..."` (get values from NeonDB dashboard)
3. Restart: `doppler run --project factorylm --config prd -- docker compose up -d`
4. Verify: `docker exec mira-bot-telegram env | grep NEON` — must show the full connection string
5. Send a test query via Telegram, check logs for `NEON_RECALL hits=N` where N > 0

**Effort:** S (30 minutes)
**Dependency:** NeonDB dashboard access, Doppler admin
**Risk:** If Bravo's keychain is locked, `doppler run` will fail. Use `doppler configure set token-storage file` (already done on Bravo per CLAUDE.md).

### 1b. Also wire NEON_DATABASE_URL into mira-ingest container

**What:** `mira-core/docker-compose.yml` does NOT pass `NEON_DATABASE_URL` to the `mira-ingest` service. If `check_tier_limit()` or `insert_knowledge_entry()` is ever called, it raises `RuntimeError("NEON_DATABASE_URL not set")`.

**Why:** The ingest service can't write to NeonDB from within Docker. The `ingest_manuals.py` script must run outside Docker (where Doppler injects the var) or the compose file needs the env var added.

**Fix:** Add `- NEON_DATABASE_URL=${NEON_DATABASE_URL:-}` and `- MIRA_TENANT_ID=${MIRA_TENANT_ID:-}` to the mira-ingest environment block in `mira-core/docker-compose.yml`.

**Effort:** S (5 minutes)
**Dependency:** None

### 1c. Verify NeonDB knowledge_entries has data

**What:** Even with env vars wired, retrieval returns `[]` if no rows exist for the tenant.

**Fix:** Run from a machine with NEON_DATABASE_URL set:
```sql
SELECT count(*), tenant_id FROM knowledge_entries GROUP BY tenant_id;
SELECT count(*) FROM knowledge_entries WHERE embedding IS NOT NULL;
```
If empty: run `ingest_manuals.py` against one manual (22B-UM001) and verify rows appear.

**Effort:** S (15 minutes)

---

## 2. QUICK WINS — This Week

### 2a. Log retrieval scores to SQLite for offline analysis

**What:** `neon_recall.py` already logs `NEON_RECALL top_vector_score=X.XXX` to stderr but doesn't persist it. Add a `retrieval_log` table to the shared mira.db:

```sql
CREATE TABLE IF NOT EXISTS retrieval_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT,
    query TEXT,
    retrieval_path TEXT,     -- vector_only | like_augmented | like_forced
    top_vector_score REAL,
    hit_count INTEGER,
    fault_codes TEXT,         -- JSON array
    response_time_ms INTEGER,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**Why:** Without this, you can't answer "what queries are failing?" or "what's the average retrieval quality?" You need this data before Phase 3 (hybrid retrieval) to know what to optimize.

**Effort:** S (1-2 hours)
**Dependency:** None

### 2b. Add a smoke test for end-to-end NeonDB retrieval

**What:** Add a test to `install/smoke_test.sh` that:
1. Checks `NEON_DATABASE_URL` is set
2. Runs a simple SQL query: `SELECT count(*) FROM knowledge_entries WHERE tenant_id = $MIRA_TENANT_ID`
3. Asserts count > 0
4. Optionally embeds a test query and checks cosine similarity returns results

**Why:** The current smoke test checks container health but not actual retrieval capability. You deployed correct code that returned `[]` for weeks.

**Effort:** S (1 hour)

### 2c. Lower the fail-open silence in neon_recall.py

**What:** When `NEON_DATABASE_URL` is empty, `recall_knowledge()` returns `[]` with zero logging. Add a `logger.warning()` on the first call:

```python
if not url:
    if not getattr(recall_knowledge, '_warned', False):
        logger.warning("NEON_DATABASE_URL not set — NeonDB recall disabled, using Open WebUI only")
        recall_knowledge._warned = True
    return []
```

**Why:** Silent failure is the root cause of this going undetected. One warning per process startup is enough.

**Effort:** S (10 minutes)

### 2d. Merge feature/vim to main

**What:** The branch is 13+ commits ahead of main with tested, working code. The longer it stays unmerged, the harder the merge becomes.

**Why:** All production deploys presumably come from main. Nothing lands in prod until this merges.

**Effort:** S (30 minutes)
**Risk:** Check for merge conflicts first with `git merge-tree $(git merge-base main feature/vim) main feature/vim`

---

## 3. RETRIEVAL ARCHITECTURE — Phase 3 Priority

### Recommended: PostgreSQL tsvector + GIN index + RRF fusion

**What:** Add a `content_tsv tsvector` generated column to `knowledge_entries`, create a GIN index, and implement Reciprocal Rank Fusion (RRF) to merge vector and keyword results.

**Why this over BM25:** NeonDB is Postgres. `tsvector` is built-in, zero dependencies, runs entirely in the database. BM25 would require either:
- `pg_bm25` extension (not available on NeonDB managed Postgres)
- Application-side BM25 (requires loading all candidate documents into memory — won't scale)
- A separate search service like Meilisearch/Typesense (adds a container, violates "one service per container" spirit)

**Implementation:**

1. Schema migration (run once against NeonDB):
```sql
ALTER TABLE knowledge_entries
    ADD COLUMN IF NOT EXISTS content_tsv tsvector
    GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;

CREATE INDEX IF NOT EXISTS idx_knowledge_entries_tsv
    ON knowledge_entries USING GIN (content_tsv);
```

2. New function in `neon_recall.py`:
```python
def recall_keyword(query: str, tenant_id: str, limit: int = 10) -> list[dict]:
    """Full-text search using tsvector + GIN index."""
    sql = """
        SELECT content, manufacturer, model_number, source_url,
               ts_rank_cd(content_tsv, plainto_tsquery('english', :q)) AS rank
        FROM knowledge_entries
        WHERE tenant_id = :tid
          AND content_tsv @@ plainto_tsquery('english', :q)
        ORDER BY rank DESC
        LIMIT :lim
    """
```

3. RRF fusion in `rag_worker.py`:
```python
def _rrf_merge(vector_results, keyword_results, k=60):
    """Reciprocal Rank Fusion: score = sum(1 / (k + rank_i))"""
    scores = {}
    for rank, doc in enumerate(vector_results):
        key = doc["content"][:100]
        scores[key] = scores.get(key, 0) + 1 / (k + rank)
    for rank, doc in enumerate(keyword_results):
        key = doc["content"][:100]
        scores[key] = scores.get(key, 0) + 1 / (k + rank)
    return sorted(scores.items(), key=lambda x: -x[1])
```

**Risks:**
- **NeonDB generated columns:** Verify NeonDB supports `GENERATED ALWAYS AS ... STORED` — standard Postgres 12+ does, but managed services sometimes restrict DDL. If blocked, use a trigger-based approach instead.
- **GIN index build time:** On 10K rows, seconds. On 100K+, minutes. Run during off-hours.
- **Query language:** `plainto_tsquery` handles natural language. For exact fault codes like "F004", also use `to_tsquery` with explicit AND/OR syntax.
- **Token cost:** Zero — this runs entirely in Postgres.

**Effort:** M (1-2 days)
**Dependency:** NeonDB admin access for DDL

### Alternative considered: pgvector HNSW index

Currently uses IVFFlat (implicit). HNSW gives better recall at the cost of more memory. Not the bottleneck right now — the problem is keyword queries, not vector quality.

### Alternative considered: Local pgvector (migration target)

CLAUDE.md mentions migrating off NeonDB to local pgvector. This is the right long-term call for a factory environment (no cloud dependency), but don't do it now. Get hybrid retrieval working on NeonDB first, then the same SQL works on local Postgres with pgvector extension.

---

## 4. KNOWLEDGE BASE QUALITY

### 4a. Metadata tagging: add manufacturer + model_number extraction

**What:** `ingest_manuals.py` currently receives `manufacturer` and `model` from the NeonDB `manual_cache` / `manuals` table rows. But `chunker.py`'s `_extract_equipment_id()` only gets model numbers from filenames. Many manuals have generic filenames like `22B-UM001.pdf`.

**Fix:** Add a `_extract_manufacturer_model(text, filename)` helper that:
1. Checks first 2 pages for patterns like "PowerFlex 40", "Allen-Bradley", "Rockwell Automation"
2. Uses a lookup table of known manufacturers → regex patterns
3. Falls back to filename extraction

**Why:** Manufacturer-filtered retrieval (already in `neon_recall.py`) only works if the field is populated.

**Effort:** M (half day)

### 4b. Deduplication: chunk-level content hashing

**What:** Current dedup is `(source_url, chunk_index)` — same URL + same chunk position = duplicate. This misses:
- Same content ingested from different URLs (e.g., manual hosted on both Rockwell and a distributor site)
- Re-ingestion after chunking logic changes (old chunks have different boundaries than new ones)

**Fix:** Add a `content_hash` column (SHA-256 of first 500 chars of content). Check before insert. This is lightweight and catches the 90% case.

**Effort:** S (2 hours)

### 4c. Version conflicts: manual revision tracking

**What:** The PowerFlex 40 manual has revision dates (e.g., "Publication 22B-UM001J-EN-P — January 2020"). If both revision H and revision J are ingested, conflicting specs may appear in retrieval.

**Fix:**
1. Extract publication number + revision from first page text (regex: `Publication\s+(\S+)`)
2. Store in metadata: `{"publication": "22B-UM001J-EN-P", "revision": "J"}`
3. At retrieval time: if multiple chunks from different revisions match, prefer the latest revision

**Effort:** M (1 day)
**Dependency:** Needs a revision comparison function (alphabetical works for Rockwell's A-Z scheme)

### 4d. Section header extraction: already exists, needs improvement

**What:** `converter.py` has `_detect_sections()` that finds headings via heuristics (short lines, title case, no trailing punctuation). This works for clean PDFs but misses:
- Numbered sections ("3.2.1 Environmental Specifications")
- ALL CAPS headers common in industrial manuals
- Headers that are long (>80 chars truncation rule cuts them)

**Fix:** Relax the heuristics: detect numbered section patterns, raise the char limit for headers to 120, add ALL CAPS detection.

**Why:** Better section headers → better `section` metadata → better retrieval context ("this chunk came from Chapter 3: Environmental Specifications" vs "").

**Effort:** S (2-3 hours)

---

## 5. MIRA SYSTEM PROMPT

### Current state: 15 rules, v0.4 "table-guard"

The prompt is well-structured. Rules 1-14 cover Socratic dialogue, photo OCR, safety override, grounding, and proactive fault disclosure. Rule 15 (just added) covers incomplete spec tables.

### 5a. Add Rule 16: CITE YOUR SOURCE

**What:**
```
16. CITE YOUR SOURCE. When your answer is based on retrieved documentation, include
the source at the end of your reply: "[Source: {manufacturer} {model_number} manual,
{section}]". If you are answering from general knowledge because no retrieved documents
matched, say "Based on general knowledge — no specific documentation found for this
equipment." Do not mix sourced and unsourced information without distinguishing them.
```

**Why:** The technician needs to know whether MIRA's answer comes from the actual manual or from training data. This is the single biggest trust signal for a maintenance audience. It also makes retrieval failures visible to the user instead of invisible.

**Effort:** S (30 minutes)

### 5b. Add Rule 17: UNITS AND PRECISION

**What:**
```
17. UNITS AND PRECISION. Always include both metric and imperial units when they
appear in the source documentation. Never round or approximate specification values.
Report exactly what the documentation states: "40C (104F)" not "about 40 degrees."
```

**Why:** A technician setting a VFD parameter needs the exact value. Rounding creates liability.

**Effort:** S (10 minutes)

### 5c. Modify Rule 11: strengthen grounding enforcement

**What:** Rule 11 currently says "base your questions and knowledge ONLY on those documents." In practice, the LLM still pads with training data when retrieved context is thin. Strengthen to:

```
11. GROUND TO RETRIEVED CONTEXT. When the system provides reference documents with
your prompt, base your answer ONLY on those documents. If the retrieved documents
do not fully answer the user's question, say what you found and what is missing:
"The documentation shows X, but I don't have information about Y for this specific
model." NEVER fill gaps with generic technical knowledge that is not in the retrieved
documents.
```

**Why:** The PowerFlex 40 bug showed that "ONLY on those documents" is too weak — the LLM interpreted "only" as "primarily" and filled gaps. The explicit "NEVER fill gaps" instruction and the template for partial answers gives the LLM a concrete alternative to hallucinating.

**Effort:** S (15 minutes)

### 5d. Not recommended: more rules

The prompt is at 15 rules. Every additional rule increases the chance of rule conflicts and dilutes attention to critical rules. Rules 16 and 17 above are high-value; beyond that, focus on retrieval quality rather than prompt engineering. Better context in = better answers out.

---

## 6. OBSERVABILITY

### Current state

| What | Logged to stderr | Persisted | Gap |
|------|:---:|:---:|-----|
| Token counts | Yes | api_usage SQLite | Good |
| Response latency | Yes | api_usage SQLite | Good |
| Vector similarity scores | Yes | No | Need to persist |
| Retrieval path (vector/like/forced) | Yes | No | Need to persist |
| Retrieved chunk IDs | No | No | Critical gap |
| Query text | No | No | Needed for eval |
| Confidence score | Computed | Benchmark DB only | Not in prod |
| FSM state transitions | No | conversation_state | Need events |
| User satisfaction | No | feedback_log | Underused |

### 6a. Persist retrieval events to SQLite

**What:** Create `retrieval_events` table:

```sql
CREATE TABLE IF NOT EXISTS retrieval_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT,
    chat_id TEXT,
    query_text TEXT,
    query_rewritten TEXT,          -- after expand_abbreviations
    retrieval_path TEXT,           -- vector_only | like_augmented | like_forced
    top_vector_score REAL,
    hit_count INTEGER,
    fault_codes TEXT,              -- JSON array
    chunk_ids TEXT,                -- JSON array of returned chunk IDs
    chunk_scores TEXT,             -- JSON array of similarity scores
    response_confidence TEXT,      -- HIGH | MEDIUM | LOW
    response_time_ms INTEGER,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**Why:** This is your fine-tuning dataset. Every row is a (query, retrieved_chunks, response_quality) triple. Without it, you can't evaluate retrieval quality at scale, can't identify patterns in failures, and can't build regression tests from real queries.

**Effort:** M (half day)

### 6b. Wire Langfuse spans into production RAG flow

**What:** `langfuse_setup.py` defines `trace_rag_query()` with 4 spans (embed_query, vector_search, context_compose, llm_inference). But `RAGWorker.process()` doesn't call it in the production path — only in the benchmark path.

**Fix:** Wrap the production `process()` method's existing stages with the Langfuse span context managers. The telemetry module already handles the no-Langfuse case gracefully (returns no-op spans).

**Why:** Langfuse gives you a visual trace timeline for every query: how long embedding took, how long retrieval took, what was retrieved, what the LLM produced. This is the single best debugging tool for RAG pipelines.

**Effort:** S (2 hours)
**Dependency:** Set `LANGFUSE_SECRET_KEY` and `LANGFUSE_PUBLIC_KEY` in Doppler

### 6c. Log user feedback correlation

**What:** `Supervisor.log_feedback()` writes to `feedback_log` table. Currently stores `chat_id`, `feedback` (thumb up/down), `reason`. Add `last_query`, `last_retrieval_path`, `last_confidence` to correlate feedback with retrieval quality.

**Why:** A thumbs-down on a "like_forced" retrieval tells you the fault code fallback produced bad results. A thumbs-down on "vector_only" with `top_score=0.82` tells you the embedding missed something despite high confidence. Without correlation, feedback is noise.

**Effort:** S (1 hour)

---

## 7. RISKS AND TECHNICAL DEBT

### Risk 1: Silent fail-open makes quality invisible

**Severity:** Critical
**What:** Multiple components return graceful defaults when misconfigured:
- `neon_recall.recall_knowledge()` returns `[]` if NEON_DATABASE_URL is empty
- `InferenceRouter.complete()` returns `("", {})` on any error, falls back to Open WebUI
- `check_tier_limit()` returns `(True, "")` on DB errors
- Langfuse spans silently no-op if credentials are missing

The system appears to work — the bot responds, the tests pass — but the entire RAG pipeline is bypassed. You shipped correct code that never executed for the entire Phase 1 development cycle.

**Mitigation:**
1. (Quick win 2c) Add startup warnings for critical missing env vars
2. (Quick win 2b) Add smoke test that verifies actual retrieval returns non-empty results
3. Add a `/status` command to the bot that reports: NeonDB connected (yes/no), knowledge entries count, Langfuse connected (yes/no), inference backend (claude/local)

### Risk 2: Single-tenant architecture with hardcoded tenant ID

**Severity:** Medium (blocks Config 7 enterprise)
**What:** `MIRA_TENANT_ID` is a single env var shared across all bot containers. All knowledge entries, all conversations, all retrieval — one tenant. The NeonDB schema supports multi-tenant (`WHERE tenant_id = :tid`) but the deployment doesn't.

**Impact on enterprise:** Config 7 needs per-customer tenants. Current architecture requires deploying a separate set of containers per customer, each with its own `MIRA_TENANT_ID`. This doesn't scale past 3-5 customers.

**Mitigation (defer to Config 5+):** Tenant routing at the bot adapter level: extract tenant from conversation metadata (Slack workspace ID, Teams tenant ID), look up in a `tenants` table, pass per-request instead of per-process.

### Risk 3: No offline fallback for factory floor

**Severity:** High (for production factory use)
**What:** MIRA requires:
- Internet → NeonDB (cloud Postgres)
- Internet → Anthropic API (Claude inference)
- LAN → Ollama on Bravo (embedding + vision)

A factory with intermittent internet (common) loses both retrieval and inference. The technician gets nothing.

**Mitigation path:**
1. (Phase 3+) Migrate NeonDB to local pgvector on Bravo — removes cloud dependency for retrieval
2. (Phase 3+) Add `INFERENCE_BACKEND=local` fallback that routes to Ollama qwen2.5 when Claude API is unreachable
3. (Long-term) Cache frequently-accessed knowledge chunks locally in SQLite with pre-computed embeddings — enables fully offline retrieval for the most common queries

---

## 8. LONG-TERM ARCHITECTURE — Config 7 (Enterprise)

### Decisions that ACCELERATE enterprise

| Decision | Why it helps |
|----------|-------------|
| Tenant-scoped NeonDB schema | Multi-tenant from day 1, no migration needed |
| Doppler for secrets | Per-customer configs possible via Doppler environments |
| MCP tools (equipment_status, fault_history) | Equipment abstraction layer ready for CMMS integration |
| Conventional commits + monorepo | Single release artifact, clean changelog for customers |
| Container-per-service | Each component independently scalable and replaceable |
| Prompt versioning (active.yaml) | A/B testing per customer, rollback capability |

### Decisions that BLOCK enterprise

| Decision | Why it blocks | Fix |
|----------|--------------|-----|
| Single MIRA_TENANT_ID env var | Can't serve multiple customers from one deployment | Per-request tenant routing (M) |
| SQLite for conversation state | File lock under concurrent load, not shared across replicas | Migrate to Postgres conversation table (M) |
| Hardcoded Ollama URLs | Each customer site has different infra | Service discovery or config per tenant (S) |
| No auth on bot → engine path | Any process on bot-net can call the engine | Add JWT or mTLS between containers (M) |
| No audit log | Enterprise customers require who-did-what-when | Add audit_events table + middleware (M) |
| NeonDB cloud dependency | Some enterprise customers prohibit cloud data | Local pgvector migration (L) |

### Recommended sequencing for enterprise readiness

1. **Now:** Fix env vars, merge to main, verify retrieval works in prod
2. **Phase 3:** Hybrid retrieval (tsvector), retrieval logging, Langfuse integration
3. **Phase 4:** Query normalization, source citation in responses
4. **Phase 5:** Agentic routing with mira-mcp tools
5. **Config 5:** Per-request tenant routing, SQLite → Postgres for state
6. **Config 6:** Local pgvector, offline fallback, audit logging
7. **Config 7:** CMMS integration, customer onboarding flow, usage-based billing hooks

---

## Priority Matrix

| # | Recommendation | Category | Effort | Impact | Do When |
|---|---------------|----------|--------|--------|---------|
| 1a | Wire NEON_DATABASE_URL in Doppler/containers | Immediate | S | Critical | Today |
| 1b | Add NEON_DATABASE_URL to mira-ingest compose | Immediate | S | High | Today |
| 1c | Verify NeonDB has knowledge data | Immediate | S | Critical | Today |
| 2c | Log warning when NeonDB URL missing | Quick win | S | High | This week |
| 2b | Smoke test for retrieval | Quick win | S | High | This week |
| 2d | Merge feature/vim to main | Quick win | S | High | This week |
| 5a | Rule 16: cite your source | Prompt | S | High | This week |
| 5c | Strengthen Rule 11 grounding | Prompt | S | Medium | This week |
| 2a | Persist retrieval scores to SQLite | Quick win | S | Medium | This week |
| 6b | Wire Langfuse into prod RAG flow | Observability | S | Medium | This week |
| 3 | tsvector + GIN + RRF hybrid retrieval | Architecture | M | High | Phase 3 |
| 4a | Manufacturer + model extraction | KB quality | M | Medium | Phase 3 |
| 4d | Improve section header detection | KB quality | S | Medium | Phase 3 |
| 6a | retrieval_events table | Observability | M | High | Phase 3 |
| 4b | Content hash dedup | KB quality | S | Low | Phase 4 |
| 4c | Manual revision tracking | KB quality | M | Medium | Phase 4 |
| 5b | Rule 17: units and precision | Prompt | S | Low | Phase 4 |
| 6c | Feedback-retrieval correlation | Observability | S | Medium | Phase 4 |
