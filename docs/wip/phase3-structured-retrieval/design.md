# Phase 3: Structured Data Extraction + Agentic Retrieval

## Context

Today's session proved the RAG pipeline works end-to-end (F4 fault code, stop modes both answered correctly with citations). But we also proved that plain vector RAG hits a ceiling on industrial PDFs:

- **Fault codes**: ILIKE text search works but is slow and imprecise. F4 was found because the chunk happened to contain "F4 UnderVoltage" as substring. A proper `fault_codes` table would be deterministic and instant.
- **Spec tables**: The PF40 ambient temperature spec (50°C for IP20/NEMA Open) exists in NeonDB but the IVFFlat index won't reliably surface it via vector search alone. The product-name CTE workaround helps but is fragile.
- **Stateful diagnosis**: Every query hits the vector store cold. Step 1 of a troubleshooting procedure doesn't inform Step 2's retrieval.

The architectural document is right: the gap is not model size — it's **structured data extraction** and **agentic retrieval loops**.

## What Exists Today (built this session)

| Component | Status | Gap |
|-----------|--------|-----|
| Vector retrieval (pgvector) | Working | IVFFlat filter returns fewer results than LIMIT |
| Fault code ILIKE | Working | Text search on chunk content, not structured lookup |
| Product-name search | Working | CTE workaround for IVFFlat, still only 2 hits |
| Table-aware chunking | Built, deployed | pdfplumber still flattens most tables to prose |
| Docling extraction | Working on Bravo | 499 new PF40 chunks, but no pipe-table markdown produced |
| Metadata backfill | Done (2,528 chunks) | 3,230 orphans remain |
| Intent classifier | Expanded (80+ keywords) | Working |
| Source citation (Rule 16) | Deployed | Working |

## Phase 3A: Fault Code Extraction → Structured Table (This Week)

### What
Extract fault codes from all knowledge_entries chunks into a dedicated `fault_codes` table. Deterministic lookup replaces ILIKE text search.

### Schema
```sql
CREATE TABLE IF NOT EXISTS fault_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    code TEXT NOT NULL,            -- F4, E001, OC1, etc.
    description TEXT NOT NULL,     -- "UnderVoltage"
    cause TEXT,                    -- "DC bus voltage below threshold"
    action TEXT,                   -- "Check input line fuse. Monitor incoming line."
    severity TEXT,                 -- "trip", "warning", "alarm"
    equipment_model TEXT,          -- "PowerFlex 40"
    manufacturer TEXT,             -- "Rockwell Automation"
    source_chunk_id TEXT,          -- FK back to knowledge_entries
    source_url TEXT,
    page_num INTEGER,
    created_at TIMESTAMP DEFAULT now(),
    UNIQUE (tenant_id, code, equipment_model)
);

CREATE INDEX ON fault_codes (tenant_id, code);
CREATE INDEX ON fault_codes (tenant_id, equipment_model);
```

### Extraction Approach
Use Claude to extract structured fault code data from chunks that match `_FAULT_CODE_RE`:

```python
# For each chunk containing fault code patterns:
prompt = """Extract all fault codes from this equipment manual text.
Return JSON array: [{"code": "F4", "description": "UnderVoltage",
"cause": "DC bus voltage below threshold",
"action": "1. Check input line fuse. 2. Monitor incoming line.",
"severity": "trip"}]
Only extract codes explicitly listed. Do not invent codes."""
```

Run as a batch job over the ~5,000 chunks that contain fault code patterns. Estimated cost: ~$5-10 at Sonnet rates.

### Retrieval Change
In `neon_recall.py`, add `recall_fault_code()`:
```python
def recall_fault_code(code: str, tenant_id: str, model: str = None) -> dict | None:
    """Deterministic fault code lookup. Returns structured data or None."""
    sql = "SELECT * FROM fault_codes WHERE tenant_id = :tid AND code = :code"
    if model:
        sql += " AND equipment_model ILIKE :model"
```

Wire into the RAG worker: if fault codes detected in query, hit `fault_codes` table FIRST, inject structured result into prompt context before vector search.

### Files to Modify
- `mira-core/mira-ingest/db/neon.py` — CREATE TABLE DDL, insert/query functions
- `mira-bots/shared/neon_recall.py` — add `recall_fault_code()`, wire into `recall_knowledge()`
- `tools/extract_fault_codes.py` — NEW batch extraction script (uses existing pipeline, not throwaway)

### Effort: M (2-3 days)

---

## Phase 3B: Agentic Retrieval Loop (Next Week)

### What
Replace single-shot RAG with a multi-step retrieval loop. The LLM decides what to retrieve next based on what it just learned.

### Current Flow (single-shot)
```
User query → embed → NeonDB top-5 → Claude → response
```

### Target Flow (agentic)
```
User query → classify intent → targeted retrieve (metadata-filtered)
  → Claude reads chunks, decides: "need more info about coil specs"
  → second retrieve with refined query + metadata filter
  → Claude generates diagnostic response
```

### Implementation
Modify `RAGWorker.process()` to support a 2-pass retrieval:

**Pass 1**: Current vector + ILIKE + product search (already built)
**Pass 2**: If Claude's response contains a retrieval request signal (e.g., confidence=LOW, or explicit "I need more information about X"), do a second targeted search with:
- Refined query text (extracted from Claude's response)
- Metadata filter (manufacturer + model from Pass 1)
- Different chunk_type filter (e.g., "only spec tables" or "only troubleshooting")

### Key Insight from Today
The conversation state already exists (`conversation_state` table with context JSON). The `asset_identified` field is set after the first interaction. Pass 2 can use `asset_identified` to filter retrieval to the correct manual.

### Files to Modify
- `mira-bots/shared/workers/rag_worker.py` — add second retrieval pass
- `mira-bots/shared/neon_recall.py` — add `recall_filtered()` with metadata filter params
- `mira-bots/shared/engine.py` — wire agentic loop into Supervisor

### Effort: M (3-4 days)

---

## Phase 3C: Section-Level Metadata Tagging (Parallel)

### What
Enrich every chunk with structured metadata: chapter, section_type, fault_type. Currently metadata is `{"chunk_index": N, "section": ""}` — mostly empty.

### Section Types
- `overview` — product description, features
- `installation` — mounting, wiring, grounding
- `configuration` — parameters, setup procedures
- `troubleshooting` — fault codes, diagnostic steps
- `specifications` — ratings, dimensions, environmental
- `maintenance` — lubrication, inspection, replacement
- `communications` — network setup, protocols

### Extraction Approach
Batch job: for each chunk, use Claude to classify section_type from content. Cheaper than fault code extraction (~$3 for 40K chunks at Haiku rates).

Alternatively, use heading heuristics from `_detect_sections()` in converter.py — "Chapter 4 Troubleshooting" → all chunks in that section get `section_type: "troubleshooting"`.

### Files to Modify
- `mira-core/mira-ingest/db/neon.py` — UPDATE metadata JSONB
- `mira-bots/shared/neon_recall.py` — add metadata filter to vector search WHERE clause
- `tools/tag_section_types.py` — NEW batch tagging script

### Effort: S (1-2 days)

---

## Phase 3D: Vision Extraction (Config 3 prep)

### What
Already on the roadmap. When a tech sends a photo, extract structured observations as JSON before hitting RAG. The VisionWorker already exists but sends raw base64 to the LLM.

### Target
```python
# Instead of: "here's a photo, what's wrong?"
# Extract: {"component": "contactor", "visible_damage": "burnt contacts", "model": "100-C23"}
# Then query: recall_knowledge(embed("burnt contactor contacts"), model="100-C23")
```

### Not this week — but prep work:
- Ensure `asset_identified` from vision worker feeds into RAG metadata filters
- The VisionWorker → RAGWorker handoff already exists in engine.py

---

## Verification

### Phase 3A (fault codes):
1. Run extraction on PF40 chunks → verify F2, F3, F4, F6, F7, F8, F13 all in `fault_codes` table
2. Query "What does F4 mean on PowerFlex 40?" → should return structured data in <100ms (no vector search needed)
3. Query "What does E001 mean?" on equipment not in fault_codes table → falls back to ILIKE chunk search

### Phase 3B (agentic retrieval):
1. Query "What is the ambient temperature rating for the PowerFlex 40?" →
   Pass 1: vector search returns generic VFD temp chunks
   Pass 2: metadata-filtered search on model_number=PowerFlex 40, section_type=specifications
   → returns the actual spec chunk with "IP20, NEMA/UL Type Open: -10…+50°C"

### Phase 3C (section tagging):
1. Verify >80% of chunks have non-empty section_type after batch tagging
2. Query with metadata filter `section_type='troubleshooting'` returns only troubleshooting content

## Priority Order

1. **3A Fault codes** — highest impact, proves the "structured data not vectors" thesis
2. **3C Section tagging** — enables metadata-filtered retrieval for 3B
3. **3B Agentic loop** — requires 3A and 3C to be useful
4. **3D Vision** — independent, can parallel with 3A-3C
