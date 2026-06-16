# PRD: Firecrawl + Docling Knowledge Base Ingestion Pipeline
**Project:** MIRA (Maintenance Intelligence & Retrieval Architecture)
**Document Type:** Product Requirements Document — Exploration & Implementation
**Status:** Draft — Exploration Phase
**Date:** April 2026
**Owner:** Industrial Maintenance Technologist, Lake Wales FL

---

## Overview

This PRD defines the requirements for evaluating and — if validated — implementing a self-hosted web crawling and document parsing pipeline using **Firecrawl** (self-hosted) and **Docling** to programmatically ingest industrial robot and PLC manuals from manufacturer websites into MIRA's NeonDB pgvector knowledge base.

The pipeline replaces the current manual knowledge base population workflow described in the V2 build schedule (Week 3–4: "migrate existing manuals / auto-scrape unknown equipment via n8n"). This PRD covers both the **Exploration Gate** (is it a viable replacement?) and **Implementation Phase** (build it into MIRA's stack) as two sequential milestones.

---

## Problem Statement

MIRA's core value proposition — a 30-second diagnostic response from any thin client — depends entirely on the depth and freshness of its knowledge base. Currently, knowledge base population is:

- **Manual**: Manuals are loaded ad hoc; there is no automated pipeline to discover or ingest new OEM documentation
- **Static**: Once a manual is loaded, updates from the manufacturer are never pulled
- **Unscalable**: Adding coverage for a new equipment brand requires a human to locate, download, and process each document individually
- **Parsing-dependent on paid cloud services**: LlamaParse charges up to 90 credits per page for technical documentation — an unsustainable cost at scale for a bootstrapped product

The result is a knowledge base that starts shallow, ages quickly, and requires ongoing manual effort to maintain — directly contradicting MIRA's self-improving flywheel design.

---

## Goals

- Automate discovery and ingestion of manufacturer manuals (PDF and HTML) from OEM websites overnight
- Eliminate per-page parsing costs by routing all document parsing through the already-running self-hosted Docling instance
- Deliver clean, chunked Markdown into NeonDB pgvector with source metadata preserved for citation traceability
- Run entirely on the existing 2× Mac Mini M4 infrastructure with no new monthly SaaS cost
- Establish a nightly cron schedule so the knowledge base grows autonomously

---

## Non-Goals

- This PRD does **not** cover CMMS ingestion (separate pipeline)
- This PRD does **not** replace n8n for workflow orchestration of other MIRA functions
- This PRD does **not** cover fine-tuning or LoRA training (V3 scope)
- This PRD does **not** require changes to the FastAPI RAG pipeline — only the ingestion layer feeding NeonDB

---

## Exploration Gate (Milestone 1)

Before committing engineering time to full implementation, a time-boxed exploration validates the pipeline against MIRA's actual document corpus and infrastructure.

### Exploration Criteria

The exploration is considered **successful** (green-light for implementation) if all four criteria pass:

| # | Criterion | Pass Condition | Test Method |
|---|-----------|---------------|-------------|
| 1 | **Crawl quality** | Firecrawl self-hosted recovers >90% of accessible PDF links from 3 target OEM sites | Manual spot-check of crawl output vs. known doc index |
| 2 | **Parse quality** | Docling produces accurate Markdown from complex multi-column manual pages with parameter tables | Human review of 10 randomly sampled pages per document type |
| 3 | **RAG retrieval accuracy** | Queries against Docling-parsed content return correct answers at same or better accuracy than current baseline | A/B test: 20 known Q&A pairs against existing KB |
| 4 | **Infrastructure fit** | Full pipeline (crawl + parse + embed + upsert) completes a 500-page manual within the overnight window on Mac Mini hardware | Timed end-to-end run |

### Exploration Scope

Test against three OEM targets representing the range of site complexity MIRA will encounter:

- **Fanuc** — Large, well-structured documentation portal, heavy PDF inventory
- **Rockwell Automation (Allen-Bradley)** — JavaScript-rendered doc portal, requires Playwright service
- **Siemens** — Mixed HTML/PDF, multi-language, gated sections (test public docs only)

### Exploration Deliverable

A one-page findings memo appended to this PRD capturing:
- Pass/fail on each criterion with supporting data
- Any sites requiring cloud-tier Firecrawl (bot protection, JS rendering beyond Playwright capacity)
- Estimated nightly crawl volume (pages/night) given Mac Mini throughput
- Go / No-Go recommendation with rationale

### No-Go Path

If exploration fails criteria 2 or 3, the default fallback is:
- Firecrawl for crawl/discovery (no change)
- LlamaParse **Cost-Effective tier** (3 credits/page) for standard docs, **Agentic tier** (10 credits/page) reserved for complex parameter tables only
- Budget ceiling: $50/month Starter plan, scoped to highest-priority manuals

---

## Implementation Phase (Milestone 2)

Activated only upon Exploration Gate: **Go**.

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Mac Mini #1                         │
│  ┌───────────────┐    ┌─────────────────────────────┐  │
│  │  Firecrawl    │    │  MIRA FastAPI Backend        │  │
│  │  API Server   │    │  (existing, no changes)      │  │
│  │  port :3002   │    └─────────────────────────────┘  │
│  └───────┬───────┘                                      │
│          │ Redis job queue                              │
└──────────┼──────────────────────────────────────────────┘
           │
┌──────────┼──────────────────────────────────────────────┐
│          ▼              Mac Mini #2                     │
│  ┌───────────────┐    ┌──────────────┐                 │
│  │  Firecrawl    │    │   Docling    │                 │
│  │  Worker Node  │───▶│  (existing)  │                 │
│  │  + Playwright │    │  PDF Parser  │                 │
│  └───────┬───────┘    └──────┬───────┘                 │
│          │                   │                         │
└──────────┼───────────────────┼─────────────────────────┘
           │                   │
           ▼                   ▼
┌──────────────────────────────────────────────────────────┐
│              ingest_manuals.py (new module)              │
│   chunk → embed (nomic-embed-text via Ollama) → upsert  │
│                   NeonDB pgvector                        │
└──────────────────────────────────────────────────────────┘
```

### Component Responsibilities

#### Firecrawl (Mac Mini #1 — API; Mac Mini #2 — Worker)

- Crawl OEM sites listed in `targets.json` using `/crawl` endpoint
- Collect raw HTML content for HTML-based manuals (output: Markdown via Firecrawl's built-in extraction)
- Collect PDF source URLs for PDF-based manuals (pass URLs to Docling, do not parse PDFs inside Firecrawl)
- Playwright service enabled on Mac Mini #2 for JavaScript-rendered portals

#### Docling (Mac Mini #2 — existing instance)

- Receive PDF URLs collected by Firecrawl
- Execute full document conversion: layout analysis, table extraction, reading-order reconstruction, OCR where needed
- Export each document as chunked Markdown with page-level metadata
- No API cost — runs entirely local

#### `ingest_manuals.py` (new module — MIRA repo only)

- Orchestrates the full pipeline: triggers Firecrawl crawl → receives results via webhook → routes HTML docs direct to chunker → routes PDF URLs to Docling → chunks all output → embeds with `nomic-embed-text` via Ollama → upserts to NeonDB with source metadata
- Scheduled via `cron` at 02:00 daily on Mac Mini #1
- Idempotent: checks source URL hash against NeonDB before re-processing to avoid duplicate embeddings

#### `targets.json` (new config file — MIRA repo)

Flat JSON list of crawl targets. Editable without code changes. Structure:

```json
[
  {
    "brand": "Fanuc",
    "url": "https://www.fanuc.com/en/product/robot/",
    "includes": ["*/manual*", "*/documentation*", "*.pdf"],
    "max_depth": 4,
    "max_pages": 500,
    "js_required": false
  },
  {
    "brand": "Rockwell",
    "url": "https://literature.rockwellautomation.com/",
    "includes": ["*/technical-data*", "*/user-manual*", "*.pdf"],
    "max_depth": 3,
    "max_pages": 300,
    "js_required": true
  }
]
```

### NeonDB Schema Addition

One new table added to the existing MIRA schema — no changes to existing tables:

```sql
CREATE TABLE IF NOT EXISTS ingestion_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url   TEXT NOT NULL UNIQUE,
  url_hash     TEXT NOT NULL,
  brand        TEXT,
  doc_title    TEXT,
  page_count   INTEGER,
  chunk_count  INTEGER,
  parsed_by    TEXT CHECK (parsed_by IN ('firecrawl', 'docling')),
  ingested_at  TIMESTAMPTZ DEFAULT NOW(),
  status       TEXT CHECK (status IN ('success', 'failed', 'skipped'))
);
```

This table enables:
- Idempotency checks (skip already-ingested URLs)
- Debugging failed ingestions
- Reporting on knowledge base coverage by brand

### Chunking Strategy

Chunking settings tuned for industrial technical documentation:

- **Chunk size:** 512 tokens
- **Overlap:** 64 tokens
- **Split boundaries:** Section headers preferred; fall back to sentence boundaries
- **Metadata attached to each chunk:**
  - `source_url` — original manufacturer URL for citation in MIRA responses
  - `brand` — equipment manufacturer
  - `doc_title` — document name extracted from Docling metadata
  - `page_number` — for PDF sources, enables page-level citation
  - `ingested_at` — timestamp for freshness scoring

### Webhook Flow

Firecrawl fires a webhook to `http://localhost:3002/webhooks/firecrawl` on completion of each crawled URL. The webhook payload is received by a new FastAPI route (minimal — no auth change required) that queues the result for processing by `ingest_manuals.py`. This allows Mac Mini #2 to begin parsing and embedding while Mac Mini #1 continues crawling.

---

## File Structure (MIRA Repo Only)

All new files live within the existing MIRA repository. No new repositories created.

```
mira/
├── ingestion/
│   ├── __init__.py
│   ├── ingest_manuals.py        ← main pipeline orchestrator
│   ├── targets.json             ← OEM crawl target config
│   ├── chunker.py               ← text chunking logic
│   ├── embedder.py              ← nomic-embed-text via Ollama
│   └── docling_client.py        ← thin wrapper around local Docling instance
├── app/
│   └── routes/
│       └── webhooks.py          ← add firecrawl webhook route here (existing file)
├── db/
│   └── migrations/
│       └── 003_ingestion_log.sql ← new migration only
├── docker/
│   └── firecrawl/
│       ├── docker-compose.yml   ← Firecrawl self-hosted config (Mac Mini #1)
│       └── .env.example         ← Firecrawl env vars template
└── scripts/
    └── cron_ingest.sh           ← cron wrapper script
```

---

## Environment Variables (additions to existing `.env`)

```bash
# Firecrawl (self-hosted)
FIRECRAWL_API_URL=http://localhost:3002
FIRECRAWL_API_KEY=fc-local

# Docling (self-hosted, Mac Mini #2)
DOCLING_BASE_URL=http://mac-mini-2.local:5001

# Ingestion settings
INGEST_CHUNK_SIZE=512
INGEST_CHUNK_OVERLAP=64
INGEST_MAX_PAGES_PER_TARGET=500
INGEST_CRON_HOUR=2
```

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Knowledge base coverage | Top 10 OEM brands fully ingested within 30 days of implementation | Count of brands with >0 chunks in NeonDB |
| Nightly freshness | New/updated docs ingested within 24 hours of manufacturer publishing | Spot-check against known update dates |
| Retrieval quality | RAG answer accuracy on 50-question test set ≥ current baseline | A/B test post-ingestion |
| Zero parsing cost | $0/month to LlamaParse | Billing check |
| Pipeline reliability | <5% failed ingestions per nightly run | `ingestion_log` status query |

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| OEM site blocks self-hosted Firecrawl (no IP rotation) | Medium | Medium | Rate-limit crawl to 1 req/3s; use Firecrawl cloud for blocked sites only |
| Docling accuracy degrades on multi-column wiring diagrams | Low | High | Flag pages with image-heavy content in `ingestion_log`; manual review queue |
| Overnight crawl exceeds Mac Mini thermal budget | Low | Low | Set `max_pages_per_target`; stagger crawls across 4-hour window |
| Duplicate chunks inflate vector store | Low | Medium | URL hash idempotency check in `ingestion_log` prevents re-ingestion |
| Manufacturer changes URL structure, breaks crawl | Medium | Low | Weekly crawl health check; alert on `failed` count > threshold |

---

## Dependencies

- Firecrawl self-hosted running on Mac Mini #1 (Docker)
- Docling already deployed on Mac Mini #2 ✅
- Ollama with `nomic-embed-text` running on Mac Mini #1 or #2 ✅
- NeonDB migration `003_ingestion_log.sql` applied before first run
- `targets.json` populated with at least 3 OEM entries before Milestone 1 exploration

---

## Timeline

| Milestone | Task | Estimated Effort |
|-----------|------|-----------------|
| **M0 — Prep** | Deploy Firecrawl Docker on Mac Mini #1; populate `targets.json` with 3 test OEMs | 2–3 hours |
| **M1 — Exploration** | Run test crawls; evaluate parse quality; A/B RAG test; write findings memo | 1–2 days |
| **M1 Gate** | Go / No-Go decision | 30 minutes |
| **M2 — Implementation** | Build `ingestion/` module; add webhook route; write migration; test end-to-end | 3–4 days |
| **M2 — Scheduling** | Configure cron; set up basic health alerting via Telegram bot | 4 hours |
| **M2 — Validation** | Run 50-question RAG accuracy test; confirm zero LlamaParse spend | 1 day |

---

## Acceptance Criteria

Implementation is complete and accepted when:

- [ ] Firecrawl self-hosted running on Mac Mini #1, worker on Mac Mini #2
- [ ] `ingest_manuals.py` runs end-to-end without errors on all `targets.json` entries
- [ ] All new chunks in NeonDB carry `source_url`, `brand`, `doc_title`, and `page_number` metadata
- [ ] `ingestion_log` table populated with status for every ingestion run
- [ ] Nightly cron confirmed active and firing at 02:00
- [ ] RAG accuracy on 50-question test set meets or exceeds pre-ingestion baseline
- [ ] LlamaParse API key removed from MIRA `.env` (or confirmed unused)
- [ ] All new code lives exclusively in the MIRA repository — no external repo dependencies introduced

---

*This document references only the MIRA repository. No external project references.*
