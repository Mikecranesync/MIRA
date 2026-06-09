# PDF Upload Flow

> **Cross-links:** `docs/architecture/INGEST_PIPELINES.md` (offline batch pipelines — NOT this path), `docs/architecture/photo-kb-pipeline.md` (Google Takeout offline pipeline). This document covers the **interactive Hub upload** path only.
>
> **Last verified:** 2026-06-06 against source on branch `docs/comprehensive-runbooks-2026-06-06`.

## Summary

A user uploads a PDF via the Hub UI. The file is pushed to Google Drive (or Dropbox), the Hub records the upload row, then fires an async ingest pipeline that posts the raw bytes to `mira-ingest`, which delegates all text extraction, chunking, and embedding to Open WebUI. The chunks land in the Open WebUI knowledge collection **only** — they are **never written to `knowledge_entries`**, which means they are not retrievable by the diagnostic engine's NeonDB recall path.

---

## The Flow

### Stage 1 — Hub API receives the upload

**File:** `mira-hub/src/app/api/uploads/route.ts`

1. **Client POST `POST /api/uploads`** with `multipart/form-data` containing `file`, `assetTag`, `unsPath`, and `provider` (`"google"` or `"dropbox"`).
2. Route validates MIME type (PDF or image), file size (≤20 MB), and `unsPath` format.
3. Route calls `findUploadByExternalFileId()` — if a matching row already exists in `hub_uploads`, returns early (idempotency).
4. Route inserts a new row into **`hub_uploads`** with `status = "pending"`.
5. Route calls `runIngestPipeline(upload, file)` as a **fire-and-forget Promise** (does not await) and immediately returns `202 Accepted` to the client.

### Stage 2 — Ingest pipeline fetches and routes

**File:** `mira-hub/src/lib/upload-pipeline.ts`

6. `runIngestPipeline()` at **line 58** updates `hub_uploads.status = "fetching"`.
7. For provider `"google"`: fetches the file bytes from Google Drive using the stored OAuth token. For signed URLs: fetches directly.
8. Determines routing by `upload.kind`:
   - `kind !== "photo"` → calls `forwardToIngest()` at **line 89** (PDF path).
   - `kind === "photo"` → calls `forwardToPhotoIngest()` at **line 80** (separate path; not this doc).
9. On success: updates `hub_uploads.status = "parsed"`. On failure: sets `hub_uploads.status = "failed"` and records `error_message`.

### Stage 3 — Hub ingest client forwards to mira-ingest

**File:** `mira-hub/src/lib/mira-ingest-client.ts`

10. `forwardToIngest()` at **line 73**: POSTs `multipart/form-data` to `${INGEST_URL}/ingest/document-kb` where `INGEST_URL` is env var (set to `disabled://` on staging — uploads accepted but not forwarded).
11. Returns `{ fileId: string | null, chunkCount: number | null }`.

### Stage 4 — mira-ingest processes the document

**File:** `mira-core/mira-ingest/main.py`

12. `POST /ingest/document-kb` handler at **line 818** (`ingest_document_kb()`).
13. **GATE 1 — Content-hash dedup** (line 886): `tenant_ingested_files_lookup(sha256_hex, tenant_id)` queries **`tenant_ingested_files`**. If already ingested, returns `{"status": "duplicate"}`.
14. **GATE 2 — Relevance gate** (line 911): Skipped unless `relevance_gate=on` param AND `RELEVANCE_GATE_ENABLED=true` env var. When enabled, calls the LLM to classify whether the document is maintenance-relevant.
15. **Tier limit** (line 932–942): `check_tier_limit(tenant_id)` from `db/neon.py` — returns HTTP 429 if daily quota exceeded. Fail-open on DB errors.
16. **Collection routing** (line 944–946): `_route_collection()` selects the Open WebUI collection name based on tenant and document type.
17. **OW file upload** (line 960–970): `POST {OPENWEBUI_URL}/api/v1/files/` with raw PDF bytes. Returns `file_id`.
18. **Extraction poll** (line 979): `_poll_file_status(file_id)` — polls OW until extraction status is `"completed"` or timeout (300 s). **Open WebUI handles all text extraction, chunking, and embedding; mira-ingest performs no local parsing.**
19. **OW collection attach** (line 987–1004): `POST /api/v1/knowledge/{collection_id}/file/add` — attaches the extracted file to the tenant's knowledge collection.
20. **Dedup ledger** (line 1009–1012): `tenant_ingested_files_record(sha256_hex, tenant_id, file_id)` — writes to **`tenant_ingested_files`** to prevent future duplicate ingestion.

### ⚠️ THE GAP

The chunks written in step 18–19 live **exclusively inside Open WebUI's internal storage** (the OW database / vector index). They are **never written to `knowledge_entries`** in NeonDB. As a result, the diagnostic engine's primary recall path (`neon_recall.recall_knowledge()`) cannot retrieve content from Hub-uploaded PDFs.

The only path that writes to `knowledge_entries` from a user-triggered upload is the **demo shim** at `mira-hub/src/app/api/documents/upload/route.ts` — it does a direct single-row INSERT at line 68 with no chunking, no embedding, and no real ingest. It is explicitly labelled "NOT the full ingest pipeline" at line 29.

Offline batch scripts (`scripts/ingest_manuals.py`, `tools/mira-drop-watcher`) DO write to `knowledge_entries` through the full pipeline including docling, nomic-embed-text, and dedup checks — but those are separate from the Hub interactive upload path. See `docs/architecture/INGEST_PIPELINES.md`.

---

## Sequence Diagram

```
Client (browser)
     │
     │  POST /api/uploads (multipart, 20 MB max)
     ▼
mira-hub: uploads/route.ts
     │  INSERT hub_uploads (status="pending")
     │  return 202 immediately
     │
     │  [async fire-and-forget]
     ▼
mira-hub: upload-pipeline.ts:runIngestPipeline()
     │  UPDATE hub_uploads (status="fetching")
     │  fetch bytes from Google Drive / signed URL
     │  UPDATE hub_uploads (status="parsing")
     │
     │  POST /api/uploads → forwardToIngest()
     ▼
mira-hub: mira-ingest-client.ts:forwardToIngest()
     │
     │  POST ${INGEST_URL}/ingest/document-kb  (multipart)
     ▼
mira-core: mira-ingest/main.py:ingest_document_kb()
     │  check tenant_ingested_files (sha256 dedup)
     │  [opt] relevance gate LLM check
     │  check_tier_limit() → 429 if exceeded
     │  _route_collection()
     │
     │  POST {OW_URL}/api/v1/files/  (raw PDF bytes)
     ▼
Open WebUI (mira-core container)
     │  extract text  [Docling / Tika / built-in]
     │  chunk text
     │  embed chunks (nomic-embed-text-v1.5)
     │  store in OW internal KB
     ▼
mira-ingest/main.py (resumes after poll)
     │  POST /api/v1/knowledge/{collection_id}/file/add
     │  tenant_ingested_files_record()
     ▼
mira-hub: upload-pipeline.ts
     │  UPDATE hub_uploads (status="parsed")
     ▼
[done — chunks are in OW only, NOT in knowledge_entries]
```

---

## Tables Touched

| Table | DB | Written by | Read by | Notes |
|---|---|---|---|---|
| `hub_uploads` | NeonDB (mira-hub schema) | `uploads/route.ts`, `upload-pipeline.ts` | Hub UI | Tracks upload lifecycle status |
| `tenant_ingested_files` | NeonDB (mira-ingest schema) | `main.py:tenant_ingested_files_record()` | `main.py:tenant_ingested_files_lookup()` | SHA-256 dedup ledger |
| OW internal files table | Open WebUI SQLite/PG | OW `/api/v1/files/` | OW KB retrieval | Extracted text + chunk vectors; NOT accessible via NeonDB recall |
| OW knowledge collections | Open WebUI internal | OW `/api/v1/knowledge/*/file/add` | OW KB retrieval | Collection membership index |
| `knowledge_entries` | NeonDB | **NOT written by this path** | `neon_recall.recall_knowledge()` | The gap — engine cannot cite Hub-uploaded PDFs |

---

## What Can Go Wrong

| Failure | Where | Symptom | Notes |
|---|---|---|---|
| Google Drive OAuth expired | `upload-pipeline.ts` | `hub_uploads.status = "failed"`, `error_message` set | Re-auth via Nango (`src/lib/nango.ts`) |
| OW extraction timeout (>300 s) | `mira-ingest/main.py:_poll_file_status()` | Ingest returns error; `hub_uploads.status = "failed"` | Large PDFs or OW under load |
| `INGEST_URL=disabled://` | `mira-ingest-client.ts:forwardToIngest()` | Upload accepted by Hub; ingest silently skipped | This is intentional on staging |
| Duplicate upload | `main.py:tenant_ingested_files_lookup()` | Returns `{"status": "duplicate"}`, no re-ingest | Content-hash dedup is correct behavior |
| Tier limit exceeded | `main.py:check_tier_limit()` | HTTP 429 returned to Hub | Fail-open if NeonDB is unavailable |
| Relevance gate rejects | `main.py` (line 911) | Returns rejected response; not added to KB | Only fires when explicitly enabled |
| Chunks not findable in chat | `neon_recall.recall_knowledge()` | Engine replies "I don't have that information" | **Root cause: the gap** — OW KB ≠ `knowledge_entries` |
| Hub upload never reaches mira-ingest | Network / container failure | `hub_uploads` stuck at `"fetching"` | No retry logic in `upload-pipeline.ts`; manual re-trigger required |
