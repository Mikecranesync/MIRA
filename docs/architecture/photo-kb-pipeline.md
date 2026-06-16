# MIRA Photo → Knowledge Base Pipeline Architecture

**Updated:** 2026-03-24
**Status:** Operational (Ollama triage running, Claude Vision ingest tested)

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        GOOGLE TAKEOUT (Source)                              │
│  15,815 photos · 123 GB · 14 ZIPs · harperhousebuyers@gmail.com           │
└─────────────────────────┬───────────────────────────────────────────────────┘
                          │ unzip → ~/takeout_staging/extracted/
                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    STAGE 1: CLIP/SigLIP ZERO-SHOT                          │
│  Model: ViT-B-16-SigLIP (webli) · Device: Apple M4 MPS                    │
│  Speed: 11 img/s · Cost: $0 · Script: tools/clip_classify_takeout.py      │
│                                                                             │
│  ┌──────────┐    ┌────────────┐    ┌──────────┐                            │
│  │INDUSTRIAL│    │ AMBIGUOUS  │    │ PERSONAL │                            │
│  │  5,158   │    │    298     │    │  10,359  │                            │
│  │  (>0.70) │    │(0.50-0.70) │    │  (<0.50) │                            │
│  └────┬─────┘    └─────┬──────┘    └──────────┘                            │
│       └────────┬───────┘              discarded                            │
│                ▼                                                            │
└────────────────┼────────────────────────────────────────────────────────────┘
                 │ 5,456 candidate photos
                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                  STAGE 2: OLLAMA qwen2.5vl:7b TRIAGE                       │
│  Model: qwen2.5vl:7b (local) · Device: Apple M4 Metal                     │
│  Speed: 3.8 sec/img · Cost: $0 · Script: tools/ollama_triage_takeout.py   │
│  Prompt: "Is this industrial equipment? yes/no"                            │
│  Checkpoint: ~/takeout_staging/ollama_checkpoint.txt (resume support)       │
│                                                                             │
│  ┌────────────────────┐    ┌────────────────────┐                          │
│  │ CONFIRMED EQUIPMENT│    │   NOT EQUIPMENT    │                          │
│  │     ~4,200         │    │     ~1,256         │                          │
│  │      (76%)         │    │      (24%)         │                          │
│  └────────┬───────────┘    └────────────────────┘                          │
│           │ copied to ~/takeout_staging/ollama_confirmed/                   │
└───────────┼─────────────────────────────────────────────────────────────────┘
            ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│              STAGE 3: CLAUDE VISION CLASSIFICATION + INGEST                 │
│  Model: claude-sonnet-4-20250514 · Cost: ~$0.01/img                        │
│  Script: mira-core/scripts/ingest_equipment_photos.py                      │
│                                                                             │
│  ┌─────────────────────────────────────────────┐                           │
│  │ Claude Vision Prompt:                        │                           │
│  │ "What equipment is this?"                    │                           │
│  │ Returns: make, model, type, description,     │                           │
│  │ condition, has_nameplate, nameplate_fields    │                           │
│  └──────────────────┬──────────────────────────┘                           │
│                     │                                                       │
│    ┌────────────────┼────────────────────────────────┐                     │
│    │                │                                │                     │
│    ▼                ▼                                ▼                     │
│  ┌──────┐  ┌──────────────┐              ┌──────────────────┐             │
│  │EQUIP.│  │ SPOT-CHECK   │              │  NOT EQUIPMENT   │             │
│  │FOUND │  │ (every 20th) │              │    (skipped)     │             │
│  └──┬───┘  │ 2nd Claude   │              └──────────────────┘             │
│     │      │ call: AGREE/  │                                               │
│     │      │ DISAGREE?     │                                               │
│     │      │ >15% disagree │                                               │
│     │      │ → PAUSE       │                                               │
│     │      └──────┬────────┘                                               │
│     │             │                                                         │
│     └──────┬──────┘                                                         │
│            ▼                                                                │
│  ┌─────────────────────────────────────────────────────────────┐           │
│  │                    PROCESSING FAN-OUT                        │           │
│  │                                                              │           │
│  │  ┌─────────────────┐  ┌──────────────┐  ┌───────────────┐  │           │
│  │  │  Ollama Embed   │  │ NeonDB Write │  │ Manual Queue  │  │           │
│  │  │ nomic-embed-text│  │ knowledge_   │  │ manual_cache  │  │           │
│  │  │ :latest (768d)  │  │ entries      │  │ table         │  │           │
│  │  └────────┬────────┘  └──────┬───────┘  └──────┬────────┘  │           │
│  │           │                  │                  │           │           │
│  │  ┌────────┼──────────────────┼──────────────────┘           │           │
│  │  │        ▼                  ▼                               │           │
│  │  │  IF has_nameplate:   IF make+model:                       │           │
│  │  │  → Regime 3 golden   → Search manufacturer portal        │           │
│  │  │    labels             → Queue PDF URL for nightly ingest  │           │
│  │  └──────────────────────────────────────────────────────────┘           │
│  │                                                                         │
│  │  ┌─────────────────────────────────────────────────────────┐           │
│  │  │          MONITORING DASHBOARD (every 50 photos)          │           │
│  │  │  Equipment types · Manufacturers · Confidence dist.      │           │
│  │  │  Nameplate rate · Spot-check results · Cost tracker      │           │
│  │  │  --max-cost guard · Checkpoint/rollback                  │           │
│  │  └─────────────────────────────────────────────────────────┘           │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Manual Discovery & Ingest Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     MANUAL DISCOVERY (Two Sources)                          │
│                                                                             │
│  SOURCE A: Photo-Triggered (Real-Time)         SOURCE B: Weekly Crawl      │
│  ┌──────────────────────────┐    ┌─────────────────────────────────┐       │
│  │ Equipment photo ingest   │    │ discover_manuals.py             │       │
│  │ identifies make + model  │    │ Apify crawler · Sunday 3am     │       │
│  │ (e.g. "Allen-Bradley     │    │ 5 manufacturer portals:        │       │
│  │  PowerFlex 753")         │    │  · Rockwell Automation         │       │
│  │         │                │    │  · Siemens                     │       │
│  │         ▼                │    │  · ABB                         │       │
│  │ Check: manual already    │    │  · Schneider Electric          │       │
│  │ in KB? (NeonDB query)    │    │  · Mitsubishi Electric         │       │
│  │         │                │    │         │                      │       │
│  │    NO ──┤                │    │         ▼                      │       │
│  │         ▼                │    │  Extract PDF URLs via          │       │
│  │ Construct URL from       │    │  CSS selectors + regex         │       │
│  │ manufacturer portal      │    │         │                      │       │
│  └─────────┬────────────────┘    └─────────┬───────────────────────┘       │
│            │                               │                               │
│            └───────────┬───────────────────┘                               │
│                        ▼                                                    │
│            ┌───────────────────────┐                                       │
│            │    manual_cache       │  NeonDB table                         │
│            │  (manufacturer,       │  Unique on (manufacturer, model)      │
│            │   model, manual_url,  │  pdf_stored = false                   │
│            │   confidence, source) │                                       │
│            └───────────┬───────────┘                                       │
│                        │ Nightly 2:15am                                    │
│                        ▼                                                    │
│            ┌─────────────────────────────────────────────────┐             │
│            │        ingest_manuals.py (Nightly Cron)          │             │
│            │                                                  │             │
│            │  1. Fetch queued URLs (pdf_stored=false)         │             │
│            │  2. Download PDF via httpx (60s timeout)         │             │
│            │  3. Extract text via pdfplumber (page by page)   │             │
│            │  4. Detect sections (Eaton heuristic)            │             │
│            │  5. Chunk: 800 chars, 100 overlap, min 80       │             │
│            │  6. Embed: Ollama nomic-embed-text:latest        │             │
│            │  7. Dedup: knowledge_entry_exists() check        │             │
│            │  8. Insert: NeonDB knowledge_entries             │             │
│            │  9. Mark: pdf_stored = true                      │             │
│            │                                                  │             │
│            │  Rate limit: 0.5s between downloads              │             │
│            │  Max PDF pages: 300                              │             │
│            └──────────────────────┬──────────────────────────┘             │
│                                   ▼                                        │
│                        ┌───────────────────────┐                           │
│                        │  knowledge_entries     │                           │
│                        │  source_type="manual"  │                           │
│                        │  ~hundreds of chunks   │                           │
│                        │  per PDF               │                           │
│                        └───────────────────────┘                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## NeonDB Knowledge Base Schema

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         knowledge_entries                                    │
│                                                                             │
│  id              UUID (PK)                                                  │
│  tenant_id       UUID ──── tenant scoping                                   │
│  source_type     TEXT ──── "equipment_photo" | "manual" | "pdf" |          │
│                            "gmail" | "gdrive" | "reddit" | "case_corpus"   │
│  content         TEXT ──── the actual knowledge chunk (up to ~800 chars)    │
│  embedding       VECTOR(768) ── pgvector (nomic-embed-text)                │
│  manufacturer    TEXT ──── "Allen-Bradley", "Siemens", etc.                │
│  model_number    TEXT ──── "PowerFlex 753", "S7-1200", etc.                │
│  source_url      TEXT ──── dedup key ("takeout://file.jpg", "manual://url")│
│  source_page     INT  ──── chunk index within document                     │
│  metadata        JSONB ── {section, page_num, has_nameplate, condition}    │
│  is_private      BOOL                                                      │
│  verified        BOOL                                                      │
│  created_at      TIMESTAMP                                                 │
│                                                                             │
│  INDEX: pgvector cosine similarity (embedding <=> query)                   │
│  DEDUP: UNIQUE (tenant_id, source_url, source_page)                        │
│                                                                             │
│  Current counts:                                                            │
│    manual chunks:        ~24,314                                            │
│    equipment_photo:      2 (demo, growing)                                  │
│    gdrive:               ~894                                               │
│    gmail:                varies                                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                           manual_cache                                      │
│                                                                             │
│  id              SERIAL (PK)                                                │
│  manufacturer    TEXT ──┐                                                   │
│  model           TEXT ──┘── UNIQUE (manufacturer, model)                   │
│  manual_url      TEXT                                                       │
│  manual_title    TEXT                                                       │
│  pdf_stored      BOOL ──── false = queued, true = ingested                 │
│  source          TEXT ──── "apify" | "photo_ingest" | "photo_ingest_direct"│
│  confidence      FLOAT                                                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Diagnostic Consumption Flow (How KB Gets Used)

```
┌──────────┐     ┌──────────────┐     ┌─────────────────────────────────────┐
│Technician│────▶│ Telegram Bot │────▶│           GSD Engine                │
│  sends   │     │ mira-bot-    │     │         (Supervisor)                │
│  photo + │     │ telegram     │     │                                     │
│  "VFD    │     └──────┬───────┘     │  ┌───────────────────────────────┐  │
│  showing │            │             │  │     1. GuardrailWorker        │  │
│  OC      │            ▼             │  │     Safety keyword check      │  │
│  fault"  │     ┌──────────────┐     │  │     (21 triggers → STOP)     │  │
└──────────┘     │ VisionWorker │     │  └──────────────┬────────────────┘  │
                 │ qwen2.5vl:7b │     │                 │                   │
                 │ + glm-ocr    │     │                 ▼                   │
                 │              │     │  ┌───────────────────────────────┐  │
                 │ Classifies:  │     │  │     2. VisionWorker          │  │
                 │ EQUIPMENT or │     │  │     OCR + asset ID           │  │
                 │ ELEC. PRINT  │     │  │     → "PowerFlex 753, OC"   │  │
                 └──────────────┘     │  └──────────────┬────────────────┘  │
                                      │                 │                   │
                                      │                 ▼                   │
                                      │  ┌───────────────────────────────┐  │
                                      │  │     3. RAGWorker             │  │
                                      │  │                              │  │
                                      │  │  a. Embed query via Ollama   │  │
                                      │  │  b. recall_knowledge()       │  │
                                      │  │     → NeonDB pgvector search │  │
                                      │  │     → Top 5 chunks returned  │  │
                                      │  │                              │  │
                                      │  │  Retrieved:                  │  │
                                      │  │  [1] equipment_photo:        │  │
                                      │  │      "Allen-Bradley VFD      │  │
                                      │  │       PowerFlex 753..."      │  │
                                      │  │  [2] manual chunk:           │  │
                                      │  │      "OC — Overcurrent       │  │
                                      │  │       fault. Caused by:      │  │
                                      │  │       1. Motor short..."     │  │
                                      │  │  [3] manual chunk:           │  │
                                      │  │      "Parameter P041         │  │
                                      │  │       accel time..."         │  │
                                      │  └──────────────┬────────────────┘  │
                                      │                 │                   │
                                      │                 ▼                   │
                                      │  ┌───────────────────────────────┐  │
                                      │  │  4. InferenceRouter          │  │
                                      │  │     Claude API (or Ollama)   │  │
                                      │  │                              │  │
                                      │  │  System prompt includes:     │  │
                                      │  │  --- NEONDB KNOWLEDGE BASE --│  │
                                      │  │  [1] [AB PowerFlex 753]      │  │
                                      │  │      (score=0.847)           │  │
                                      │  │  equipment photo desc...     │  │
                                      │  │  [2] [AB PowerFlex 750]      │  │
                                      │  │      (score=0.812)           │  │
                                      │  │  OC fault troubleshooting... │  │
                                      │  │  --- END NEONDB CONTEXT ---  │  │
                                      │  │                              │  │
                                      │  │  Rule 11: GROUND TO          │  │
                                      │  │  RETRIEVED CONTEXT ONLY      │  │
                                      │  └──────────────┬────────────────┘  │
                                      │                 │                   │
                                      │                 ▼                   │
                                      │  ┌───────────────────────────────┐  │
                                      │  │  5. FSM State Advance        │  │
                                      │  │  IDLE → ASSET_IDENTIFIED →   │  │
                                      │  │  Q1 → Q2 → Q3 → DIAGNOSIS → │  │
                                      │  │  FIX_STEP → RESOLVED         │  │
                                      │  └───────────────────────────────┘  │
                                      └─────────────────────────────────────┘
```

---

## BRAVO Infrastructure (Auto-Recovery Chain)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    BRAVO — Mac Mini M4 (16 GB)                              │
│                    Tailscale: 100.86.236.11                                 │
│                    LAN: 192.168.1.11                                        │
│                                                                             │
│  POWER OUTAGE RECOVERY CHAIN:                                              │
│  ┌──────────┐   ┌──────────┐   ┌───────────┐   ┌────────────────────┐     │
│  │ Hardware │──▶│ macOS    │──▶│ Docker    │──▶│ Containers         │     │
│  │ restart  │   │ auto-    │   │ Desktop   │   │ restart:           │     │
│  │ after    │   │ login as │   │ AutoStart │   │ unless-stopped     │     │
│  │ power    │   │ bravo-   │   │ = true    │   │                    │     │
│  │ failure  │   │ node     │   │           │   │ mira-core     :3000│     │
│  │ (ON)     │   │ (ON)     │   │ (ON)      │   │ mira-bridge   :1880│     │
│  └──────────┘   └──────────┘   └───────────┘   │ mira-bot-telegram │     │
│                                                  │ mira-bot-slack    │     │
│                       ┌───────────┐              │ mira-mcp    :8000 │     │
│                       │ Ollama    │              │ mira-ingest :8002 │     │
│                       │ launchd   │              │ mira-mcpo   :8003 │     │
│                       │ RunAtLoad │              └────────────────────┘     │
│                       │ = true    │                                         │
│                       │           │                                         │
│                       │ KEEP_ALIVE│                                         │
│                       │ = -1      │                                         │
│                       │ (never    │                                         │
│                       │ unload)   │                                         │
│                       └───────────┘                                         │
│                                                                             │
│  MODELS LOADED:                                                             │
│  ┌──────────────────────┬──────────────────────────────────────┐           │
│  │ qwen2.5vl:7b         │ Vision: photo analysis, descriptions │           │
│  │ glm-ocr:latest       │ OCR: nameplate text extraction       │           │
│  │ nomic-embed-text     │ Embeddings: 768-dim text vectors     │           │
│  │ mira:latest          │ Custom: MIRA system prompt           │           │
│  └──────────────────────┴──────────────────────────────────────┘           │
│                                                                             │
│  STORAGE:                                                                   │
│  ┌──────────────────────┬──────────────────────────────────────┐           │
│  │ ~/takeout_staging/   │ Photo classification workspace       │           │
│  │   zips/              │   123 GB (14 Takeout ZIPs)           │           │
│  │   extracted/         │   15,815 photos                      │           │
│  │   ollama_confirmed/  │   ~4,200 equipment photos            │           │
│  │   clip_results.csv   │   CLIP scores for all photos         │           │
│  │   ollama_triage.log  │   Triage progress + results          │           │
│  ├──────────────────────┼──────────────────────────────────────┤           │
│  │ ~/Mira/              │ MIRA application repo                │           │
│  │   mira-core/data/    │   Equipment photos + SQLite DB       │           │
│  │   mira-bridge/data/  │   Shared SQLite WAL state            │           │
│  └──────────────────────┴──────────────────────────────────────┘           │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Pipeline Scripts Reference

| Script | Trigger | Input | Output | Cost |
|--------|---------|-------|--------|------|
| `tools/clip_classify_takeout.py` | Manual | Extracted photos | CSV + filtered dir | $0 |
| `tools/ollama_triage_takeout.py` | Manual | CLIP CSV | CSV + confirmed dir | $0 |
| `mira-core/scripts/ingest_equipment_photos.py` | Manual | Confirmed photos | NeonDB + golden labels | ~$0.01/img |
| `mira-core/scripts/discover_manuals.py` | Cron (Sun 3am) | Manufacturer portals | manual_cache rows | $0 (Apify free tier) |
| `mira-core/scripts/ingest_manuals.py` | Cron (2:15am) | manual_cache URLs | NeonDB chunks | $0 |
| `mira-core/scripts/ingest_gdrive_docs.py` | Manual | Google Drive sync | NeonDB chunks | $0 |
| `mira-core/scripts/ingest_gmail_takeout.py` | Manual | Gmail mbox export | NeonDB chunks | $0 |
| `tools/prefilter_takeout.py` | Manual | Takeout metadata | CSV + filtered dir | $0 |
| `mira-core/scripts/inspect_ingest_quality.py` | Post-batch | NeonDB entries | Quality report | $0 |
