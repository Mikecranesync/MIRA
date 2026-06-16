# Full System Diagnosis: Why MIRA Is Not Performing

## 1. INGESTION PIPELINE — WALKING THROUGH 22B-UM001

### What actually happens when the PowerFlex 40 manual is ingested

**Path 1 (URL ingest via `ingest_manuals.py`):**
```
URL → httpx download → pdfplumber.extract_text() per page
  → _clean_text() strips page numbers and URLs
  → _detect_sections() splits into (heading, body) pairs
  → chunk_blocks() splits bodies into 800-char windows
  → Ollama nomic-embed-text embeds each chunk (768-dim)
  → insert_knowledge_entry() writes to NeonDB
```

**Path 2 (local PDF via mira-crawler):**
```
PDF file → pdfplumber or Docling → blocks with page_num + section
  → chunk_blocks() splits into 2000-char windows
  → Ollama embed → store to NeonDB
```

### What is extracted
- Raw text from each PDF page (pdfplumber `extract_text()`)
- Section headings via heuristic (lines < 80 chars, title case, no trailing period)
- Page numbers

### What is LOST in extraction
1. **Table structure** — pdfplumber flattens tables into space-separated text. A specification table becomes prose with inconsistent spacing. The table-aware chunker we built today detects pipe/tab tables in the extracted text, but pdfplumber rarely produces clean pipe tables from PDFs. It produces space-aligned columns that our heuristic doesn't catch yet.

2. **Cross-references** — "See Table 3-1" or "Refer to Chapter 5" become dead text. No link is preserved between the referencing chunk and the referenced chunk.

3. **Document hierarchy** — Chapter → Section → Subsection → Table structure is flattened. A chunk from "Chapter 3 > Environmental Specifications > Table 3-1" is stored with at best `section: "Environmental Specifications"`. The parent chapter and table number are lost.

4. **Relationships between entities** — "Fault F002 is caused by auxiliary input loss" becomes text in a chunk. There is no structured link from entity F002 to entity "auxiliary input" to action "check wiring." These relationships exist only inside the chunk text, invisible to retrieval.

5. **Parameter cross-references** — "Set P036 (Output Frequency) to match your motor nameplate value. See P037 for acceleration time." P036 and P037 are not linked. P036's meaning is not extracted as a structured entity.

### What a chunk looks like in NeonDB right now

```sql
id:           uuid
tenant_id:    '78917b56-...'
content:      'Store within an ambient temperature range of -40…+85 °C\n(-40…+185 °F).\nStore within a relative humidity range of 0…95%...'
embedding:    [0.018, -0.019, ...] (768 floats)
manufacturer: 'Rockwell Automation'  -- after backfill; was empty before today
model_number: 'PowerFlex 40'         -- after backfill; was empty before today
source_url:   '22b-um001_-en-e.pdf'
source_page:  3
metadata:     {"chunk_index": 3, "section": "", "source_url": "22b-um001_-en-e.pdf"}
chunk_type:   'text'
```

### What relationships are preserved
- Chunk → source document (via source_url)
- Chunk → page number (via source_page)
- Chunk → section heading (via metadata, often empty)
- Chunk → equipment (via manufacturer + model_number, was empty until today's backfill)

### What is thrown away that GraphRAG would need
- Entity nodes: no `Device`, `FaultCode`, `Parameter`, `Procedure` entities
- Relationship edges: no `F002 → caused_by → aux_input_loss`
- Community structure: no document clustering or cross-manual relationships
- Hierarchical summaries: no chapter-level or document-level summaries

---

## 2. SCHEMA — IS IT WRONG FOR GRAPHRAG?

**The current schema is not wrong. It's incomplete.**

The `knowledge_entries` table is a flat vector store. GraphRAG needs a graph layer. These are not mutually exclusive.

GraphRAG implementations (Microsoft, LightRAG, nano-graphrag) all maintain **both**:
- A vector store for chunk-level retrieval (exactly what we have)
- A graph store for entity/relationship retrieval (what we don't have)

The typical GraphRAG schema adds:

```
entities (id, name, type, description, embedding)
  — type: Device, FaultCode, Parameter, Procedure, Spec

relationships (id, source_entity_id, target_entity_id, type, description)
  — type: caused_by, controls, requires, replaces, wired_to

communities (id, level, title, summary, embedding)
  — hierarchical clusters of related entities
```

**Can this coexist with knowledge_entries?** Yes. The graph layer sits alongside the vector store, not instead of it. The vector store handles "find chunks about ambient temperature." The graph layer handles "what parameters are related to fault F002?" Different query patterns, different retrieval paths, same underlying content.

**Does GraphRAG require complete re-ingestion?** Partially. The raw text chunks can be reused. The embeddings can be reused. But entity extraction and relationship mapping require a separate processing pass over the same text — typically using an LLM to extract structured triples from each chunk. This is a new pipeline step, not a replacement for the current pipeline.

---

## 3. WHAT IS ACTUALLY BROKEN RIGHT NOW — RANKED BY IMPACT

| Rank | Failure Mode | Impact | Status |
|------|-------------|--------|--------|
| 1 | **Nemotron 2048-dim embed vs 768-dim NeonDB** | Every NeonDB query failed with dimension mismatch | **Fixed this session** — bypassed Nemotron, using Ollama directly |
| 2 | **Stale conversation state (ELECTRICAL_PRINT + LC1D history)** | Every text query routed to PrintWorker, bypassing RAG entirely | **Fixed this session** — deleted stale states |
| 3 | **active.yaml missing from Docker image** | Prompt rules never loaded, fell back to hardcoded subset | **Fixed this session** — added COPY prompts/ to Dockerfiles |
| 4 | **Metadata-orphan chunks (empty manufacturer/model)** | 5,758 chunks untagged, wrong docs rank higher than correct ones | **Partially fixed** — backfilled 2,528 Rockwell chunks, 3,230 remain |
| 5 | **Vector similarity returns wrong manual** | "PowerFlex 40 temperature" returns PowerFlex 520 chunks at 0.845 | **Not fixed** — PF40 chunks exist but don't rank in top 5 |
| 6 | **No product-name ILIKE fallback** | LIKE search only triggers for fault codes, not product names like "PowerFlex 40" | **Not fixed** — easy extension of Phase 1 LIKE logic |
| 7 | **Dense vectors miss exact-match queries** | nomic-embed-text ranks semantically similar but wrong docs above exact matches | Structural — hybrid retrieval (tsvector) needed |
| 8 | **No confidence threshold** | Retrieval at 0.4 similarity treated same as 0.9 | Not fixed — need minimum similarity cutoff |
| 9 | **PDF extraction quality** | pdfplumber loses table structure, column alignment, cross-references | Partially addressed by table-aware chunker, but root issue is in extraction |
| 10 | **No query normalization** | expand_abbreviations() exists but isn't used in the Ollama embed path | Not wired |

**The honest assessment:** Failures #1-3 were deployment bugs, not architecture problems. They're fixed. Failure #4-6 are data quality issues fixable this week. Failures #7-10 are real architectural gaps that hybrid retrieval and better extraction would address.

---

## 4. GRAPHRAG READINESS ASSESSMENT

### Microsoft GraphRAG (MIT license)

**What it requires:**
- Python, LLM API for entity extraction (Claude works), embedding model
- Builds entities + relationships + community summaries from text
- Stores in a graph format (typically Parquet files or Neo4j)
- Query modes: local (entity-centric) and global (community summaries)

**Can it run on 16GB arm64?**
Indexing (entity extraction) is LLM-bound, not RAM-bound — it sends chunks to Claude/GPT for structured extraction. That works fine. The graph storage is small (entities + relationships, not vectors). Community summarization is LLM-bound too.

The RAM concern is overstated. Microsoft GraphRAG's RAM usage comes from loading large graph structures for global queries. For 25 manuals (~30K chunks, maybe 50K entities), this fits comfortably in 16GB.

**The real cost:** Indexing is EXPENSIVE in LLM tokens. Every chunk gets sent to the LLM for entity extraction. 30K chunks × ~500 tokens each = ~15M input tokens. At Claude Sonnet rates ($3/M input), that's ~$45 for a single indexing pass. Every re-index costs the same.

**Verdict:** Viable but expensive to index. Query-time is cheap.

### LightRAG (MIT license)

**What it is:** Simplified GraphRAG — extracts entities + relationships via LLM, stores in a lightweight graph (NetworkX or Neo4j), supports hybrid vector + graph retrieval.

**Better fit than Microsoft GraphRAG because:**
- Simpler architecture (no community detection, no global query mode)
- Lower indexing cost (extracts relationships, not full community hierarchies)
- Supports incremental indexing (add new documents without reprocessing all)
- Works with any LLM API (Claude, local Ollama)
- NetworkX graph fits entirely in memory for our scale

**Runs on 16GB arm64?** Yes. NetworkX graph for 50K entities uses ~100MB. Embeddings are already in NeonDB.

**Verdict:** Best fit for MIRA's scale and constraints.

### nano-graphrag (MIT license)

**What it is:** Minimal reimplementation of Microsoft GraphRAG in ~800 lines.

**Pros:** Tiny, easy to understand, modify, and integrate.
**Cons:** Less maintained, fewer features, no incremental indexing.

**Verdict:** Good for learning, not for production.

### Build our own entity extraction layer

**What this means:** Use Claude to extract structured entities from chunks, store in Postgres tables alongside knowledge_entries, query both at retrieval time.

**Pros:** Full control, no new dependencies, uses existing infrastructure.
**Cons:** Building what LightRAG already built. 2-3 weeks of work vs. 2-3 days of integration.

**Verdict:** Only if LightRAG doesn't fit. It probably fits.

---

## 5. THE MIGRATION QUESTION

**If we ingest all 25 manuals now with naive RAG, what survives a GraphRAG migration?**

| Asset | Survives? | Why |
|-------|-----------|-----|
| Raw text chunks in knowledge_entries | **Yes** | GraphRAG entity extraction reads these same chunks |
| 768-dim embeddings | **Yes** | Vector retrieval is still used alongside graph retrieval |
| Metadata (manufacturer, model, section) | **Yes** | Enriches entity nodes |
| chunk_type tagging | **Yes** | Helps entity extraction focus on table vs prose chunks |
| Dedup hashes | **Yes** | Prevents re-processing already-indexed chunks |
| The chunks themselves (boundaries) | **Maybe** | Graph extraction works on any chunk size, but re-chunking may improve entity extraction quality |

**What has to be thrown away?** Nothing. GraphRAG adds entity/relationship tables alongside the existing vector store. The current knowledge_entries table becomes the chunk store that feeds entity extraction.

**What can be reused?** Everything. The entity extraction pipeline reads chunks from knowledge_entries, sends them to Claude for structured extraction, and writes entities + relationships to new tables. The existing chunks, embeddings, and metadata are inputs to this process, not replaced by it.

**Is there a schema design we can use TODAY that positions us for GraphRAG?**

Yes. Add two tables now (empty, ready for when entity extraction is built):

```sql
CREATE TABLE IF NOT EXISTS entities (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    entity_type TEXT NOT NULL,  -- Device, FaultCode, Parameter, Procedure, Spec
    description TEXT,
    source_chunk_ids TEXT[],    -- references back to knowledge_entries
    embedding vector(768),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS relationships (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    source_entity_id TEXT REFERENCES entities(id),
    target_entity_id TEXT REFERENCES entities(id),
    relationship_type TEXT NOT NULL,  -- caused_by, controls, requires, wired_to
    description TEXT,
    weight FLOAT DEFAULT 1.0,
    source_chunk_ids TEXT[],
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW()
);
```

These tables cost nothing to create. They don't change the current pipeline. When entity extraction is ready, it writes here. The retrieval layer queries both knowledge_entries (vector) and entities/relationships (graph) and merges results.

---

## 6. RECOMMENDATION

**C. Hybrid: ingest naive RAG now, build graph layer in parallel.**

Here is why, specifically:

**The naive RAG work is not wasted.** Every chunk, every embedding, every metadata tag feeds directly into GraphRAG entity extraction. The knowledge_entries table IS the chunk store that GraphRAG reads from. You are not building scaffolding that gets torn down — you are building the foundation layer that the graph layer sits on top of.

**The 2-week delay for GraphRAG-first is not worth it** because:
1. MIRA has zero working retrieval in production right now. The env vars were unset, Nemotron was breaking embedding, stale state was routing to the wrong worker. Before today, not a single user query ever hit NeonDB successfully. Shipping working naive RAG is the difference between "product that answers questions from manuals" and "product that hallucinates from training data."
2. Entity extraction requires a working chunk pipeline to extract FROM. You need the chunks ingested before you can extract entities from them. Naive RAG ingest is a prerequisite for GraphRAG, not an alternative to it.
3. The schema is compatible. knowledge_entries + entities + relationships can coexist in the same NeonDB database. No migration needed.

**What I would actually do, in order:**

1. **This week:** Fix the remaining retrieval issues (product-name ILIKE fallback, remaining metadata orphans, confidence threshold). Get naive RAG delivering correct answers for the PowerFlex 40 ambient temperature question. Ship it.

2. **Next week:** Create the empty entities + relationships tables in NeonDB. Write a proof-of-concept entity extraction script that sends 10 chunks from the PowerFlex 40 manual to Claude with a prompt like "Extract all devices, fault codes, parameters, and their relationships as structured JSON." Evaluate the quality. This costs ~$0.15 in tokens.

3. **Week 3:** If the PoC works, build the extraction pipeline as a batch job (like ingest_manuals.py) that processes all 30K chunks. Add a graph retrieval path in neon_recall.py that queries entities + relationships alongside vector search. Merge results with RRF.

4. **Week 4:** Evaluate whether LightRAG adds value over the custom entity extraction. If yes, integrate it. If the custom approach works well enough, skip it.

**The bottom line:** The current schema is not wrong. The current ingestion is not wasted. The current architecture is a valid foundation layer. The failures we found today were deployment and data quality bugs, not architectural flaws. Fix the bugs, ship naive RAG, build the graph layer on top.

---

## 7. OPEN-SOURCE GRAPHRAG OPTIONS — RESEARCH RESULTS

### Ranked by fit for MIRA

| Option | License | NeonDB Compatible | ARM64 | Incremental Index | Token Cost (30K chunks) | Integration Effort |
|--------|---------|-------------------|-------|-------------------|------------------------|--------------------|
| **Roll-your-own (kg_entities + kg_relationships)** | n/a | Yes | Yes | You implement | Low (~$30) | Low (2-3 days) |
| **LightRAG** | MIT | Partial (needs AGE for graph, or NetworkX fallback) | Yes | Yes (true incremental) | Medium (~$30-50) | Medium (1-2 weeks) |
| **Microsoft GraphRAG** | MIT | Manual Parquet→PG load | Yes | No (full re-index) | High (~$80-150) | High |
| **nano-graphrag** | MIT | No | Yes | Yes | Medium | High (no PG backend) |

### Recommendation: Roll-your-own NOW, LightRAG LATER

**Roll-your-own is the right first move** because:
1. Zero new dependencies — works on NeonDB today
2. No Apache AGE needed — graph traversal via recursive SQL CTEs
3. Entity types are domain-specific to industrial maintenance — no framework can define these for us
4. The schema IS what LightRAG would create, just without the framework overhead
5. We control the Claude extraction prompt for maintenance-domain entities

**LightRAG becomes relevant** when:
- The corpus exceeds ~100K entities and recursive CTEs get slow
- We need Cypher-style graph queries (requires AGE or Neo4j)
- We migrate off NeonDB to self-hosted Postgres (where AGE can be installed)

### The Schema to Add NOW (NeonDB-compatible)

```sql
CREATE TABLE IF NOT EXISTS kg_entities (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      TEXT NOT NULL,
    name           TEXT NOT NULL,
    entity_type    TEXT NOT NULL,
    description    TEXT,
    properties     JSONB DEFAULT '{}',
    embedding      VECTOR(768),
    source_chunk_ids TEXT[],
    created_at     TIMESTAMP DEFAULT now(),
    UNIQUE (tenant_id, name, entity_type)
);

CREATE TABLE IF NOT EXISTS kg_relationships (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      TEXT NOT NULL,
    src_entity_id  UUID REFERENCES kg_entities(id),
    tgt_entity_id  UUID REFERENCES kg_entities(id),
    relation_type  TEXT NOT NULL,
    description    TEXT,
    weight         FLOAT DEFAULT 1.0,
    properties     JSONB DEFAULT '{}',
    source_chunk_ids TEXT[],
    created_at     TIMESTAMP DEFAULT now()
);

CREATE INDEX ON kg_entities USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ON kg_entities (tenant_id, entity_type);
CREATE INDEX ON kg_relationships (tenant_id, src_entity_id);
CREATE INDEX ON kg_relationships (tenant_id, tgt_entity_id);
```

### MIRA-Specific Entity & Relationship Types

**Entity types** (from 2024 ACL maintenance ontology + ISA-95):
- `equipment` — PowerFlex 525, Micro820, GS20 VFD
- `component` — DC bus capacitor, IGBT module, keypad
- `fault_code` — F004, E7, Fault 13
- `parameter` — P033 (accel time), P036 (output freq)
- `procedure` — reset procedure, parameter restore
- `symptom` — overcurrent, overtemperature, no output
- `specification` — ambient temp 40°C, input voltage 480V
- `standard` — NFPA 70E, OSHA 1910.333
- `manufacturer` — Rockwell Automation, AutomationDirect

**Relationship types:**
- `HAS_FAULT` — Equipment → FaultCode
- `CAUSED_BY` — FaultCode → Component or Symptom
- `RESOLVED_BY` — FaultCode → Procedure
- `HAS_PARAMETER` — Equipment → Parameter
- `HAS_SPEC` — Equipment → Specification
- `PART_OF` — Component → Equipment
- `REQUIRES_STANDARD` — Procedure → Standard
- `MADE_BY` — Equipment → Manufacturer

### Graph Query via Recursive CTE (no AGE required)

```sql
-- "What causes fault F004 on the PowerFlex 525?"
WITH RECURSIVE traversal AS (
    SELECT e.id, e.name, e.entity_type, 0 AS depth
    FROM kg_entities e
    WHERE e.name = 'F004' AND e.entity_type = 'fault_code' AND e.tenant_id = :tid

    UNION ALL

    SELECT e2.id, e2.name, e2.entity_type, t.depth + 1
    FROM traversal t
    JOIN kg_relationships r ON r.src_entity_id = t.id
    JOIN kg_entities e2 ON e2.id = r.tgt_entity_id
    WHERE t.depth < 2
)
SELECT DISTINCT name, entity_type FROM traversal;
```

---

## 8. CONCRETE NEXT STEPS — THIS WEEK

### Priority 1: Fix retrieval for current naive RAG (today)
1. Extend ILIKE fallback to product names (not just fault codes) — "PowerFlex 40" should trigger keyword search
2. Backfill remaining 3,230 metadata orphans
3. Add similarity threshold (drop results below 0.5)

### Priority 2: Create graph-ready schema (tomorrow)
1. Run the `kg_entities` + `kg_relationships` CREATE TABLE DDL on NeonDB
2. Write a proof-of-concept entity extractor: send 10 PowerFlex 40 chunks to Claude with a maintenance-domain prompt
3. Evaluate extraction quality, tune the prompt

### Priority 3: Build extraction pipeline (this week)
1. Batch script that reads chunks from `knowledge_entries`, sends to Claude for entity extraction, writes to `kg_entities` + `kg_relationships`
2. Start with one manual (22B-UM001), validate quality, then run on all 25
3. Cost estimate: 30K chunks × ~500 tokens = ~15M tokens ≈ $45 at Sonnet rates

### Priority 4: Wire graph retrieval into RAG (next week)
1. Add `recall_graph()` function to `neon_recall.py` that queries `kg_entities` via embedding similarity + recursive CTE
2. Merge graph results with vector results using RRF
3. Test: "What causes fault F004 on the PowerFlex 525?" should return structured entity chain
