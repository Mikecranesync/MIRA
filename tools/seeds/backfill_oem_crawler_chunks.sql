-- Move already-stored OEM crawler chunks into the shared pool and mark them trusted.
--
-- WHY: mira-crawler wrote chunks under config.mira_tenant_id (MIRA_TENANT_ID), which
-- was repointed to the garage/bench tenant during the CV-101 work. Retrieval reads the
-- shared OEM pool (MIRA_SHARED_TENANT_ID, mira-bots/shared/neon_recall.py), so those
-- chunks are invisible to customers and /quickstart. Separately they were written
-- verified=false, which MIRA_ENFORCE_APPROVED_RETRIEVAL filters out.
--
-- POLICY: .claude/rules/oem-crawler-trusted.md — curated OEM sources are trusted by
-- source; the human gate is sources.yaml curation (#2961), not per-chunk review.
-- This mirrors tools/seeds/backfill_verified_corpus.sql.
--
-- SAFETY: metadata->>'source' = 'mira_crawler' (stamped by ingest/store.py) is the
-- selector that keeps this off garage-native rows — CV-101 machine memory, live
-- Ignition rows, and customer uploads are untouched.
--
-- Idempotent and safe to re-run. STAGING FIRST (apply-seeds.yml target=staging,
-- mode=dry-run then apply), verify retrieval, then prod. Never psql prod.
--
-- Verify before/after:
--   SELECT tenant_id, verified, count(*) FROM knowledge_entries
--    WHERE metadata->>'source' = 'mira_crawler' GROUP BY 1,2 ORDER BY 3 DESC;

BEGIN;

UPDATE knowledge_entries ke
   SET tenant_id = '78917b56-f85f-43bb-9a08-1bb98a6cd6c3'::uuid,   -- MIRA_SHARED_TENANT_ID
       verified  = true
 WHERE ke.tenant_id = 'e88bd0e8-8a84-4e30-9803-c0dc6efb07fe'::uuid  -- garage MIRA_TENANT_ID
   AND ke.metadata->>'source' = 'mira_crawler'
   -- Collision guard keyed on the real unique index used by ON CONFLICT in
   -- mira-crawler/ingest/store.py: (tenant_id, source_url, (metadata->>'chunk_index')::int).
   -- Rows that would collide stay under the garage tenant as inert verified=false
   -- duplicates; measure the skipped count before deciding whether to sweep them.
   AND NOT EXISTS (
     SELECT 1 FROM knowledge_entries dup
      WHERE dup.tenant_id = '78917b56-f85f-43bb-9a08-1bb98a6cd6c3'::uuid
        AND dup.source_url = ke.source_url
        AND (dup.metadata->>'chunk_index')::int = (ke.metadata->>'chunk_index')::int
   );

COMMIT;
