---
name: knowledge-ingest
description: MIRA knowledge ingest pipeline — chunking (sentence+table aware, token-capped for Gemma), dual embedding (nomic + EmbeddingGemma planned), NeonDB storage, Apify/Firecrawl discovery, textbook source strategy, 7 ingest scripts, photo pipeline
---

# Knowledge Ingest

## Source Files

- `mira-crawler/ingest/chunker.py` — **Canonical chunker** (sentence-aware, table-aware, token-capped)
- `mira-sidecar/rag/chunker.py` — Thin wrapper delegating to crawler chunker
- `mira-core/mira-ingest/db/neon.py` — NeonDB connection layer (read + write)
- `mira-core/mira-ingest/main.py` — FastAPI ingest service (photo ingestion, vector search, KB push)
- `mira-core/scripts/` — 7 ingest scripts (batch ingestion tools)
- `mira-mcp/server.py` — FastMCP server with PDF ingest endpoint
- `docs/TEXTBOOK_SOURCES.md` — Textbook ingestion strategy and retrieval guardrails

---

## Chunking Pipeline

**Single canonical chunker:** `mira-crawler/ingest/chunker.py` (`chunk_blocks()`)

All ingest paths converge here. The sidecar's `rag/chunker.py` wraps `chunk_blocks` to preserve the `chunk_document(file_path)` interface.

### Config

| Setting | Value | Purpose |
|---------|-------|---------|
| `max_chars` | 2000 | Prose chunk ceiling (~400-500 tokens) |
| `min_chars` | 200 | Drop chunks below this |
| `overlap` | 200 | Sentence-based overlap between chunks |
| `TABLE_MAX_CHARS` | 1200 | Tables split at row boundaries above this |
| `MAX_TOKENS` | 2000 | **Hard cap** — enforced via tiktoken after all splitting |

### Capabilities

- **Sentence-aware splitting** — breaks at sentence boundaries (`.?!` followed by capital), skips abbreviations (`approx.`, `e.g.`, `fig.`, `mfg.`, etc.)
- **Table detection** — pipe-delimited and tab-delimited tables kept intact or split at row boundaries with header prepended to each split
- **Token hard cap** — tiktoken `cl100k_base` counting (char//4 fallback if tiktoken unavailable). Ensures every chunk fits within EmbeddingGemma's 2048-token context with 48 tokens headroom for task prefixes
- **Equipment ID extraction** — auto-extracted from filename patterns (`ABB_IRB6700_Manual.pdf` -> `IRB6700`)

### chunk_quality values

| Value | Meaning |
|-------|---------|
| `sentence_split` | Split at sentence boundary (ideal) |
| `fallback_char_split` | No sentence boundary found, hard character split |
| `table` | Table chunk (split at row boundaries) |
| `token_truncated` | Exceeded MAX_TOKENS, truncated by token cap |

Target: < 5% `fallback_char_split` in production.

### Usage

```python
from ingest.chunker import chunk_blocks

chunks = chunk_blocks(
    blocks,                    # [{text, page_num, section}, ...]
    source_url="https://...",
    source_file="manual.pdf",
    max_chars=2000,
    min_chars=200,
    overlap=200,
    sentence_aware=True,       # default
)
# Returns: [{text, page_num, section, source_url, source_file,
#            source_type, equipment_id, chunk_index, chunk_type, chunk_quality}, ...]
```

---

## Embedding Models

### Current: nomic-embed-text

| Property | Value |
|----------|-------|
| Model | `nomic-embed-text:latest` (v1.5) |
| Runtime | Ollama (BRAVO or CHARLIE) |
| Dimensions | 768 |
| Max tokens | 2048 |
| Similarity | Cosine |
| NeonDB column | `embedding` |

### Planned: EmbeddingGemma (dual embedding)

| Property | Value |
|----------|-------|
| Model | `google/embeddinggemma-300m` |
| Params | 308M (Gemma 3 backbone, bidirectional encoder) |
| Dimensions | 768 (Matryoshka: truncatable to 512, 256, 128) |
| Max tokens | 2048 |
| Similarity | **Inner-product** (not cosine) |
| NeonDB column | `embedding_gemma` (new, alongside existing `embedding`) |

**Task prefixes (required):**
- Documents: `"title: {section} | text: {chunk}"`
- Queries: `"task: search result | query: {query}"`

**Compatibility:** Both models output 768-dim vectors but live in **different vector spaces** — you cannot search nomic vectors with a Gemma query or vice versa. The dual-column approach keeps backward compatibility: existing 25K entries continue working via `embedding`, new entries get both.

**Migration path:** Add `embedding_gemma` column to NeonDB, backfill existing entries, query both columns and merge with Reciprocal Rank Fusion.

---

## Textbook Sources Strategy

Reference: `docs/TEXTBOOK_SOURCES.md`

Textbooks serve as **domain priors** — they answer "how does a VFD work?" not "what does F4 mean on a PowerFlex 40?"

### New source_type: `textbook`

| equipment_type | Content |
|---------------|---------|
| `general_maintenance` | Broad multi-system maintenance, PM, troubleshooting |
| `general_mechatronics` | Mechanical + electrical + controls integration |
| `general_electrical` | Motor control, interlocks, contactors, overloads |

### Ingest policy

| Source | Policy | Notes |
|--------|--------|-------|
| V-TECS Guide for Industrial Maintenance | Full ingest OK | Public domain vocational curriculum |
| OSHA 29 CFR 1910 (maintenance sections) | Full ingest OK | Government, public domain |
| State vocational curriculum guides | Full ingest OK | Public domain |
| Commercial textbooks (McGraw-Hill, ATP, etc.) | Excerpt only | <=15% of any work, `ingest_policy='excerpt_only'` |

### Retrieval guardrails

```
IF query matches product name OR fault code:
    → Exclude source_type='textbook' from search
    → Fallback to textbooks only if < 3 manual chunks returned

ELSE (general query):
    → Textbooks compete on similarity
    → Score penalty: -0.05 for textbook chunks (break ties toward OEM content)
```

---

## Foundational Doc Scrape Targets

### Tier 1: Equipment-Specific (MIRA's hardware stack)

| Source | URL | Content |
|--------|-----|---------|
| Rockwell/Allen-Bradley | `literature.rockwellautomation.com` | CompactLogix, ControlLogix, Micro820, fault codes |
| AutomationDirect | `automationdirect.com` | GS10, GS20 VFD manuals, parameters |
| PowerFlex VFDs | `rockwellautomation.com` | PowerFlex 525/527 manuals, fault codes |
| Ignition SCADA | `docs.inductiveautomation.com` | Tags, scripting, OPC-UA, alarms |

### Tier 2: Protocols & Standards

| Source | URL | Content |
|--------|-----|---------|
| Modbus specs | `modbus.org/specs` | TCP, RTU, ASCII specs |
| OSHA 1910 | `osha.gov` | Electrical safety (public domain) |
| RealPars | `realpars.com` | PLC programming, ladder logic tutorials |
| Simply Modbus | `simplymodbus.ca` | Modbus tutorials |

### Tier 3: General Maintenance

| Source | URL | Content |
|--------|-----|---------|
| EE Portal | `electrical-engineering-portal.com` | Motors, power distribution, protection |
| Engineering Toolbox | `engineeringtoolbox.com` | Reference data, formulas |
| Fluke Learning | `fluke.com/en-us/learn` | Test equipment, thermal imaging |
| ReliabilityWeb | `reliabilityweb.com` | RCM, predictive maintenance |

### Tier 4: PLC/Automation

| Source | URL | Content |
|--------|-----|---------|
| PLCdev | `plcdev.com` | Ladder logic, function blocks |
| The Automation Blog | `theautomationblog.com` | AB tutorials, Studio 5000 |
| Automation.com | `automation.com` | IIoT, SCADA security |

---

## Discovery Tools

### Apify (current — production)

- Script: `mira-core/scripts/discover_manuals.py`
- Cron: Sunday 3am weekly
- Targets: Rockwell, Siemens, ABB, Schneider, Mitsubishi
- Crawler: `apify/website-content-crawler` (cheerio or playwright)
- Output: PDF URLs inserted into `manual_cache`
- Cost: Apify actor runs (~$49/mo for 100 runs)

### Firecrawl (alternative — available but needs credits)

- API key: Doppler `factorylm` project, `dev` config (`FIRECRAWL_API_KEY`)
- Pattern: `map` (1 credit, full URL discovery) -> filter -> `batchScrape` (1 credit/page)
- Output: Clean markdown with metadata
- Advantages: JS rendering, built-in anti-bot, markdown conversion
- Status: Free tier (500 credits) exhausted. Needs Standard plan ($83/mo, 100K credits)

---

## NeonDB Layer (`neon.py`)

SQLAlchemy + `NullPool` (Neon PgBouncer handles pooling).

### Key functions

| Function | Purpose |
|----------|---------|
| `recall_knowledge(embedding, tenant_id, limit)` | pgvector cosine search over `knowledge_entries` |
| `insert_knowledge_entry(...)` | Insert chunk + embedding. Accepts `chunk_type` param. |
| `knowledge_entry_exists(tenant_id, source_url, chunk_index)` | Dedup guard |
| `get_pending_urls()` | Unprocessed URLs from `source_fingerprints`, `manual_cache`, `manuals` |
| `insert_manual_cache_url(...)` | Queue a new URL for ingest |
| `health_check()` | `{status, tenant_count, knowledge_entries}` |

### Schema

```
knowledge_entries
  ├── tenant_id, source_type, manufacturer, model_number
  ├── content (text), embedding (vector 768-dim)
  ├── embedding_gemma (vector 768-dim — planned)
  ├── source_url, source_page (chunk_index)
  ├── metadata (jsonb: chunk_quality, section, ingest_policy, ...)
  └── chunk_type (text | table)

source_fingerprints  — URLs queued (atoms_created counter)
manual_cache         — discovered URLs (pdf_stored flag)
manuals              — verified manuals (is_verified flag)
```

**25,219 entries** | Tenant: `78917b56-f85f-43bb-9a08-1bb98a6cd6c3` | Nightly cron 2:15am

---

## Ingest Scripts (`mira-core/scripts/`)

| Script | Purpose | Chunker |
|--------|---------|---------|
| `ingest_manuals.py` | Process URLs from `manual_cache`; Docling/pdfplumber extract -> `chunk_blocks()` -> embed -> NeonDB | `mira-crawler/ingest/chunker.py` |
| `ingest_gdrive_docs.py` | Google Drive docs via rclone sync | inline |
| `ingest_equipment_photos.py` | Batch photo ingest from directory | N/A (vision) |
| `ingest_gmail_takeout.py` | Maintenance records from Gmail export | inline |
| `discover_manuals.py` | Apify crawl -> populate `manual_cache` | N/A (discovery only) |
| `build_case_corpus.py` | Training corpus from interaction logs | inline |
| `reddit_harvest.py` | Industrial maintenance Q&A from Reddit | inline |

---

## FastAPI Ingest Service (`main.py`)

**Container:** `mira-ingest` | **Port:** 8001 (host: 8002)

```
POST /ingest/photo (multipart: image + asset_tag)
    ├── check_tier_limit() -> 429 if exceeded
    ├── Resize to MAX_INGEST_PX, strip EXIF
    ├── Ollama qwen2.5vl:7b for description
    ├── nomic-embed-vision-v1.5 + nomic-embed-text-v1.5
    ├── Push to Open WebUI KB (best-effort)
    └── Return {id, asset_tag, description}

POST /ingest/search (JSON: query, top_k)
    └── Embed query -> cosine similarity scan -> top-k results
```

---

## MCP Server (`mira-mcp/server.py`)

**Container:** `mira-mcp` | **Ports:** 8000 (SSE), 8001 (REST)

Tools: `get_equipment_status`, `get_active_faults`, `ingest_pdf`

`POST /ingest/pdf` — accepts multipart PDF + `equipment_type`. Used by bot adapters for user-uploaded manuals.

---

## Supported File Types

| Type | Entry Point | Notes |
|------|-------------|-------|
| Photo (JPEG/PNG) | `mira-ingest /ingest/photo` | Resized to MAX_INGEST_PX |
| PDF manual | `mira-mcp /ingest/pdf` or `ingest_manuals.py` | Docling primary, pdfplumber fallback |
| Google Drive docs | `ingest_gdrive_docs.py` | rclone sync first |
| Gmail takeout | `ingest_gmail_takeout.py` | Maintenance email extraction |
| Web URLs | `discover_manuals.py` -> `ingest_manuals.py` | Queued in manual_cache |
| Textbooks | `ingest_manuals.py` (planned) | `source_type='textbook'`, guardrails required |
