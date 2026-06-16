# Known Issues & Technical Debt
*Last updated: 2026-03-23*

## Open Issues

### 🔴 HIGH: Zero-vector embeddings in equipment photo ingest
- **File:** `mira-core/scripts/ingest_equipment_photos.py:158`
- **Code:** `embedding=[0.0] * 1536,  # placeholder — pgvector needs a vector`
- **Problem:** Photos ingested but zero vectors never surface in pgvector cosine
  similarity search — equipment photo knowledge is invisible to RAG
- **Fix:** Wire `nomic-embed-text` via Ollama for the nameplate text → embedding
  step (same `_embed()` pattern as `ingest_gdrive_docs.py:202`)
- **Impact:** All gphotos entries (currently 0, but any future ingest) unreachable via RAG

### 🟡 MEDIUM: test_image_downscale.py hardcoded expectation
- **File:** `mira-bots/tests/test_image_downscale.py`
- **Problem:** Test expects `MAX_VISION_PX=512` but code defaults to 1024
- **Pre-existing:** Yes (not introduced by recent work)
- **Fix:** Update test assertion to match code, or add env var override in test

### 🟡 MEDIUM: test_slack_relay.py and test_tts.py import errors
- **Files:** `mira-bots/tests/test_slack_relay.py`, `mira-bots/tests/test_tts.py`
- **Problem:** Import errors when running pytest — missing deps in test PYTHONPATH
- **Pre-existing:** Yes
- **Fix:** Add required dependencies to test environment or mock at import level

### 🟡 MEDIUM: mira-mcpo uses :latest image tag
- **File:** `mira-core/docker-compose.yml`
- **Code:** `image: mira-core-mira-mcpo:latest`
- **Problem:** Violates PRD constraint "Never `:latest` or `:main`"
- **Fix:** Pin to exact digest after next build

### 🟡 MEDIUM: Google Photos API restriction
- **Problem:** rclone `gphotos` remote only serves photos it uploaded (Google API
  change, March 31 2025). Existing library not accessible via rclone.
- **Workaround:** Use Google Takeout for existing photos, rclone for new uploads going forward
- **Status:** Takeout export in progress (ZIPs 3-005 through 3-008 still downloading as of 2026-03-23)

## Resolved Issues
- ✅ GDrive ingest pipeline (2026-03-23) — sync_gdrive_docs.sh + ingest_gdrive_docs.py, 894 entries
- ✅ 5 conversation continuity bugs (v0.4.1)
- ✅ Photo buffer race condition (bot.py — PHOTO_BUFFER flush logic)
- ✅ Session context tracking (engine.py — session_context preserved across messages)
- ✅ pymupdf → pdfplumber license compliance (ingest_manuals.py)
- ✅ Langfuse tracing wired (4 spans, Doppler keys, us.cloud.langfuse.com)
- ✅ Direct commits to main blocked (pre-commit hook enforced)
- ✅ mira.db gitignored (data/mira.db in .gitignore)
