-- #4141: the two trusted #4139 OEM manuals were written with model_number = ''
-- (ManufacturerCrawler never passed a model), so model-bound retrieval
-- (mira-hub/src/lib/manual-rag.ts, `model_number ~* <token>`) returned 0 rows.
-- The crawler now passes sources.yaml `model_number`, but ingest/store.py
-- inserts with ON CONFLICT DO NOTHING, so already-written rows are not updated
-- by a re-crawl. This backfill sets the same values sources.yaml now declares.
--
-- Provenance is provable from stored data (.claude/rules/oem-crawler-trusted.md):
-- rows are selected by the EXACT trusted sources.yaml URL, the shared OEM tenant,
-- verified = true and an empty model_number. Nothing else is touched.
-- Idempotent. Staging first; prod only after staging retrieval is verified.
BEGIN;
UPDATE knowledge_entries
   SET model_number = 'TP700 Comfort, TP900 Comfort, TP1200 Comfort'
 WHERE source_url = 'https://cache.industry.siemens.com/dl/files/233/49313233/att_904646/v1/HWComfortPanelsenUS_en-US.pdf'
   AND tenant_id = '78917b56-f85f-43bb-9a08-1bb98a6cd6c3'
   AND verified = true
   AND coalesce(model_number, '') = '';
UPDATE knowledge_entries
   SET model_number = 'SLC 500, SLC 5/01, SLC 5/02, SLC 5/03, SLC 5/04, SLC 5/05'
 WHERE source_url = 'https://literature.rockwellautomation.com/idc/groups/literature/documents/um/1747-um011_-en-p.pdf'
   AND tenant_id = '78917b56-f85f-43bb-9a08-1bb98a6cd6c3'
   AND verified = true
   AND coalesce(model_number, '') = '';
COMMIT;
