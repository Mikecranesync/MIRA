# MIRA — Institutional Knowledge

Extracted from 38 Claude Code sessions (158MB), Mar 11–27, 2026.
This file contains deep context that doesn't belong in CLAUDE.md but matters for anyone continuing development.

---

## Architecture Decisions & Rationale

### Supervisor/Worker over NemoClaw (Mar 17)
NemoClaw/NeMo Guardrails was evaluated for structured diagnostic flow control. Investigation found it was not production-ready — the PyPI package existed but had no stable API. Built a custom `Supervisor` class in `mira-bots/shared/engine.py` instead, with a `Worker` pool pattern (vision, RAG, intent classification). The supervisor routes messages through an FSM state machine (IDLE -> Q1 -> Q2 -> Q3 -> DIAGNOSIS) and coordinates workers.

### NeonDB for Vector Storage (Mar 18)
Discovered 17,309 manual chunks already existed in `knowledge_entries` table with 768-dim `nomic-embed-text` embeddings (Rockwell, Siemens, ABB, etc.). This table was populated by a prior pipeline but **nothing queried it at runtime**. The live bot was using an empty `mira_documents` table. Rewired `mira-bots/shared/neon_vectors.py` to query the existing data. Uses `NullPool` because Neon's PgBouncer handles pooling.

### CLIP + Ollama 3-Stage Photo Pipeline (Mar 22-24)
Problem: 17,551 photos from Google Takeout — mostly personal, some industrial equipment. Solution:
1. **Stage 1 (CLIP/SigLIP)** — Fast binary classification on travel laptop. 15,815 images in 23 minutes (11 img/s). Result: 5,158 industrial (32.6%), 10,359 personal (65.5%).
2. **Stage 2 (Ollama qwen2.5vl on Bravo)** — Deeper triage of CLIP's industrial bucket. 5,456 images at 3.9 sec/img. Result: 3,694 confirmed equipment, 1,762 rejected.
3. **Stage 3 (NeonDB ingest)** — Confirmed photos get vision analysis + embedding + KB storage.

Key learning: SigLIP cosine similarity normalization was broken initially — needed softmax with model's logit scale, not raw scores.

### Docling for PDF Ingest (Mar 25-26)
Evaluated Docling (IBM open-source) as a PDF parsing adapter for the ingest pipeline. Advantages over existing PyMuPDF: better table extraction, layout-aware chunking, handles multi-column industrial manuals. Implemented behind a feature flag in `mira-core/mira-ingest/`. On `feat/docling-pdf-adapter` branch, merged into `feature/vim`.

### VIM Phased Architecture (Mar 24-27)
Vision Intelligence Module built in 8 sub-phases to minimize risk to existing MIRA:
- 1A: Config dataclasses (`mira-hud/vim/config.py`)
- 1B: Military TM source registry + downloader
- 1C: TM PDF parser with structured manifest
- 1D: NeonDB adapter with schema migration
- 2A: OpenCV geometric scene scanner (CPU-only Layer 1)
- 2B: YOLOv8 semantic classifier (Layer 2, 37.8ms on Charlie MPS)
- 3: Session state machine + scan loop orchestrator
- 4: AR renderer + Socket.IO bridge + HUD integration

Two-layer detection: Layer 1 (OpenCV geometric) runs on CPU for every frame, Layer 2 (YOLOv8) runs on MPS/GPU only when Layer 1 finds candidates. Total pipeline: 37.8ms on Charlie — 13x under 500ms budget.

---

## What Was Tried & Abandoned

### NemoClaw / NeMo Guardrails (Mar 17)
**What:** Structured flow control for diagnostic conversations.
**Why abandoned:** PyPI package existed but no stable API, sparse docs, no community adoption. Would have added a heavy dependency for something achievable with a simple FSM.
**Replaced with:** Custom `Supervisor` class with FSM state machine in `engine.py`.

### PRAW OAuth for Reddit Benchmark (Mar 20)
**What:** Reddit API via PRAW library for harvesting maintenance questions.
**Why abandoned:** Required Reddit app registration, OAuth flow, credential management, `praw` dependency. Too heavy for what turned out to be a simple JSON scrape.
**Replaced with:** Reddit's public `.json` endpoints — zero credentials, no dependency.

### zhangzhengfu Nameplate Dataset (Mar 22)
**What:** Public dataset for training/testing nameplate vision.
**Why abandoned:** GitHub repo was empty. Actual data behind Baidu Pan links (dead). No license. No semantic labels.
**Replaced with:** Own golden set from Google Photos (3,694 equipment images) + synthetic Pillow-rendered nameplates.

### Google Photos API Direct (Mar 22)
**What:** OAuth2 with `photoslibrary.readonly` scope for pulling equipment photos.
**Why abandoned:** OAuth consent screen in "Testing" mode silently returned empty results. Adding test users and re-scoping required multiple GCP console round-trips. Token kept going stale.
**Replaced with:** rclone configured as `googlephotos:` remote — simpler auth, more reliable.

### GWS CLI for Gmail (Mar 23)
**What:** Google Workspace CLI for searching Gmail for Takeout zip attachments.
**Why abandoned:** `-s drive,gmail` scope flag didn't register properly on Windows. Multiple auth attempts failed. GWS CLI is npm-based and fights with Windows.
**Replaced with:** IMAP connection using Doppler-stored app passwords.

### glm-ocr Model (Mar 17)
**What:** Dedicated OCR model for reading HMI screens and nameplates.
**Why abandoned:** Consistent HTTP 400 errors regardless of image size (tested at 1280px, 800px). Model appears broken or incompatible with current Ollama version.
**Replaced with:** qwen2.5vl handles both vision analysis and text extraction in one pass.

---

## Recurring Problems & Their Fixes

### macOS Keychain Lock Over SSH
**Symptom:** `docker build`, `docker pull`, and `doppler` all fail when SSHing into Bravo or Charlie. Error: keychain locked / credential helper fails.
**Root cause:** macOS keychain requires a GUI session to unlock. Over SSH there's no desktop session.
**Fix for Docker:** Remove `credsStore: desktop` from Docker config, or use `docker cp` + `docker commit` + `docker restart` workaround.
**Fix for Doppler (Bravo):** `doppler configure set token-storage file --scope /Users/bravonode/Mira` — stores auth token in a file instead of keychain.
**Charlie status:** Still broken as of Mar 27. Needs the same `token-storage file` fix.

### Bot Response Quality (Ongoing)
Multiple rounds of fixes across sessions 9, 16, 17, 19, 25, 28:
1. **off_topic guardrail hijacking non-IDLE messages** — `classify_intent()` returned "off_topic" for follow-up text in ELECTRICAL_PRINT state. Fix: Only fire off_topic check in IDLE state (`engine.py:221-231`).
2. **Vision misclassification** — HMI alarm screens classified as ELECTRICAL_PRINT instead of EQUIPMENT_PHOTO. Fix: Added `SCREEN_KEYWORDS` list in `vision_worker.py` (alarm, hmi, display, screen, tablet, scada).
3. **JSON parse failures** — Emoji surrogate characters in LLM output caused `json.loads` to fail, surfacing "I had trouble formatting my response". Fix: Strip surrogates before parsing.
4. **Intent guard false positives** — Real maintenance questions like "my VFD is faulting" caught as greetings by `classify_intent()`. 15/16 Reddit benchmark questions hit this. Partially addressed but still an open issue.
5. **Manufacturer-filtered retrieval** — Siemens content returned for GS10 queries because keyword overlap outranks manufacturer match. 84% precision for correct manufacturer, 16% cross-contamination.

### OAuth/Token Lifecycle
**Pattern:** Every OAuth integration (Google Photos, GWS, rclone) hit the same wall:
1. Token obtained before API was enabled in GCP console
2. Token has stale scopes baked in
3. Consent screen in "Testing" mode silently returns empty data
**Rule:** After enabling any new GCP API or adding scopes, **always force re-authentication** to get a fresh token. Delete the old token file first.

### NeonDB SSL from Windows
**Symptom:** `channel_binding` error when connecting to NeonDB from Windows Python.
**Root cause:** Windows SSL implementation handles channel binding differently.
**Workaround:** Run NeonDB-touching code from macOS (Bravo or Charlie). Affects Telethon test runner and benchmark scripts.

---

## Key Discoveries

### NeonDB Already Had 17,309 Knowledge Chunks (Mar 18)
The `knowledge_entries` table in NeonDB was populated by a prior pipeline with 768-dim nomic-embed-text embeddings covering Rockwell, Siemens, ABB, and other manufacturers. The live bot was querying an empty `mira_documents` table instead. Wiring the existing data into the RAG pipeline was the single highest-impact change — went from zero retrieval to 17K+ chunks overnight.

### v1.0.0 PRD Was 60% Fiction (Mar 12)
Exhaustive fact-check against the actual repos found 8 of 13 "already built" claims in the v1.0.0 PRD were false:
- No photo handler (zero vision integration)
- No `scripts/` directory (no anonymize, seed, or ingest scripts)
- No v1.0.0 git tags
- No Doppler integration
- No photo pipeline
- Multiple other features listed as complete but not present in code

**Lesson:** Always verify PRD claims against `git log` and actual file contents before building on top of them.

### Photo Pipeline Yield: 21% Equipment (Mar 24)
Of 17,551 total Google Photos images:
- CLIP Stage 1: 32.6% classified as industrial (overestimates — includes buildings, outdoor scenes)
- Ollama Stage 2: 67.7% of CLIP's industrial bucket confirmed as actual equipment
- **Net yield: 3,694 equipment photos (21% of total)** — usable for KB enrichment and Regime 3 testing

### VIM Two-Layer Detection: 37.8ms on Apple Silicon (Mar 25)
Benchmark on Charlie (Mac Mini with MPS):
- Layer 1 (OpenCV geometric): ~5ms
- Layer 2 (YOLOv8 semantic): ~33ms
- Total: 37.8ms — 13x under 500ms real-time budget
- CPU-only fallback on travel laptop: ~200ms (still under budget)
