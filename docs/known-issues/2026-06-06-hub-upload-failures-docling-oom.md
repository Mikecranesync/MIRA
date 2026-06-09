# Hub knowledge-upload failures — root cause + fix (2026-06-06)

**Reporter:** Mike (remote). **Branch:** `fix/docling-to-tika-upload-recovery`.

## Symptoms
1. `Failed: fetch failed` — `MSR220K6_OM_ZIEHL_2024-07-16.pdf` (staging Hub `100.68.120.99:4101`)
2. `Failed: ingest 422: Open WebUI extraction failed for PLCProgramming.pdf. Try re-uploading.` (**prod** `app.factorylm.com`)

## Root cause #1 — "fetch failed" (staging) — BY DESIGN
`100.68.120.99:4101` is the **staging-vps stack**, which intentionally omits mira-ingest + Open WebUI
(`docker-compose.staging-vps.yml` header). The staging Hub is wired `INGEST_URL=disabled://staging`.
`/kr` upload → `forwardToIngest` → `fetch("disabled://staging/...")` → undici `TypeError: fetch failed`
(cause: *unknown scheme*), re-thrown verbatim at `mira-ingest-client.ts`. Every doc upload on staging
fails this way. Fix: Hub shows a clear "ingestion disabled in staging" message (this branch).

## Root cause #2 — "ingest 422 / OW extraction failed" (prod) — DOCLING OOM/TIMEOUT
Live prod diagnostics (2026-06-06, read-only SSH):

```
mira-docling-saas: OOMKilled=false Restarts=5 Status=running   # on-failure:5 restart budget EXHAUSTED
docker stats: mira-docling-saas  2.869GiB / 3GiB  95.65%        # pinned at cap at near-idle
host free -h: 7.8Gi total, 344Mi free; swap 4.0Gi, 247Mi free  # chronically memory-starved
docling logs: dozens of "POST /v1/convert/file HTTP/1.1 504 Gateway Timeout"
```

`ingest_document_kb` uploads to OW, then `_poll_file_status` polls OW's process-status. When Docling
504-times-out / OOMs, OW returns `failed` → ingest raises 422. Image-heavy PLC PDF + `PDF_EXTRACT_IMAGES=true`
+ 3 GB cap on a swap-thrashing 8 GB box = guaranteed failure. Recurrence of the known VPS-OOM-via-ingest pattern.

OW config note: `CONTENT_EXTRACTION_ENGINE` is a **PersistentConfig** var — with `ENABLE_PERSISTENT_CONFIG=True`
(default) the OW DB value wins over compose env. Prod's DB holds `docling`. So the compose env change alone
is inert on the existing prod DB → must run the one-time flip script (below).

## Fix (this branch)

**A. Docling → Apache Tika** (OW-endorsed for production; ~0.6–1 GB JVM+Tesseract vs Docling's 3 GB; Apache 2.0).
- `docker-compose.saas.yml`: dropped `mira-docling-saas` (3 GB), added `mira-tika-saas`
  (`apache/tika:3.1.0.0-full`, 1 GB); mira-core env → `CONTENT_EXTRACTION_ENGINE=tika`,
  `TIKA_SERVER_URL=http://mira-tika-saas:9998`. Net RAM win ~2 GB.
- `mira-core/docker-compose.yml` + `docker-compose.override.yml`: same swap for the local stack
  (local was silently on the default pypdf engine — no OCR — with a wrong default Tika URL).
- **`mira-core/scripts/set-ow-extraction-engine.sh`** — one-time post-deploy flip of the OW DB value
  (env is inert on an existing DB). The update POST persists immediately but hangs ~20 s on re-init;
  the script tolerates the timeout and verifies via GET.

  **Validated on CHARLIE local (2026-06-06), including the actual failing file:**
  - Plumbing: pushed a text PDF through `mira-ingest → OW → Tika` →
    `{"status":"ok","processing_status":"completed"}`.
  - **The real failure mode:** pulled the exact `PLCProgramming.pdf` that 422'd on prod (read-only
    from prod OW storage) — a 120-page, 133-image, 16-font doc (image-heavy, the profile that
    OOM'd Docling). Ran it through **Tika-full** (Tesseract OCR): extracted **61,151 chars in 29.6 s,
    peak 295 MiB** (well under the 1 GB cap). Completes, non-empty, no failure. The file Docling
    couldn't handle extracts cleanly on Tika.

**B. Recovery / retry loop (ingest)** — `_poll_file_status` failed/timeout now retries the OW
extraction with backoff before surfacing a 422, and the 422 detail distinguishes timeout vs failed vs empty.

**C. Local-upload retry (hub)** — failed local uploads previously could not be retried (buffer discarded).
Buffer is now persisted so `/api/uploads/:id/retry` works for local uploads too.

**D. Failure reporting (hub)** — the uploads list surfaces the real failure reason + a retry affordance.

## Deferred follow-up (blocked)
OW's **other** documented memory leak — in-container SentenceTransformers embeddings — is live on prod
(`RAG_EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2`, by omission). The fix is
`RAG_EMBEDDING_ENGINE=ollama`, but prod's `OLLAMA_BASE_URL=http://100.86.236.11:11434` (Bravo over
Tailscale) is **currently unreachable** from prod (verified 2026-06-06 — matches the known embedder ops gap).
Dropping Docling frees ~3 GB, so the in-container embedder has ample headroom for now. Revisit once the
prod→Bravo embedder path is fixed.

## Deploy discipline + the cutover risk (READ BEFORE DEPLOYING)
Engine/ingest change → staging gate → `deploy-vps.yml` (no direct VPS compose).

**The cutover is the risky part, not the code.** `CONTENT_EXTRACTION_ENGINE` is OW PersistentConfig, so
the prod DB value (`docling`) wins over the new compose env until it's flipped. But the prod 8 GB box is
RAM-critical (344 MB free) and **cannot run Docling (2.87 GB) and Tika simultaneously** — so the deploy
*must* remove Docling. That creates a window where OW's DB still points extraction at the now-deleted
`mira-docling-saas` → uploads hard-fail (connection refused) until the engine is flipped to Tika.

Two ways to close that window — pick ONE at deploy time:

- **Option A (recommended, no window): `ENABLE_PERSISTENT_CONFIG=False` on mira-core.** Makes compose env
  authoritative → on restart OW immediately uses `CONTENT_EXTRACTION_ENGINE=tika` from env, no flip script,
  no dead window. **Caveat:** any OW setting tuned only via the admin UI (not in compose env) reverts to
  env/OW-default on restart. Safe ONLY if OW's RAG settings were never hand-tuned in the UI (MIRA treats OW
  as headless/config-as-code, and prod's persisted `rag` config subtree read empty on 2026-06-06 — but this
  was not fully verifiable from a code session; confirm with the operator).
- **Option B (flip script): keep `ENABLE_PERSISTENT_CONFIG` default.** Immediately after `up -d` and once
  `mira-tika-saas` is healthy, run `scripts/set-ow-extraction-engine.sh`. There is a brief dead window
  between container start and the flip — run it as the very next step, do not defer. Fragile if forgotten.

Either way, after cutover verify a real PDF upload returns `processing_status=completed` before declaring done.
