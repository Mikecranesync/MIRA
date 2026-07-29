# PLAN — Streaming ingest-v2, Slice 1 (memory-bounded node-attachment chunk writes)

**Branch:** `feat/streaming-ingest-v2` · **Authored:** 2026-06-13
**Supersedes:** PR #1933 (the upload-cap single-source-of-truth work — cherry-picked here)
**Touches:** `mira-hub/src/lib/node-knowledge-ingest.ts`, `mira-hub/src/lib/config.ts`,
`mira-core/mira-ingest/main.py`, + 3 vitest files under `mira-hub/src/lib/__tests__/`.

## Context

`writePdfChunksForNode` (added #1592, hardened #1806/#1903) is the **single v2 chunk
writer** — the as-built "folder = brain" path that makes a PDF attached to a UNS node
(and blind uploads routed to the per-tenant Inbox node) BM25-citable by writing
`knowledge_entries` rows directly, bypassing the legacy Open-WebUI → docling path.

Before this slice it: extracted **all** page text eagerly (`unpdf.extractText`,
`mergePages:false`), built **one array of every chunk** for the whole document, then
issued **one INSERT per chunk**. For a 1200-page manual that is an unbounded chunk
array and thousands of round-trips.

## Scope (the contract)

1. **Cap single-source-of-truth (cherry-picked from #1933).** `MAX_UPLOAD_MB` in
   `config.ts` is the one cap; routes + client read it. Kept at **50 MB** (clears the
   31.5 MB GS10 + 33 MB Rockwell manuals with headroom, under nginx's 100 M ceiling).
   `mira-ingest`'s `MIRA_MAX_UPLOAD_MB` default matched to 50.
2. **Bound the chunk accumulation.** Stream page-by-page: chunk a page, push into a
   buffer, flush as **one multi-row INSERT** at `BATCH_ROWS=50`, then drop the buffer.
   Each page's text string is released (`pages[p] = ""`) once chunked. Tenant constants
   (`tenant_id`/`source_url`/`doc_id`) are fixed leading params; only id/content/page/
   metadata vary per row → param count is `3 + 4·BATCH_ROWS`, not `O(total chunks)`.
3. **Concurrency guard.** `NODE_INGEST_CONCURRENCY` (default **1**) serializes parses
   via a slot semaphore with race-free hand-off (a releaser with a waiter hands its slot
   over without decrementing, so the active count never transiently exceeds the limit).
4. **Tests + this plan**, then PR superseding #1933.

## Honest memory accounting (read before raising the cap)

The batching in (2) bounds the **smallest** memory term. Peak for a large manual:

| Term | Size | Bounded by this slice? |
|---|---|---|
| Raw file buffer + `new Uint8Array(buffer)` copy | up to 2× the file (≤100 MB) | **No** |
| pdfjs `PDFDocumentProxy` | tens of MB for 1200 pages | **No** |
| `pages` (full extracted text, eager) | ~1× the text | **No** (still eager) |
| Chunk rows buffered | ≤ `BATCH_ROWS` chunks (~tens of KB) | **Yes** (was: all chunks) |

So the dominant term is the file buffer + extracted text, **not** the chunk array.
What contains it on the 8 GB VPS (ADR-0019 / `project_vps_oom_docling_incidents`) is the
**concurrency guard** (peak = one in-flight PDF at default concurrency 1), **not** the
batching. **`50 MB` is a deliberate POLICY bound, not an architectural one** — the path
still loads the whole file + all text into memory. Do **not** read "ingest-v2" as
"memory-safe at any size" and raise the cap or `NODE_INGEST_CONCURRENCY`; the ceiling is
`concurrency × per-parse-peak`, and per-parse-peak is `O(file size)`. The `Uint8Array`
copy is kept on purpose (pdfjs may detach its input buffer; Node Buffer pooling makes
that unsafe to share).

## Deferred to Slice 2 (what earns a higher cap)

Replace eager `extractText(pdf, {mergePages:false})` with a **per-page loop** over the
proxy (`pdf.getPage(i).getTextContent()` → join `items[].str`), chunking + flushing per
page so the text term becomes `O(one page)`, and drop the full-file copy. Only then is a
cap above 50 (toward nginx's 100 M) architecturally defensible. Cost: re-mock at the
`getPage` level and match unpdf's text-joining (spacing/EOL) to preserve chunk quality —
a real change, out of scope for Slice 1.

## Verify steps + results

- `npx vitest run` the 3 node-knowledge-ingest specs — **3 passed** (2026-06-13):
  - `…-is-private.test.ts` — #1903 `is_private = true` invariant holds against the new
    batched multi-row SQL (assertion rewritten shape-independently of param numbering).
  - `…-batching.test.ts` — 60 single-chunk pages → exactly **2** inserts (50 + 10 tuples),
    bounded param counts, return value = generated chunk count (preserves `rows.length`
    semantics; **not** post-`ON CONFLICT` `rowCount`).
  - `…-concurrency.test.ts` — with default concurrency 1, the second parse's `extractText`
    does not fire until the first releases.
- `ruff check mira-core/mira-ingest/main.py` — **All checks passed**.
- Note: `unpdf@^1.6.2` is a declared dep (`package.json:70` + both lockfiles); the local
  worktree `node_modules` is stale (pre-#1592), so a local `tsc` reports a spurious
  "cannot find module 'unpdf'" — CI/Docker install from `package.json`, so the path is live.
