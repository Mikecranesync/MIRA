# Hub knowledge-upload failures — root cause + fix plan (2026-06-06)

**Reporter:** Mike (remote)
**Surfaces:** Hub `/kr` upload — two distinct errors.

## Symptoms
1. `Failed: fetch failed` — `MSR220K6_OM_ZIEHL_2024-07-16.pdf` (on staging Hub `100.68.120.99:4101`)
2. `Failed: ingest 422: Open WebUI extraction failed for PLCProgramming.pdf. Try re-uploading.` (on **prod** `app.factorylm.com`)

## Root cause #1 — "fetch failed" (staging) — BY DESIGN, not a bug
`100.68.120.99:4101` is the **staging-vps stack**, which intentionally omits mira-ingest + Open WebUI
to fit the VPS RAM budget (`docker-compose.staging-vps.yml` header comment).
The staging Hub is wired `INGEST_URL=disabled://staging` (line 309), `OPENWEBUI_BASE_URL=disabled://staging`.

`/kr` upload → `runIngestPipeline` → `forwardToIngest` → `fetch("disabled://staging/ingest/document-kb")`.
Node's undici throws `TypeError: fetch failed` (cause: *unknown scheme*) on the `disabled:` scheme,
and `mira-ingest-client.ts:101` re-throws it verbatim. Verified empirically.
**Every document upload on staging fails this way — staging has no ingestion pipeline.**

Fix: cosmetic — Hub should detect `INGEST_URL` starting with `disabled://` and show
"ingestion disabled in staging" instead of raw "fetch failed". (Optional.)

## Root cause #2 — "ingest 422 / OW extraction failed" (prod) — DOCLING OOM/TIMEOUT
Live prod diagnostics (2026-06-06, read-only SSH):

```
mira-docling-saas: OOMKilled=false Restarts=5 Status=running   <- restart budget (on-failure:5) EXHAUSTED
docker stats: mira-docling-saas  2.869GiB / 3GiB  95.65%        <- pinned at cap at near-idle
host free -h: 7.8Gi total, 344Mi free; swap 4.0Gi, 247Mi free  <- chronically memory-starved, swap thrashing
docling logs: repeated "POST /v1/convert/file HTTP/1.1 504 Gateway Timeout"  <- conversions chronically time out
```

`ingest_document_kb` (main.py:818) uploads the PDF to OW, then `_poll_file_status` (main.py:359)
polls OW's `/files/{id}/process/status`. When OW's Docling extraction times out / OOMs,
status returns `failed` → ingest raises HTTP 422 "Open WebUI extraction failed for {fname}".
Image-heavy PLC PDF + `PDF_EXTRACT_IMAGES=true` + 3 GB cap on a swap-thrashing 8 GB box = guaranteed failure.
This is the recurrence of the known VPS-OOM-via-ingest pattern.

OW config note: `CONTENT_EXTRACTION_ENGINE` is NOT in the container env, yet Docling receives convert
calls → the engine is set via OW's **persisted DB config** (OW seeds RAG settings from env only on
first boot; thereafter the DB value wins). The reliable switch is the OW admin Documents settings or
the config API, in addition to the compose env.

## Fix plan
**A. Replace Docling with Apache Tika (OW-endorsed for production).**
- `CONTENT_EXTRACTION_ENGINE=tika`, `TIKA_SERVER_URL=http://mira-tika:9998`
- Add `apache/tika:<pinned>-full` container (~0.6-1 GB, Tesseract OCR built in) — drop `mira-docling-saas` (3 GB).
- Apache 2.0 license (PRD §4 compliant). Net RAM win ~2 GB.
- Also fix the 2nd OW memory leak: move embeddings off in-container SentenceTransformers to Ollama
  (`RAG_EMBEDDING_ENGINE=ollama`) if an Ollama embedder is reachable — separate, optional.

**B. Recovery / retry loop (ingest).**
- `_poll_file_status` failed/timeout → retry the OW extraction with backoff (N attempts) before 422.
- Distinguish failure reasons in the 422 detail (timeout vs failed vs empty) instead of generic "Try re-uploading".

**C. Local-upload retry (hub).**
- Today local uploads can't retry (`local_retry_requires_re_upload`, buffer discarded —
  `uploads/[id]/retry/route.ts:34`). Persist the buffer (or object store) so failed local
  uploads can be retried without the user re-picking the file.

**D. Failure reporting.**
- Surface the real OW failure reason in the Hub uploads list + structured log/metric.

## Deploy discipline
Engine/ingest change → staging gate → `deploy-vps.yml` (no direct VPS compose). Prod is RAM-critical;
swapping docling→tika should be done as a single deploy with the docling container removed.
