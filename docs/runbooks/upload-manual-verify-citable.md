# Runbook: Upload a Manual and Verify It Is Citable in Chat

**Updated:** 2026-06-06
**Cross-links:** `docs/architecture/rag-pipeline.md`, `docs/adr/0019-miradrop-ingest-v2.md`,
`mira-core/mira-ingest/CLAUDE.md`, `tools/mira-drop-watcher/README.md`

---

## Critical context — the upload-retrieval gap

**Hub web uploads and MiraDrop BOTH route to Open WebUI only. They do NOT write
to `knowledge_entries`. All chat retrieval reads only `knowledge_entries`.
Uploaded manuals are therefore NOT citable in any diagnostic channel.**

This is a known architectural gap. Source verification:

- `mira-core/mira-ingest/main.py:818` — `/ingest/document-kb` endpoint writes
  to OW via `OPENWEBUI_URL/api/v1/files/` (line 962) and
  `OPENWEBUI_URL/api/v1/knowledge/{collection_id}/file/add` (line 991).
  It calls `tenant_ingested_files_record()` (line 1012) for the dedup ledger.
  It does **not** call `insert_knowledge_entry()`.
- `mira-hub/src/lib/local-upload.ts` — `handleLocalUpload()` calls
  `forwardToIngest()` for PDFs; no branch to `knowledge_entries`.
- `mira-hub/src/lib/mira-ingest-client.ts:79-80` — `forwardToIngest()` posts to
  `${process.env.INGEST_URL}/ingest/document-kb`.
- `mira-bots/shared/neon_recall.py` — `recall_knowledge()` queries
  `knowledge_entries` via pgvector cosine. OW KB is a separate path reached only
  by `_call_openwebui()` in `mira-pipeline`.
- ADR: `docs/adr/0019-miradrop-ingest-v2.md` — documents the fix design
  (`mira-ingest-v2` writing to `knowledge_entries` with UNS attribution). No
  code yet as of 2026-06-06.

**The only way to make a document citable in chat today is via batch ingest
scripts that write directly to `knowledge_entries`.**

Batch scripts that DO write to `knowledge_entries`
(`docs/architecture/INGEST_PIPELINES.md`):
- `scripts/ingest_manuals.py` — manufacturer manuals from `manual_cache`/`manuals` tables
- `scripts/ingest_gdrive_docs.py` — Google Drive documents
- `scripts/ingest_gmail_takeout.py` — Gmail Takeout exports

---

## Prerequisites

- Doppler CLI authenticated: `doppler --version` must return a version
- Doppler config `factorylm/prd` contains `NEON_DATABASE_URL`, `MIRA_TENANT_ID`,
  `OPENWEBUI_API_KEY`, `OPENWEBUI_BASE_URL`, `OLLAMA_BASE_URL`
- Python 3.12, `psycopg`, `httpx` available
- MIRA services running locally or on VPS (for hub-upload path only)
- For batch ingest: Ollama running at `OLLAMA_BASE_URL` with `nomic-embed-text-v1.5`
  and `nomic-embed-vision-v1.5` pulled (`ollama pull nomic-embed-text:v1.5`)

---

## Option A — Hub web upload (NOT citable in chat — for OW KB only)

This path stores the document in the Open WebUI "Facility Documents" collection
for the OW UI (sunset), NOT in `knowledge_entries` for chat recall. Use it only
if you need OW KB indexing.

**Steps:**

1. Open `https://app.factorylm.com/knowledge/manuals` in your browser.
2. Click **Upload** and select the PDF.
3. The upload POSTs to `/api/uploads/folder` → `handleLocalUpload()` →
   `forwardToIngest()` → `/ingest/document-kb`.
4. You will see the file appear in the OW Knowledge collection.

**Expected output:**

- Hub shows the filename in the manuals list.
- `mira-core` container logs show a 200 from `/ingest/document-kb`.
- `tenant_ingested_files_record()` writes a dedup ledger row (not `knowledge_entries`).

**What can go wrong:**

| Symptom | Cause | Fix |
|---|---|---|
| "fetch failed" or 502 on upload | INGEST_URL not set or mira-ingest down | Check `INGEST_URL` env var on mira-hub container; restart mira-ingest |
| Upload succeeds but file absent from OW UI | OW collection sync lag | Reload OW Admin → Knowledge; wait 30 s |
| Staging shows "fetch failed" silently | By design: `INGEST_URL=disabled://staging` at `docker-compose.staging-vps.yml:309` | Staging has no ingest — test against dev or prod |

---

## Option B — MiraDrop drop-folder (NOT citable in chat — same OW path)

`tools/mira-drop-watcher/README.md` documents the daemon. Drop folder:
`~/MiraDrop/inbox/`. POSTs to Hub `/api/uploads/folder` — same OW path as
Option A.

**Start the daemon (if not running):**

```bash
launchctl load ~/Library/LaunchAgents/com.factorylm.mira-drop-watcher.plist
```

**Drop a PDF:**

```bash
cp /path/to/manual.pdf ~/MiraDrop/inbox/
```

**Expected output (~20 s):**

- Sidecar file `~/MiraDrop/done/manual.pdf.ingest.json` with `kb_file_id`.
- Hub `/knowledge/manuals` shows the file.
- `knowledge_entries` is NOT updated.

---

## Option C — Batch ingest to `knowledge_entries` (CITABLE in chat)

This is the only path that makes documents retrievable in diagnostic chat.

### Step 1: Prepare the manual record

The `ingest_manuals.py` script reads from the `manuals` NeonDB table. If your
document is not yet in that table, you must insert a row. Use the staging NeonDB
for testing (`factorylm/stg`), then prod (`factorylm/prd`).

⚠️ NEVER run raw SQL against the prod NeonDB from a code session — use `db-inspect.yml`
or the staging branch for verification. Migrations go through `apply-migrations.yml`.

### Step 2: Run the ingest script (staging first)

```bash
# Dry-run against staging
doppler run --project factorylm --config stg -- \
  python3 scripts/ingest_manuals.py --dry-run

# Commit to staging, verify retrieval
doppler run --project factorylm --config stg -- \
  python3 scripts/ingest_manuals.py
```

**Expected output:**

```
INFO  Processing manual: <manufacturer> <model> v<version>
INFO  Chunked into N chunks
INFO  Embedded chunk 1/N
INFO  Inserted knowledge_entry id=<uuid>
INFO  Done: N chunks ingested for <source_url>
```

### Step 3: Verify citability in NeonDB (staging)

The following query checks that the ingest landed. Use `psql` pointed at the
staging endpoint (never prod from a code session):

```bash
doppler run --project factorylm --config stg -- \
  psql "$NEON_DATABASE_URL" -c "
    SELECT id, tenant_id, source_url, chunk_index, created_at
    FROM knowledge_entries
    WHERE tenant_id = '<your-tenant-id>'
      AND source_url ILIKE '%<keyword>%'
    ORDER BY chunk_index
    LIMIT 10;
  "
```

**Expected output:** Rows with `source_url` matching the manual filename or URL,
`chunk_index` 0, 1, 2…, and recent `created_at`.

**Zero rows means the document is NOT citable.** Check the ingest log for errors.

### Step 4: Verify retrieval (staging)

After ingest, send a diagnostic query to the staging engine that should require
the manual's content:

```bash
doppler run --project factorylm --config stg -- \
  python3 tests/eval/offline_run.py --suite text
```

Check the output in `tests/eval/runs/` for `CitGrond` checkpoint — a green
CitGrond indicates the engine found and cited a knowledge entry.

### Step 5: Promote to prod (via workflow)

```bash
gh workflow run apply-seeds.yml -f env=prd -f seed=<seed-name>
```

Or for manual ingest:

```bash
doppler run --project factorylm --config prd -- \
  python3 scripts/ingest_manuals.py
```

---

## Verification: confirm a document IS citable

After ingest, run a targeted probe:

```bash
# Check knowledge_entries count for your tenant
doppler run --project factorylm --config stg -- \
  psql "$NEON_DATABASE_URL" -c "
    SELECT count(*), min(created_at), max(created_at)
    FROM knowledge_entries
    WHERE tenant_id = '<tenant-id>'
      AND source_url ILIKE '%<filename>%';
  "
```

Then send a question to the engine that should surface that document and verify
the `evidence` field in the structured response includes a chunk from the file.

---

## What can go wrong

| Symptom | Cause | Fix |
|---|---|---|
| Ingest completes but `knowledge_entries` shows 0 rows | `insert_knowledge_entry` silently deduped or errored | Check logs for `NOTICE: Duplicate` or exception; inspect `(tenant_id, source_url, chunk_index)` dedup key |
| Embedding fails with connection error | Ollama not reachable at `OLLAMA_BASE_URL` | `curl $OLLAMA_BASE_URL/api/tags` — start Ollama, pull `nomic-embed-text:v1.5` |
| recall returns 0 results even after ingest | BM25 index stale or `content_tsv` null | `SELECT count(*) FROM knowledge_entries WHERE content_tsv IS NULL` — trigger a re-index or re-run ingest |
| Chat answer not citing the document | Evidence assembled but confidence filtered | Check `recall_knowledge()` in `mira-bots/shared/neon_recall.py` — pgvector returns top-5 by cosine; low similarity drops below threshold |
| OW upload succeeds, document absent from recall | Structural gap — OW KB ≠ `knowledge_entries` | Use Option C (batch ingest). ADR-0019 is the fix design but has no code yet. |

---

## Future fix

`docs/adr/0019-miradrop-ingest-v2.md` — `mira-ingest-v2` will write directly to
`knowledge_entries` with UNS attribution via a Slack confirmation dialogue. No
code as of 2026-06-06. Until it ships, Option C is the only path to citability.
