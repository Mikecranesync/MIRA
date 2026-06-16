-- 023_grant_app_namespace_tables.sql
-- Fix HTTP 500s on /api/namespace/tree, /api/proposals, /api/readiness,
-- /api/components/[id], /api/wizard/[step], and the namespace node PUT/PATCH
-- routes ("permission denied for table ...").
--
-- Root cause: same pattern as the 011 fix for /api/library/tree. The hub's
-- tenant-context.ts switches the session to the limited `factorylm_app` role
-- so RLS tenant_isolation policies are enforced. Migrations 016/017/018/021
-- created their tables and RLS policies, but never granted SELECT/INSERT/
-- UPDATE on those tables to factorylm_app — so every hub query against them
-- returns a Postgres ACL error before RLS even runs.
--
-- Grant scope per route's actual usage:
--   relationship_proposals       SELECT (list), INSERT (LLM proposer),
--                                UPDATE (proposal decide → status change)
--   relationship_evidence        SELECT (proposal detail), INSERT (collector)
--   component_templates          SELECT only — catalog is shared/read-only
--                                from the hub. Template writes happen via
--                                ingest workers running as neondb_owner.
--   component_template_sources   SELECT — provenance read by the hub.
--   installed_component_instances SELECT (list/detail), INSERT (onboarding),
--                                UPDATE (rename / rebind to template).
--   health_scores                SELECT (widget), INSERT (recompute write-
--                                through), UPDATE (refresh).
--   wizard_progress              SELECT (resume), INSERT (start), UPDATE
--                                (advance step / complete).
--   namespace_versions           SELECT (audit feed), INSERT (drag-drop /
--                                rename). Append-only — no UPDATE/DELETE.
--
-- Safe to re-run.

BEGIN;

GRANT SELECT, INSERT, UPDATE         ON relationship_proposals          TO factorylm_app;
GRANT SELECT, INSERT                 ON relationship_evidence           TO factorylm_app;

GRANT SELECT                         ON component_templates             TO factorylm_app;
GRANT SELECT                         ON component_template_sources      TO factorylm_app;

GRANT SELECT, INSERT, UPDATE         ON installed_component_instances   TO factorylm_app;

GRANT SELECT, INSERT, UPDATE         ON health_scores                   TO factorylm_app;
GRANT SELECT, INSERT, UPDATE         ON wizard_progress                 TO factorylm_app;
GRANT SELECT, INSERT                 ON namespace_versions              TO factorylm_app;

COMMIT;
