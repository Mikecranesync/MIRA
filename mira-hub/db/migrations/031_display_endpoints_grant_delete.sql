BEGIN;

-- Migration 031: grant DELETE on display_endpoints to the app role.
--
-- Migration 030 created display_endpoints with GRANT SELECT, INSERT, UPDATE (it
-- mirrored 020's append-with-status grant). But the Command Center registry CRUD
-- (Phase 2) exposes a real Delete action distinct from the `enabled` soft-disable
-- toggle — two separate affordances. Unlike kg_entities / kg_relationships (which
-- are append-with-status for the proposal/audit workflow), display_endpoints is
-- plain operator-managed config: removing a registration is config cleanup, not a
-- state transition that must be retained. So the app role needs DELETE.
--
-- Idempotent; safe to re-run. Promote dev -> staging -> prod via apply-migrations.yml.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'factorylm_app') THEN
        GRANT DELETE ON display_endpoints TO factorylm_app;
    END IF;
END $$;

COMMIT;

-- ROLLBACK (manual): REVOKE DELETE ON display_endpoints FROM factorylm_app;
