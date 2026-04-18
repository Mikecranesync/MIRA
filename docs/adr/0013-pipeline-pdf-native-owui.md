# ADR-0013: Let Open WebUI Handle PDF Ingestion Natively

## Status
Accepted

**Follows:** ADR-0008 (Sidecar Deprecation — mira-pipeline as chat path)

---

## Context

When a user sends a PDF through Telegram, the bot calls `POST /ingest/document-kb`
on mira-ingest, which chunks the document, embeds it, and pushes it to an Open WebUI
knowledge collection (Equipment Manuals, Electrical Prints, or Facility Documents).
This path works and remains unchanged.

The question is what happens when a user attaches a PDF **directly in Open WebUI chat**.
Open WebUI has its own file upload + RAG pipeline: it extracts text (via pypdf or Docling),
chunks it, embeds it, and makes the content available as context for the current
conversation — all without involving mira-pipeline or mira-ingest.

Two options were considered:

**Option A — Let Open WebUI handle PDFs natively.**
With Docling enabled (`DOCLING_SERVER_URL=http://mira-docling:5001`), Open WebUI's
extraction quality is industrial-grade (OCR, table parsing, semantic chunking). No
code change needed in the pipeline.

**Option B — Add a pipeline endpoint that accepts file uploads.**
A new `POST /v1/files` route would intercept uploads and forward them to mira-ingest.
This duplicates Open WebUI's native capability and adds complexity.

---

## Decision

**Option A.** Open WebUI + Docling handles in-chat PDF uploads natively. The pipeline
focuses exclusively on chat intelligence (GSD diagnostic engine), not file processing.

The P0-3 PDF forwarding code that previously existed in `mira-pipeline/main.py`
(which intercepted PDF file entries in chat completion requests and forwarded them to
mira-ingest in the background) has been removed. It duplicated Open WebUI's native
handling and could cause double-processing of the same document.

---

## Consequences

- **Telegram PDF path unchanged:** `mira-bots → mira-ingest → Open WebUI KB` remains
  the route for PDFs sent via Telegram. These are stored in permanent named collections.
- **Open WebUI chat PDFs:** Handled natively by Open WebUI + Docling. Available as
  context within the conversation, not stored in a named collection.
- **Docling must be running:** Both VPS and Bravo deployments must have `mira-docling`
  container running on `:5001` for industrial-grade extraction (OCR, table parsing).
- **Pipeline is simpler:** `mira-pipeline/main.py` no longer imports or references
  PDF ingestion logic. The `INGEST_SERVICE_URL` env var is no longer used by the pipeline.
- **Collection routing gap:** PDFs uploaded directly in Open WebUI chat do not get
  routed to named collections (Equipment Manuals, etc.). If persistent collection
  storage is needed, users should send the PDF via Telegram or use the batch ingest
  scripts.

---

## Verification

- `mira-docling` container healthy: `curl -s http://localhost:5001/health`
- Open WebUI has `DOCLING_SERVER_URL=http://mira-docling:5001` set
- Upload a test PDF in Open WebUI chat → extraction uses Docling (check mira-docling logs)
- Telegram PDF upload still works via mira-ingest path
