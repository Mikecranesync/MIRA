# #1899 — folder=brain PDF upload 500: unpdf dropped from the standalone trace

**Date:** 2026-06-12 · **Severity:** P0 (beta-gate blocker) · **Fix:** mira-hub v2.2.2

## Symptom
A brand-new tenant uploads a PDF to a Namespace folder (`POST /api/namespace/node/{id}/files/`) → **HTTP 500**, no file attaches, no visible error (panel still reads "No files attached"). Blocks the North-Star beta gate (stranger uploads own manual → cited answer).

## Root cause
`mira-hub/next.config.ts` sets `output: "standalone"`. The upload path
(`ingestPdfToNode` → `writePdfChunksForNode` in `src/lib/node-knowledge-ingest.ts`)
calls `unpdf`'s `getDocumentProxy`, which internally does a **runtime dynamic
`await import('unpdf/pdfjs')`** (unpdf ships its PDF.js engine as a separate
`./pdfjs` export = `dist/pdfjs.mjs`). Next's standalone file-tracer (@vercel/nft)
does **not** trace that dynamic subpath import, so the whole `unpdf` package was
omitted from `.next/standalone/.../node_modules`. The deployed `node server.js`
then threw `Serverless PDF.js bundle could not be resolved: Cannot find module
'unpdf/pdfjs'` on **every** PDF upload — before any DB write (hence "0 files").

## What it was NOT (ruled out by evidence, not guesses)
- **DB grant / schema drift.** db-inspect (prod, read-only) showed
  `knowledge_entries` grant = `INSERT,SELECT`; the v2 columns
  (`doc_id/ingest_route/page_start/page_end`), `is_private`, and the ON CONFLICT
  index `idx_ke_chunk_dedup` all present. `apply-migrations` prod dry-run: every
  migration incl. 045/049 = `skip (already applied)`. **Prod schema is pristine.**
- **unpdf choking on the PDF.** unpdf extracts the 2 KB synthetic test PDF fine
  locally (1 page, 840 chars).
- **Stale prod deploy.** Hub was on current code (redeployed same day).
- **STALE-CLONE TRAP:** the staging Neon branch is forked pre-#1592, so its
  *runtime-managed* `hub_uploads` lacks `kg_entity_id/ingest_route` — a clone
  artifact, NOT prod. `hub_uploads` is created/altered only by
  `ensureUploadsSchema()` at app runtime, never by a numbered migration.

## Proof
`next build` (standalone) without the fix → **no `pdfjs.mjs` anywhere** in
`.next/standalone`. With `serverExternalPackages: ["unpdf"]` →
`.next/standalone/.../node_modules/unpdf/dist/pdfjs.mjs` is present. Clean
before/after.

## Fix (mira-hub v2.2.2)
1. `next.config.ts`: `serverExternalPackages: ["unpdf"]` — keeps unpdf out of the
   bundle and copies the full package (incl. `dist/pdfjs.mjs`) into the standalone
   trace, so the runtime import resolves.
2. Route surfaces a specific, actionable error (not generic "Upload failed"); the
   Files panel shows a **durable** error row + Retry, so a 500 never reads as
   "nothing happened".
3. Regression guard `src/lib/__tests__/unpdf-bundling-guard.test.ts` (the bug only
   manifests in a standalone *build* — a `next dev` e2e cannot catch it) +
   `tests/e2e/folder-upload-citation-proof.spec.ts` driving the **real** upload
   route (the existing `folder-brain-proof` spec direct-seeds chunks and so never
   exercised the door that broke).

## Lesson
Any package that does a runtime dynamic `import()` of a subpath (PDF/OCR/native
libs) must be in `serverExternalPackages` under `output: standalone`, or it will
work in `next dev` and 500 in production. Add such packages to the guard test.
