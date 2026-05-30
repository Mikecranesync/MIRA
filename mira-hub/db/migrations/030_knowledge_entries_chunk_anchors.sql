-- Migration 030: chunk anchors + ingest-route discriminator on knowledge_entries.
--
-- LOCATION NOTE: knowledge_entries is engine-side (docs/migrations/001), but the ONLY gated,
-- automated apply path to staging/prod is `.github/workflows/apply-migrations.yml`, which runs
-- `mira-hub/db/migrations/*.sql` (docs/migrations/ has no runner). So this lives here to ride
-- that dev→staging→prod pipeline. The ALTERs run against the same NeonDB regardless of "side".
-- (Already applied to the dev + staging Neon branches 2026-05-30 via node pg; see plan file.)
--
-- Spec : docs/specs/miradrop-ingest-v2-spec.md §4.2 (chunk anchors)
--        docs/specs/uns-node-centric-knowledge-spec.md (Hub folder=brain front door)
-- ADR  : docs/adr/0019-miradrop-ingest-v2.md (Accepted) — supersedes ADR-0020 link table.
--
-- Why: today's interactive upload path (mira-core/mira-ingest `ingest_document_kb`) writes
-- ONLY to Open WebUI's KB, never knowledge_entries — so an uploaded manual is not citable on
-- any channel (all retrieval reads knowledge_entries). mira-ingest-v2 (ADR-0019) writes drop
-- chunks INTO knowledge_entries; these columns give each chunk its document grouping + page
-- anchors, and an ingest_route discriminator that keeps the legacy crawler/seed corpus
-- ('ow'/NULL) distinct from v2 ('v2') rows during cutover.
--
-- The chunk → namespace-node address is NOT a column here. It is the chain
--   knowledge_entries.doc_id → hub_uploads.kg_entity_id → kg_entities.uns_path (ltree)
-- so node-subtree retrieval rides the existing kg_entities GIST `uns_path <@` index
-- (mira-hub/db/migrations/010_kg_uns_path.sql). No sibling link table (ADR-0019 §"single
-- source of truth"; this is exactly the dual-truth pattern that bit kg_relationships).
--
-- Columns:
--   doc_id       — the source hub_uploads.id; all chunks of one drop share it.
--   page_start   — first source PDF page this chunk spans (citation anchor).
--   page_end     — last source PDF page this chunk spans.
--   section_path — human section trail (e.g. "6 Faults > 6.2 Fault Codes"); citation display.
--   ingest_route — 'v2' for mira-ingest-v2 / Hub-node attachments; 'ow' or NULL for the legacy
--                  Open-WebUI/crawler corpus. Discriminator for cutover + route-scoped reads.
--
-- All additive + nullable: legacy rows (NULL doc_id / route) are untouched and the existing
-- BM25 recall path (content_tsv) is unchanged. NOTE: source_page already exists and stores the
-- chunk_index (per docs/migrations/001 comment), so it is left alone; page_start/page_end are
-- the real PDF page span.

BEGIN;

ALTER TABLE knowledge_entries
  ADD COLUMN IF NOT EXISTS doc_id       UUID;

ALTER TABLE knowledge_entries
  ADD COLUMN IF NOT EXISTS page_start   INTEGER;

ALTER TABLE knowledge_entries
  ADD COLUMN IF NOT EXISTS page_end     INTEGER;

ALTER TABLE knowledge_entries
  ADD COLUMN IF NOT EXISTS section_path TEXT;

ALTER TABLE knowledge_entries
  ADD COLUMN IF NOT EXISTS ingest_route TEXT;

-- All chunks of one document fetched together (asset/node Documents tab, subtree retrieval join).
CREATE INDEX IF NOT EXISTS idx_knowledge_entries_doc
  ON knowledge_entries (tenant_id, doc_id)
  WHERE doc_id IS NOT NULL;

-- Route-scoped reads (e.g. "v2 chunks for this tenant, newest first") without scanning the
-- 25k-row legacy corpus.
CREATE INDEX IF NOT EXISTS idx_knowledge_entries_route
  ON knowledge_entries (tenant_id, ingest_route, created_at DESC)
  WHERE ingest_route = 'v2';

COMMIT;


-- ────────────────────────────────────────────────────────────────────────
-- DOWN — drop indexes + columns. Existing rows survive (no data loss).
-- ────────────────────────────────────────────────────────────────────────
-- BEGIN;
-- DROP INDEX IF EXISTS idx_knowledge_entries_route;
-- DROP INDEX IF EXISTS idx_knowledge_entries_doc;
-- ALTER TABLE knowledge_entries DROP COLUMN IF EXISTS ingest_route;
-- ALTER TABLE knowledge_entries DROP COLUMN IF EXISTS section_path;
-- ALTER TABLE knowledge_entries DROP COLUMN IF EXISTS page_end;
-- ALTER TABLE knowledge_entries DROP COLUMN IF EXISTS page_start;
-- ALTER TABLE knowledge_entries DROP COLUMN IF EXISTS doc_id;
-- COMMIT;
