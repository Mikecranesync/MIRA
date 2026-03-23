# MIRA Knowledge Ingest Pipelines
*Last updated: 2026-03-23*

## Knowledge Base Current State (NeonDB)

| source_type | Entry Count | Last Ingested |
|-------------|-------------|---------------|
| manual | 24,314 | 2026-03-18 |
| gdrive | 894 | 2026-03-23 |
| seed | 11 | 2026-03-18 |
| gphotos | 0 | — not yet ingested |
| **TOTAL** | **25,219** | |

Tenant: `78917b56-f85f-43bb-9a08-1bb98a6cd6c3` (FactoryLM BRAVO)

## Pipeline 1 — Google Drive Documents
**Status:** ✅ WORKING

| Property | Value |
|----------|-------|
| Sync script | `mira-core/scripts/sync_gdrive_docs.sh` |
| Ingest script | `mira-core/scripts/ingest_gdrive_docs.py` |
| rclone remote | `gdrive2tb` (type: drive) |
| Local dest | `mira-core/data/gdrive_ingest/industrial/` |
| Embedding | Ollama `nomic-embed-text:latest` (~1.5s/chunk) |
| Dedup | `knowledge_entry_exists(tenant_id, source_url, chunk_index)` |
| source_type | `gdrive` |
| Cron | Manual only (not automated) |

**Run manually:**
```bash
cd ~/Mira
# Step 1: Pull from Drive
./mira-core/scripts/sync_gdrive_docs.sh
# Step 2: Ingest (dry-run first)
doppler run --project factorylm --config prd -- \
  python3 mira-core/scripts/ingest_gdrive_docs.py --dry-run
# Step 3: Full ingest
doppler run --project factorylm --config prd -- \
  python3 mira-core/scripts/ingest_gdrive_docs.py
```

**Add new content:** Upload PDF to `gdrive2tb:"VFD manual pdfs"` or
`gdrive2tb:"factorylm-archives"` → run above commands.

## Pipeline 2 — Equipment Photo Vision Ingest
**Status:** ⚠️ KNOWN ISSUE — zero-vector embeddings, no gphotos entries yet

| Property | Value |
|----------|-------|
| Sync script | `mira-core/scripts/sync_gphotos.sh` |
| Ingest script | `mira-core/scripts/ingest_equipment_photos.py` |
| rclone remote | `gphotos` (type: googlephotos) |
| Albums synced | Equipment Photos, Maintenance, Nameplates |
| Vision model | Claude Vision API (nameplate classification) |
| source_type | `gphotos` |
| Blocker | Line 158: `embedding=[0.0] * 1536` — zero vectors never surface in pgvector cosine search |

**Fix needed:** Wire `nomic-embed-text` via Ollama for the nameplate text → embedding
step (same pattern as `ingest_gdrive_docs.py`'s `_embed()` function at line 202).

**Google Photos API note:** rclone `gphotos` remote only serves photos uploaded
by MIRA's own OAuth account (Google API restriction, March 2025). For existing
library photos, use Takeout.

## Pipeline 3 — Manufacturer Manuals (URL discovery + PDF download)
**Status:** ✅ NIGHTLY CRON (2:15am)

| Property | Value |
|----------|-------|
| Ingest script | `mira-core/scripts/ingest_manuals.py` |
| Discovery script | `mira-core/scripts/discover_manuals.py` |
| Cron (ingest) | `15 2 * * *` — daily 2:15am |
| Cron (discovery) | `0 3 * * 0` — Sunday 3am |
| source_type | `manual` |
| Entry count | 24,314 (largest source) |

**Run manually:**
```bash
doppler run --project factorylm --config prd -- \
  uv run --with pymupdf --with psycopg2-binary --with sqlalchemy \
  --with httpx --with beautifulsoup4 \
  python mira-core/scripts/ingest_manuals.py
```

## Pipeline 4 — Google Takeout (Bulk Photo Import)
**Status:** ⏳ WAITING — Takeout export in progress

| Property | Value |
|----------|-------|
| Pre-filter | `tools/prefilter_takeout.py` |
| Staging dir | `~/takeout_staging/` |
| Status | 5 complete ZIPs (001 + 3-001 through 3-004), ZIPs 3-005 through 3-008 downloading |

**Run when all ZIPs arrive:**
```bash
python3 tools/prefilter_takeout.py ~/takeout_staging/ \
  --output ~/takeout_staging/prefilter_results.csv
```

## Pipeline 5 — Interaction Anonymize + Ingest
**Status:** ✅ NIGHTLY CRON (2:00am / 2:05am)

| Property | Value |
|----------|-------|
| Anonymize | `mira-bots/scripts/anonymize_interactions.py` — daily 2:00am |
| Ingest | `mira-bots/scripts/ingest_interactions.py` — daily 2:05am |
| Purpose | Converts real tech conversations into anonymous training data |
