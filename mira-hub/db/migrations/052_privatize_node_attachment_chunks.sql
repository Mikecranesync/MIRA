-- Migration 052: privatize existing node-attachment chunks (is_private = true).
--
-- #1903 — node=brain chunk writer inserted per-tenant manual chunks into
-- knowledge_entries WITHOUT is_private, so they defaulted to false. Per
-- `.claude/rules/knowledge-entries-tenant-scoping.md`, a per-tenant row left
-- is_private = false leaks to every tenant through the hybrid read filter
-- `(is_private = false OR tenant_id = $caller)` and the universal library /
-- aggregate surfaces (the #1833 leak class).
--
-- `writePdfChunksForNode` now pins is_private = true for new uploads. This
-- migration closes the EXISTING leak: every v2 node_attachment chunk already in
-- the table is, by definition, a per-tenant upload and must be private. This is
-- narrowly scoped to ingest_route = 'v2' AND source_type = 'node_attachment', so
-- the shared OEM corpus (ingest_route NULL/'ow', is_private = false by design)
-- is untouched.
--
-- Idempotent: re-running only flips rows still at false; already-true rows are skipped.

BEGIN;

UPDATE knowledge_entries
   SET is_private = true
 WHERE ingest_route = 'v2'
   AND source_type = 'node_attachment'
   AND is_private = false;

COMMIT;
