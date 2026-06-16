-- 011_grant_app_kb_access.sql
-- Fix /api/library/tree HTTP 500: "permission denied for table knowledge_entries".
--
-- Root cause: tenant-context.ts switches the session to the limited
-- factorylm_app role (so RLS is enforced). That role had no SELECT
-- privilege on knowledge_entries / kg_entities / kg_relationships, so
-- every Hub query against the KB returned a Postgres ACL error before
-- RLS even ran.
--
-- Secondary fix: 003_kb_hardening.sql installed an RLS policy keyed off
-- current_setting('app.current_tenant_id'), but withTenantContext only
-- writes app.tenant_id. The mismatch would have silently returned zero
-- rows once the GRANT issue was fixed. We refresh the policy to read
-- both keys (app.tenant_id wins; app.current_tenant_id stays as a
-- back-compat shim for older callers).
--
-- Safe to re-run.

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1. GRANTs for the limited Hub role
-- ─────────────────────────────────────────────────────────────

GRANT SELECT ON knowledge_entries TO factorylm_app;

-- kg_entities + kg_relationships back the chunk-detail / fault-code
-- joins in /api/library/chunks. Same role, same isolation rules.
GRANT SELECT ON kg_entities      TO factorylm_app;
GRANT SELECT ON kg_relationships TO factorylm_app;

-- ─────────────────────────────────────────────────────────────
-- 2. Refresh RLS policy to match the setting key Hub actually writes
-- ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS knowledge_entries_tenant ON knowledge_entries;
CREATE POLICY knowledge_entries_tenant ON knowledge_entries
    AS PERMISSIVE FOR ALL
    USING (
        tenant_id = COALESCE(
            NULLIF(current_setting('app.tenant_id', TRUE), ''),
            NULLIF(current_setting('app.current_tenant_id', TRUE), '')
        )::uuid
    );

COMMIT;
