<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

# ok have claude develop the .pdf or document ingest pipe for MIRA i dont think it is well defined yet have him explore the codebase and then extract all useful manuals and run them through the same system mira will use to put documents in the kb neondb that we will use. this will eventually and simultaneously hook up to all thin layer clients as their document analysis injest pipe so create a prd to add all this

Here's the prompt to paste into Claude Code:

***

```
Explore + PRD: MIRA Document Ingest Pipeline — Full Definition

Goal
Audit the entire codebase to understand what document ingest 
infrastructure already exists, then write a complete PRD for a 
production-grade document ingest pipeline that:
1. Ingests PDFs and documents from Google Drive and local sources
2. Chunks, embeds, and stores in NeonDB (pgvector)
3. Serves as the shared knowledge base for ALL thin-layer clients
   (Telegram bot, Slack bot, Open WebUI, Node-RED, future clients)
4. Starts immediately by ingesting the VFD manuals already on gdrive2tb

═══════════════════════════════════════════════════════════
PHASE 1 — CODEBASE AUDIT
═══════════════════════════════════════════════════════════

Search the entire repo for anything related to document ingest:
- mira_seed.py — what does it do exactly?
- mira_ingest container — what is its current role?
- Any existing chunking, embedding, or vector store code
- Any NeonDB / pgvector connection code
- Any PDF parsing utilities (PyPDF2, pdfplumber, pymupdf etc.)
- Any RAG retrieval code — how does it query the KB?
- Any existing document schemas or metadata models
- docker-compose.yml — what ports/volumes does mira-ingest expose?
- Any .env or Doppler secrets related to NeonDB or embeddings
- Current embedding model in use (OpenAI, local, Claude?)
- How do the bots currently retrieve context for responses?

Report:
- What exists and works today
- What is stubbed or incomplete
- What is completely missing
- Exact file paths and key function signatures

═══════════════════════════════════════════════════════════
PHASE 2 — DEFINE THE FULL INGEST PIPELINE PRD
═══════════════════════════════════════════════════════════

Write a complete PRD for tools/ingest_pipeline.py and supporting
infrastructure. Cover every section below:

──────────────────────────────────────────────────────────
2.1 SOURCES (where documents come from)
──────────────────────────────────────────────────────────
- Google Drive via rclone (gdrive2tb remote, configured + working)
  Priority folders:
    "VFD manual pdfs"         ← start here, already on gdrive2tb
    "factorylm-archives"      ← check for relevant docs
  Future: local folder watch, email attachments, Telegram file drops
- File types supported: PDF (priority), DOCX, TXT, XLSX, images with text
- Each source gets a source_id tag for traceability

──────────────────────────────────────────────────────────
2.2 EXTRACTION (getting text out)
──────────────────────────────────────────────────────────
- PDF text extraction: pdfplumber (primary), pymupdf (fallback)
- Scanned PDF / image fallback: Claude Vision OCR
- DOCX: python-docx
- Tables: extract as structured markdown, not raw text
- Preserve: page numbers, section headers, document title
- Skip: cover pages, blank pages, purely decorative pages

──────────────────────────────────────────────────────────
2.3 CHUNKING STRATEGY
──────────────────────────────────────────────────────────
For industrial manuals specifically:
- Chunk size: 512 tokens (target), 768 max
- Overlap: 10% (preserve context across chunks)
- Chunk boundaries: prefer section headers and paragraph breaks
- Never split: tables, numbered steps, warning/caution blocks
- Each chunk metadata must include:
    {
      "chunk_id": "uuid",
      "doc_id": "uuid",
      "source": "gdrive2tb:VFD manual pdfs/ABB_ACS880.pdf",
      "filename": "ABB_ACS880.pdf",
      "page_start": 12,
      "page_end": 13,
      "section": "Chapter 4 — Fault Tracing",
      "chunk_index": 47,
      "total_chunks": 203,
      "equipment_type": "vfd",
      "manufacturer": "ABB",
      "model": "ACS880",
      "ingested_at": "2026-03-22T09:00:00Z",
      "version": "v0.5.3"
    }

──────────────────────────────────────────────────────────
2.4 EMBEDDING
──────────────────────────────────────────────────────────
- Embedding model: define which to use and why
  Options to evaluate:
    text-embedding-3-small (OpenAI, 1536 dims, cheap)
    text-embedding-3-large (OpenAI, 3072 dims, better recall)
    nomic-embed-text (local via Ollama on BRAVO, free, private)
- Recommend one for production with justification
- Batch embedding (not one call per chunk)
- Store embedding vectors in NeonDB pgvector column

──────────────────────────────────────────────────────────
2.5 NEONDB SCHEMA
──────────────────────────────────────────────────────────
Define the exact PostgreSQL schema:

  documents table:
    doc_id, filename, source, file_hash, page_count,
    equipment_type, manufacturer, model, ingested_at,
    chunk_count, status

  chunks table:
    chunk_id, doc_id, content, embedding (vector),
    page_start, page_end, section, chunk_index,
    metadata (jsonb), ingested_at

  ingest_log table:
    run_id, started_at, completed_at, docs_processed,
    chunks_created, errors, source, version

Indexes needed for fast retrieval:
  - pgvector ivfflat or hnsw index on embedding column
  - GIN index on metadata jsonb
  - btree on equipment_type, manufacturer, model

──────────────────────────────────────────────────────────
2.6 RETRIEVAL INTERFACE
──────────────────────────────────────────────────────────
Define how ALL clients query the KB:

  Function: retrieve_chunks(query, top_k=5, filters=None)
  - Embed the query using same model as ingest
  - Vector similarity search in NeonDB
  - Optional metadata filters: equipment_type, manufacturer, model
  - Returns: ranked chunks with metadata and similarity score
  - Used by: Telegram bot, Slack bot, Open WebUI, Node-RED

──────────────────────────────────────────────────────────
2.7 DEDUPLICATION AND VERSIONING
──────────────────────────────────────────────────────────
- Hash each document on ingest (SHA256 of file content)
- Skip if hash already exists in documents table
- Re-ingest if --force flag passed
- Version tag every chunk with current git tag

──────────────────────────────────────────────────────────
2.8 CLI INTERFACE
──────────────────────────────────────────────────────────
tools/ingest_pipeline.py should support:

  # Dry run — list what would be ingested, no DB writes
  python tools/ingest_pipeline.py --source gdrive --dry-run

  # Ingest specific folder
  python tools/ingest_pipeline.py \
    --source gdrive \
    --folder "VFD manual pdfs" \
    --dry-run

  # Full ingest with real DB writes
  doppler run --project factorylm --config prd -- \
    python tools/ingest_pipeline.py --source gdrive --folder "VFD manual pdfs"

  # Ingest local folder
  doppler run --project factorylm --config prd -- \
    python tools/ingest_pipeline.py --source local --path ./manuals/

  # Re-ingest everything
  doppler run --project factorylm --config prd -- \
    python tools/ingest_pipeline.py --source gdrive --force

──────────────────────────────────────────────────────────
2.9 RUN SUMMARY FORMAT
──────────────────────────────────────────────────────────
  ══════════════════════════════════════════════════
  MIRA Document Ingest — v0.5.3 — 2026-03-22
  Source:       gdrive2tb:VFD manual pdfs
  ══════════════════════════════════════════════════
  Documents scanned:     12
  Already ingested:       3 (skipped — hash match)
  New documents:          9
  Pages extracted:      847
  Chunks created:      1203
  Embeddings written:  1203
  Errors:                 0
  Duration:           4m 12s
  ══════════════════════════════════════════════════
  Equipment types found:
    vfd: 7 | motor: 2 | plc: 0 | other: 2
  ══════════════════════════════════════════════════

═══════════════════════════════════════════════════════════
PHASE 3 — IMMEDIATE FIRST RUN PLAN
═══════════════════════════════════════════════════════════

After PRD is approved, the first real ingest run will be:

  Source: gdrive2tb:"VFD manual pdfs"
  Target: NeonDB (CONNECTION_STRING from Doppler)
  Model:  whichever embedding model PRD recommends

List exact steps to:
1. Verify NeonDB connection and run schema migrations
2. Pull PDFs from gdrive2tb via rclone to temp dir
3. Extract, chunk, embed, and write to NeonDB
4. Verify retrieval works: retrieve_chunks("VFD fault code F001")
5. Confirm bots can query the KB after ingest

═══════════════════════════════════════════════════════════
PHASE 4 — THIN CLIENT INTEGRATION MAP
═══════════════════════════════════════════════════════════

Show exactly how each client connects to the shared KB:

  Telegram bot    → retrieve_chunks() → NeonDB
  Slack bot       → retrieve_chunks() → NeonDB
  Open WebUI      → retrieve_chunks() → NeonDB
  Node-RED        → retrieve_chunks() → NeonDB
  Future clients  → retrieve_chunks() → NeonDB

Define where retrieve_chunks() lives (shared lib? mira-ingest
container API? direct DB calls?) and how each client imports or
calls it.

═══════════════════════════════════════════════════════════
PHASE 5 — GITHUB ISSUES TO CREATE
═══════════════════════════════════════════════════════════

After presenting the PRD, create these GitHub issues:

  #A — [Ingest] NeonDB schema migration + pgvector setup
  #B — [Ingest] Build tools/ingest_pipeline.py
  #C — [Ingest] Ingest VFD manual pdfs from gdrive2tb (first real run)
  #D — [Ingest] Wire retrieve_chunks() into Telegram + Slack bots
  #E — [Ingest] Wire retrieve_chunks() into Open WebUI
  #F — [Ingest] Add ingest trigger to Node-RED flow
  #G — [Ingest] Google Photos nameplate ingest (unblock after rclone fix)

═══════════════════════════════════════════════════════════
PHASE 6 — PRESENT BEFORE BUILDING
═══════════════════════════════════════════════════════════

Deliver:
1. Audit findings — what exists, what's missing, what's broken
2. Complete PRD document (save to docs/ingest_pipeline_prd.md)
3. NeonDB schema SQL (save to db/migrations/001_ingest_schema.sql)
4. Recommended embedding model with justification
5. GitHub issues list for approval

Do NOT write ingest_pipeline.py yet.
Do NOT touch NeonDB yet.
Do NOT run any ingests.
Present everything for review first.
```


***

## What This Unlocks

Once the ingest pipeline is built and the VFD manuals are in NeonDB, every client immediately gets grounded answers instead of hallucinations:


| Before Ingest | After Ingest |
| :-- | :-- |
| "The ACS880 fault F001 might mean..." | "ACS880 manual p.47: F001 = DC bus overvoltage. Check input voltage and braking resistor." |
| Generic troubleshooting advice | Exact steps from the actual manual |
| Same answer for every VFD brand | Manufacturer-specific procedures |

The VFD manuals already on your Google Drive are the perfect first dataset — paste this into Claude and let it audit and plan.

