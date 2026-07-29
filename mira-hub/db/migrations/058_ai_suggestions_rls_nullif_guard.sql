-- 058_ai_suggestions_rls_nullif_guard.sql
--
-- Fixes a staging-gate / apply-and-verify failure:
--   test_rls_tenant_isolation_ai_suggestions →
--   psycopg2.errors.InvalidTextRepresentation: invalid input syntax for type uuid: ""
--
-- Root cause: the migration 027 policy `ai_suggestions_tenant` cast the tenant
-- GUCs directly — `current_setting('app.tenant_id', true)::UUID` — and had ONLY
-- a USING clause (no explicit WITH CHECK). For INSERT, Postgres uses USING as
-- the check, so it evaluates the `app.tenant_id` branch. When that GUC is an
-- empty string '' (set, but empty) rather than unset, `''::UUID` raises
-- `invalid input syntax for type uuid: ""`. (Unset → current_setting returns
-- NULL via missing_ok=true, which is fine; '' is the footgun.) The session-
-- pinned tenant (`app.current_tenant_id`) is the matching branch here, so the
-- error came purely from evaluating the other branch.
--
-- Fix: wrap each cast in NULLIF(..., '') so '' maps to NULL (no match, no
-- error); a real UUID is unaffected. Also add an explicit WITH CHECK so the
-- INSERT path is intentional and symmetric with USING. This is a strict
-- hardening — no behavior change for correctly-set tenants.

BEGIN;

DROP POLICY IF EXISTS ai_suggestions_tenant ON ai_suggestions;
CREATE POLICY ai_suggestions_tenant
    ON ai_suggestions
    USING (
        tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
        OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID
    )
    WITH CHECK (
        tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
        OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID
    );

COMMIT;

-- ─── Rollback ─────────────────────────────────────────────────────────
-- BEGIN;
-- DROP POLICY IF EXISTS ai_suggestions_tenant ON ai_suggestions;
-- CREATE POLICY ai_suggestions_tenant ON ai_suggestions
--     USING (tenant_id = current_setting('app.tenant_id', true)::UUID
--            OR tenant_id = current_setting('app.current_tenant_id', true)::UUID);
-- COMMIT;
