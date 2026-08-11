# ARPK Phase 0 — implementation delta (audit and freeze)

**Date:** 2026-08-10 · **PRD:** `docs/plans/2026-08-10-prd-agent-readable-product-knowledge-t2108.md`
**Research base:** `docs/plans/2026-08-10-chat-with-any-manual-design.md` (researched on a checkout
~450 commits behind; this delta re-verifies every load-bearing premise against `origin/main` @ `42359648b`).

## Premises re-verified on main

1. **`doc_id` is already the document key.** Every v2 chunk row carries
   `doc_id = hub_uploads.id` (`mira-hub/src/lib/node-knowledge-ingest.ts` — the shared
   `writeChunkRowsForNode` core, which the research snapshot predated). Doc-scoped retrieval is an
   additional `AND doc_id = $n` on `retrieveNodeChunks`, not a new pipeline.
2. **The files door already parks originals and reports *thrown* ingest failures honestly**
   (`namespace_direct_uploads` + `indexed:false` + `friendlyIngestError`). The one remaining
   dishonest outcome is a scanned/image-only PDF: unpdf extracts no text, `chunkText` returns `[]`,
   and the route returns `indexed:true, chunkCount:0` (PRD "honest failure" item). The blind door
   (`runLocalIngest`) additionally marks such uploads `parsed`.
3. **`MIRA_ENFORCE_APPROVED_ASK` / `MIRA_ENFORCE_APPROVED_RETRIEVAL` are set in no compose file or
   env template** — the approved-context 412 gate is off in every environment. (PRD instruction 3.)
4. **`kg_entities.approval_state` live default on staging is `'verified'` — proven empirically,
   not from migration files.** Chain: `provision-beta-gate.ts` creates its node through the real
   `POST /api/namespace/node` route → that INSERT names no `approval_state` column → the NodeChat
   route requires `approval_state = 'verified'` → the beta gate ran green on staging **2026-08-10
   08:40 UTC** (run 31371097975). A `'proposed'` default cannot produce a green gate. The in-repo
   ambiguity is real, though: `docs/migrations/008_kg_approval_state.sql` says `DEFAULT 'verified'`
   while `mira-hub/db/migrations/029_…` says `DEFAULT 'proposed'` (its header claims 008 "was never
   written," which is no longer true). **Hardening in Phase 1:** pin `approval_state = 'verified'`
   explicitly on the two user-facing node INSERTs (`api/namespace/node/route.ts`,
   `lib/inbox-node.ts`) so chatability never depends on which migration set won in an environment.
   Prod remains unproven directly; the explicit pin makes the question moot for new nodes.
5. **Text/markdown uploads already ride the v2 path** (#2277, `writeTextChunksForNode`), and the
   legacy Open WebUI fallback in `runLocalIngest` is dead weight post-sunset (`7b537b0cb`) — out of
   scope here, but the dedup/zero-chunk changes are placed so they don't depend on it.
6. **`hub_uploads`** is formalized in migration 068 (TEXT tenant, no RLS, owner-pool queries, an
   existing dedup precedent `idx_hub_uploads_dedup` on `external_file_id`). Content dedup adds
   `content_sha256` + a partial index in migration **072** (next free number), with the app-level
   duplicate check keyed `(tenant_id, content_sha256, kg_entity_id)` — an exact re-upload to the
   *same* node/Inbox is a duplicate; the same bytes attached to a *different* node still ingest
   (chunks must carry that node's `node_id`).
7. **Beta gate weakness confirmed on main:** `_gate.py` discards the `sources` SSE frame and
   `CITATION_MARKERS` includes `"["`/`"manual"`/`"—"` while the system prompt instructs `[n]`
   markers — a hallucinated `[1]` passes. Fix: parse the sources frame, require non-empty sources.
8. **Documents UI is Labs-gated mock** (`DOCS` from `lib/documents-data`, `LabsStub` on prod
   builds). The real per-tenant document inventory lives in `hub_uploads`
   (v2, `status='parsed'`, `kind='document'`) — the same rows the node files panel lists.

## Scope freeze for this PR (Phase 1 of the PRD)

- 1a. `docId` scoping on `retrieveNodeChunks` + the node chat route (body `docId`), a
  document-scoped neutral system prompt, and the approval_state pin. Gate F test: a doc-scoped ask
  cannot retrieve sibling-document chunks from the same node.
- 1b. Migration 072 + SHA-256 dedup at both v2 doors.
- 1c. Zero-extractable-text honesty at both doors (typed error; no silent `parsed`/`indexed:true`).
- 1d. Real documents list/detail backed by `hub_uploads`/`knowledge_entries` with a per-document
  Chat action deep-linking into NodeChat with `doc=` scope; Telegram deep-link removed.
- 1e. Beta-gate sources-frame assertion.
- 1f. T2108 fixture: fetch script for the official eufy manual (binary gitignored) + golden
  questions; measured offline proof as far as the environment allows.

Explicitly deferred (PRD Phases 2–5): metadata extraction, table/section-aware chunker port, OCR,
durable embed retries, ARPK compiler/schema, nameplate resolver, cross-domain benchmark.

## Known contradictions with the PRD (none blocking)

- PRD "Remove navigation/retrieval assumptions that force `is_private=false`" — the only such
  assumption lives in the **held** #3183 `manual_nav` lane, not on main; nothing to change here.
- PRD "Do not require model metadata that generic upload never populated" — already true of
  NodeChat/`retrieveNodeChunks`; the requirement constrains *future* Phase 2 work rather than
  demanding a change now.
