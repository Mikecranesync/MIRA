-- QA-tenant cleanup — removes disposable E2E trial tenants and everything they own.
--
-- WHY: every prod/staging E2E verification mints a fresh trial account
-- (notebook-qa-*, notebook-live-*, adversarial-*@factorylm.com) plus its tenant,
-- notebook, kg node, uploaded PDF bytes, chunks, and chat turns. Nothing expires
-- them (trial_expires_at only gates the UI), so repeated verification pollutes
-- the product indefinitely.
--
-- RUNS ONLY via .github/workflows/qa-cleanup.yml (dry-run by default, apply is
-- environment-gated). Never run from a code session — prod psql is forbidden
-- (tools/hooks/prod-guard.sh; docs/environments.md).
--
-- psql variables (all REQUIRED — ON_ERROR_STOP makes a missing one fatal):
--   :age_days     only tenants whose owner signed up more than N days ago
--   :max_tenants  abort if the selector matches more than this many tenants
--   :apply        'true' commits, anything else rolls back (dry-run)
--
-- Selector guards (ALL must hold for a tenant to be selected):
--   * owner email matches the QA prefix regex AND ends @factorylm.com
--   * EVERY user in the tenant has status='trial' and plan IS NULL
--     (an upgraded/admin/approved user protects the whole tenant)
--   * tenant owns ZERO shared/public knowledge (is_private=false rows) —
--     structurally excludes the system/OEM tenant
--   * older than :age_days; hard cap at :max_tenants

\set ON_ERROR_STOP on

BEGIN;

-- Make the cap visible to the DO block (session GUCs can't read psql vars).
SET LOCAL qa.max_tenants = :'max_tenants';

CREATE TEMP TABLE qa_tenants ON COMMIT DROP AS
SELECT t.id AS tid
FROM hub_tenants t
WHERE EXISTS (
        SELECT 1 FROM hub_users u
        WHERE u.tenant_id = t.id
          AND u.email_lower ~ '^(notebook-qa-|notebook-live-|adversarial-)[a-z0-9._+-]*@factorylm\.com$'
          AND u.created_at < NOW() - (:'age_days' || ' days')::interval
      )
  AND NOT EXISTS (
        SELECT 1 FROM hub_users u2
        WHERE u2.tenant_id = t.id
          AND (u2.status IS DISTINCT FROM 'trial' OR u2.plan IS NOT NULL)
      )
  AND NOT EXISTS (
        SELECT 1 FROM knowledge_entries ke
        WHERE ke.tenant_id::text = t.id AND ke.is_private = false
      );

-- Cap: refuse to mass-delete. A selector bug should abort, not sweep.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM qa_tenants;
  RAISE NOTICE 'qa_tenants selected: %', n;
  IF n > current_setting('qa.max_tenants')::int THEN
    RAISE EXCEPTION 'selected % tenants exceeds max_tenants=% — aborting',
      n, current_setting('qa.max_tenants');
  END IF;
END $$;

-- Visibility: what would be / is being deleted, per table.
SELECT 'hub_tenants' AS tbl, count(*) FROM hub_tenants WHERE id IN (SELECT tid FROM qa_tenants)
UNION ALL SELECT 'hub_users', count(*) FROM hub_users WHERE tenant_id IN (SELECT tid FROM qa_tenants)
UNION ALL SELECT 'knowledge_entries(private)', count(*) FROM knowledge_entries
          WHERE tenant_id::text IN (SELECT tid FROM qa_tenants) AND is_private = true
UNION ALL SELECT 'namespace_direct_uploads', count(*) FROM namespace_direct_uploads
          WHERE tenant_id::text IN (SELECT tid FROM qa_tenants)
UNION ALL SELECT 'equipment_notebook_turns', count(*) FROM equipment_notebook_turns
          WHERE tenant_id::text IN (SELECT tid FROM qa_tenants)
UNION ALL SELECT 'equipment_notebook_sources', count(*) FROM equipment_notebook_sources
          WHERE tenant_id::text IN (SELECT tid FROM qa_tenants)
UNION ALL SELECT 'equipment_notebooks', count(*) FROM equipment_notebooks
          WHERE tenant_id::text IN (SELECT tid FROM qa_tenants)
UNION ALL SELECT 'kg_relationships', count(*) FROM kg_relationships
          WHERE tenant_id::text IN (SELECT tid FROM qa_tenants)
UNION ALL SELECT 'kg_entities', count(*) FROM kg_entities
          WHERE tenant_id::text IN (SELECT tid FROM qa_tenants)
UNION ALL SELECT 'hub_uploads', count(*) FROM hub_uploads
          WHERE tenant_id IN (SELECT tid FROM qa_tenants)
UNION ALL SELECT 'hub_magic_tokens', count(*) FROM hub_magic_tokens
          WHERE tenant_id IN (SELECT tid FROM qa_tenants)
UNION ALL SELECT 'tenants(mirror)', count(*) FROM tenants WHERE id::text IN (SELECT tid FROM qa_tenants);

-- Dependent tables (blocking FKs + ON DELETE CASCADE side effects). Schemas
-- drift between environments, so each is counted only if it exists here.
SELECT t AS dependent_tbl,
       CASE WHEN to_regclass(t) IS NULL THEN NULL
            ELSE (xpath('/row/c/text()', query_to_xml(
                   format('SELECT count(*) AS c FROM %I WHERE tenant_id::text IN (SELECT tid FROM qa_tenants)', t),
                   false, true, '')))[1]::text::int
       END AS rows_for_qa_tenants
FROM unnest(ARRAY['workspace_file_links','diagnosis_pairs','asset_fix_records',
                  'guided_procedure_sessions','storage_file_nodes','link_tokens','users']) AS t;

-- Every FK in THIS database that points at a table this script deletes from,
-- so a dry-run surfaces a new blocker before an apply ever meets it.
SELECT c.conrelid::regclass::text AS referencing_tbl,
       c.confrelid::regclass::text AS referenced_tbl,
       CASE c.confdeltype WHEN 'c' THEN 'cascade' WHEN 'n' THEN 'set null'
            WHEN 'r' THEN 'RESTRICT' WHEN 'a' THEN 'NO ACTION' ELSE c.confdeltype::text END AS on_delete
FROM pg_constraint c
WHERE c.contype = 'f'
  AND c.confrelid::regclass::text IN ('hub_tenants','hub_users','knowledge_entries','namespace_direct_uploads',
        'equipment_notebook_turns','equipment_notebook_sources','equipment_notebooks','kg_relationships',
        'kg_entities','hub_uploads','hub_magic_tokens','tenants')
ORDER BY 3, 1;

-- Children before parents; knowledge_entries first (FKs tenants), tenants last.
-- is_private=true only — belt-and-braces on top of the selector's public-rows
-- exclusion (.claude/rules/knowledge-entries-tenant-scoping.md).
-- Rows that block the deletes below (RESTRICT / NO ACTION FKs onto
-- namespace_direct_uploads and knowledge_entries). Deleted by the QA tenant's
-- own id ONLY: a row of another tenant pointing at QA data makes the FK fail
-- and the whole run abort, rather than this script reaching outside QA tenants.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['workspace_file_links','diagnosis_pairs'] LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('DELETE FROM %I WHERE tenant_id::text IN (SELECT tid FROM qa_tenants)', t);
    END IF;
  END LOOP;
END $$;
DELETE FROM knowledge_entries
  WHERE tenant_id::text IN (SELECT tid FROM qa_tenants) AND is_private = true;
DELETE FROM namespace_direct_uploads WHERE tenant_id::text IN (SELECT tid FROM qa_tenants);
DELETE FROM equipment_notebook_turns WHERE tenant_id::text IN (SELECT tid FROM qa_tenants);
DELETE FROM equipment_notebook_sources WHERE tenant_id::text IN (SELECT tid FROM qa_tenants);
DELETE FROM equipment_notebooks WHERE tenant_id::text IN (SELECT tid FROM qa_tenants);
DELETE FROM kg_relationships WHERE tenant_id::text IN (SELECT tid FROM qa_tenants);
DELETE FROM kg_entities WHERE tenant_id::text IN (SELECT tid FROM qa_tenants);
DELETE FROM hub_uploads WHERE tenant_id IN (SELECT tid FROM qa_tenants);
DELETE FROM hub_magic_tokens WHERE tenant_id IN (SELECT tid FROM qa_tenants);
DELETE FROM hub_users WHERE tenant_id IN (SELECT tid FROM qa_tenants);
DELETE FROM hub_tenants WHERE id IN (SELECT tid FROM qa_tenants);
DELETE FROM tenants WHERE id::text IN (SELECT tid FROM qa_tenants);

\if :apply
  \echo '=== APPLY: committing deletions ==='
  COMMIT;
\else
  \echo '=== DRY-RUN: rolling back (no rows deleted) ==='
  ROLLBACK;
\endif
