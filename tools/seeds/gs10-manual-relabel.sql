-- GS10 manual relabel (2026-11-07). The AutomationDirect GS10 DURApulse user
-- manual was ingested from Google Drive as seven chapter PDFs with
-- manufacturer = NULL and model_number = the chapter's file name
-- ("ch4Parameters", "Getting Started", ...). Library retrieval
-- (mira-hub/src/lib/manual-rag.ts) filters on manufacturer ~* <maker> and
-- model_number ~* <model>, so a GS10 question from a nameplate photo could not
-- reach any of these pages. This sets the maker and model they actually are.
--
-- Provenance is provable from stored data (.claude/rules/oem-crawler-trusted.md):
-- rows are selected by the EXACT source_url AND the exact chapter-name
-- model_number written at ingest, the shared OEM tenant, is_private = false,
-- verified = true and a NULL manufacturer. Nothing else is touched.
-- Idempotent (a re-run matches 0 rows). Staging first; prod only after staging
-- retrieval is verified. Staging was relabelled by hand on 2026-11-07 (2,438
-- rows); prior values are kept off-repo for rollback.
BEGIN;
UPDATE knowledge_entries
   SET manufacturer = 'AutomationDirect', model_number = 'GS10', updated_at = now()
 WHERE tenant_id = '78917b56-f85f-43bb-9a08-1bb98a6cd6c3'
   AND is_private = false
   AND verified = true
   AND manufacturer IS NULL
   AND (source_url, model_number) IN (
     ('gdrive://ch4Parameters.pdf', 'ch4Parameters'),
     ('gdrive://Getting Started.pdf', 'Getting Started'),
     ('gdrive://Serial Comms.pdf', 'Serial Comms'),
     ('gdrive://ch2 install and wiring.pdf', 'ch2 install and wiring'),
     ('gdrive://ch3 keypad and operation.pdf', 'ch3 keypad and operation'),
     ('gdrive://ch6 maint and troubleshooting.pdf', 'ch6 maint and troubleshooting'),
     ('gdrive://Appendix C.pdf', 'Appendix C')
   );
COMMIT;
