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
--
-- == SAFETY: what the selector actually does ==================================
-- metadata->>'source' = 'mira_crawler' is NOT a safety selector. It is hardcoded in
-- the metadata dict inside insert_chunk (mira-crawler/ingest/store.py) — the SHARED
-- write library — so EVERY caller stamps it: reddit (forum_post), patents (patent),
-- youtube (video_transcript), rss (rss_article), playwright (knowledge_article),
-- equipment photos (equipment_photo), CurriculumCrawler (curriculum/standard).
-- recall_knowledge applies no source_type filter — its only gate is `verified = true`
-- — so promoting those into the cross-tenant shared pool as verified=true would make
-- Reddit posts and the customer's own equipment photos citable grounded evidence for
-- every tenant, contradicting .claude/rules/oem-crawler-trusted.md.
--
-- The real selector is the crawler's OUTPUT SHAPE — the population the fixed write
-- path (ManufacturerCrawler + oem_tenant_id + verified=true) maintains going forward:
--     source_type = 'equipment_manual' AND manufacturer <> ''
-- source_type is load-bearing, not redundant: equipment_photo rows DO carry a
-- manufacturer (ingest_equipment_photos.py passes result['make']). manufacturer <> ''
-- additionally excludes the link-scraped equipment_manual rows queued by
-- tasks/playwright_crawler.py (ingest_url with no manufacturer), and is NULL-safe.
-- Moved rows are stamped metadata.backfilled_from so the move is auditable/reversible.
--
-- == MANDATORY read-only pre-flight — BOTH, before mode=apply =================
-- apply-seeds.yml mode=dry-run executes NO SQL (it only previews this file). Run these
-- through db-inspect.yml (read-only, has its own `target` input).
--
-- (a) Population breakdown. Any unexpected source_type means the selector must be
--     narrowed FURTHER — do not proceed on operator judgement:
--   SELECT source_type, manufacturer, verified, count(*)
--     FROM knowledge_entries
--    WHERE tenant_id::text = 'e88bd0e8-8a84-4e30-9803-c0dc6efb07fe'
--      AND metadata->>'source' = 'mira_crawler'
--    GROUP BY 1,2,3 ORDER BY 4 DESC;
--
-- (b) chunk_index castability, BOTH tenants. The (metadata->>'chunk_index')::int casts
--     in the NOT EXISTS below run over garage candidate rows (ke.) AND shared-pool rows
--     (dup.) — one non-numeric value in EITHER population aborts the whole transaction.
--     Must return zero rows:
--   SELECT tenant_id, count(*) FROM knowledge_entries
--    WHERE tenant_id::text IN ('e88bd0e8-8a84-4e30-9803-c0dc6efb07fe',
--                              '78917b56-f85f-43bb-9a08-1bb98a6cd6c3')
--      AND metadata->>'chunk_index' IS NOT NULL
--      AND metadata->>'chunk_index' !~ '^[0-9]+$'
--    GROUP BY 1;
--
-- == Running it ==============================================================
-- STAGING FIRST: apply-seeds.yml target=staging seeds=backfill_oem_crawler_chunks
-- mode=apply, verify retrieval, then prod with target=prod
-- seeds=backfill_oem_crawler_chunks mode=apply. The seeds default is "all" — that
-- runs THREE UNRELATED hardcoded seeds (gs10-vfd-knowledge, gs11-field-guide-knowledge,
-- demo-conveyor-001) and NOT this backfill, so seeds=backfill_oem_crawler_chunks is
-- REQUIRED on every dispatch, staging and prod alike. Never psql prod. A RED workflow
-- run after a SUCCESSFUL apply is EXPECTED: the
-- post-apply embedding-coverage gate (#2094) is corpus-wide and stays red against prod
-- until the separate backfill (#2093) runs — its own comment says so. Confirm success
-- from the "Apply seeds" step's own OK row, NOT the job conclusion, and do not
-- re-dispatch on a red gate alone.
--
-- Type-agnostic: tenant_id is TEXT NOT NULL per docs/migrations/001_knowledge_entries.sql
-- but is believed to be uuid in prod — every comparison is ::text and the assignment is
-- an untyped literal, so this runs unchanged on either column type.
-- Idempotent: a moved row can never re-match the garage-tenant predicate.
--
-- == Regression fixture ======================================================
-- tests/seeds/backfill_oem_crawler_chunks_fixture.sql (move / collision-skipped /
-- garage-native + negative rows that must NOT move). Lives OUTSIDE tools/seeds/ on
-- purpose — it DROPs knowledge_entries, and apply-seeds.yml/apply-tag-scaling.yml/
-- apply-approved-tags.yml all resolve their seed/seeds input under tools/seeds/, so
-- keeping it out of that tree keeps a plain (non-traversal) dispatch from ever
-- resolving to it. Run BOTH column types:
--   docker run --rm -d --name oem-seed-fix -e POSTGRES_PASSWORD=test postgres:16
--   docker cp tests/seeds/backfill_oem_crawler_chunks_fixture.sql oem-seed-fix:/tmp/fixture.sql
--   docker cp tools/seeds/backfill_oem_crawler_chunks.sql oem-seed-fix:/tmp/seed.sql
--   docker exec oem-seed-fix psql -U postgres -v ON_ERROR_STOP=1 -f /tmp/fixture.sql   # add -v tid_type=text for the 2nd run
--   docker exec oem-seed-fix psql -U postgres -v ON_ERROR_STOP=1 -f /tmp/seed.sql
--   docker exec oem-seed-fix psql -U postgres -c "SELECT * FROM backfill_fixture_assert ORDER BY label;"
--   docker rm -f oem-seed-fix

BEGIN;

UPDATE knowledge_entries ke
   SET tenant_id = '78917b56-f85f-43bb-9a08-1bb98a6cd6c3',   -- MIRA_SHARED_TENANT_ID
       verified  = true,
       -- Audit marker: without it a moved row is indistinguishable from a natively
       -- written shared-pool row, so the move could be neither audited nor rolled
       -- back. Does not affect idempotency (the source-tenant predicate already
       -- cannot re-match a moved row).
       metadata  = ke.metadata || jsonb_build_object(
                     'backfilled_from', 'e88bd0e8-8a84-4e30-9803-c0dc6efb07fe',
                     'backfilled_at', now()::text)
 WHERE ke.tenant_id::text = 'e88bd0e8-8a84-4e30-9803-c0dc6efb07fe'  -- garage MIRA_TENANT_ID
   AND ke.metadata->>'source' = 'mira_crawler'
   -- The actual safety selector — see the SAFETY block above.
   AND ke.source_type = 'equipment_manual'
   AND ke.manufacturer <> ''
   -- Collision guard keyed on the real unique index used by ON CONFLICT in
   -- mira-crawler/ingest/store.py: (tenant_id, source_url, (metadata->>'chunk_index')::int).
   -- Rows that would collide stay under the garage tenant as inert verified=false
   -- duplicates; measure the skipped count before deciding whether to sweep them.
   AND NOT EXISTS (
     SELECT 1 FROM knowledge_entries dup
      WHERE dup.tenant_id::text = '78917b56-f85f-43bb-9a08-1bb98a6cd6c3'
        AND dup.source_url = ke.source_url
        AND (dup.metadata->>'chunk_index')::int = (ke.metadata->>'chunk_index')::int
   );

COMMIT;
