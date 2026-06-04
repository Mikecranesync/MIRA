BEGIN;

-- Migration 035: approved_tags — customer-safe tag allowlist (first-class table).
--
-- Master plan: docs/plans/2026-06-01-mira-master-architecture-plan.md
--   Phase 1 schema + Phase 4 (D1 — promote approved_tags.json to a table).
--   Gap-closure plan: docs/plans/current-state-gap-closure-plan.md §2.2/§2.3.
-- Doctrine:    docs/mira-ignition-secure-architecture.md §D1 (allowlist).
--
-- WHAT THIS IS
--   The SECURITY allowlist that controls which source tags MIRA is permitted
--   to ingest. Today this is a flat JSON file (ignition/project/approved_tags.json,
--   46 entries) read only by the Ignition WebDev tag-browse handler. This
--   migration promotes it to a tenant-scoped, queryable table so the Phase-2
--   ingest endpoint (POST /api/v1/tags/ingest) can enforce it server-side
--   (defense in depth: Ignition filters on the way out, the relay rejects on
--   the way in).
--
--   DISTINCT FROM tag_entities (Hub 025): tag_entities is the SEMANTIC tag
--   catalog (UNS path → PLC address, data type, units, envelope). approved_tags
--   is the ALLOW/DENY boundary keyed by the RAW source path before any UNS
--   resolution. A tag can be in the catalog and not allowlisted, or
--   allowlisted before it has a catalog entry. Two concerns, two tables.
--
-- KEYING — (tenant_id, source_system, source_tag_path). A given raw tag path
--   is unique per source system per tenant. Disable via enabled=false (soft);
--   hard DELETE is a migration-role operation.
--
-- CUTOVER — approved_tags.json stays the source of truth for the Ignition
--   gateway until a sync writes it into this table (Phase 4 D1 dual-write
--   window, master-plan open question D8 #11). This migration only creates the
--   table; it does not migrate the 46 rows (that is a seeding step on staging
--   first, then prod, per the KB-seed discipline).
--
-- TENANT ISOLATION — RLS dual-setting form. Mutable (enabled toggle, notes).

CREATE EXTENSION IF NOT EXISTS ltree;

CREATE TABLE IF NOT EXISTS approved_tags (
    tenant_id UUID NOT NULL,

    -- Which source the raw path comes from: 'ignition' | 'plc_bridge' |
    -- 'relay' | 'simulator'. Part of the key — the same raw path string
    -- from two sources is two distinct allowlist entries.
    source_system TEXT NOT NULL,

    -- The raw tag path exactly as the source names it (pre-UNS).
    source_tag_path TEXT NOT NULL,

    -- The normalized form the ingest endpoint produces (uns.slug-style),
    -- stored so the relay can match incoming traffic without re-normalizing
    -- on every request.
    normalized_tag_path TEXT,

    -- Resolved UNS path, when known. Nullable — a tag can be approved before
    -- its UNS mapping is built.
    uns_path LTREE,

    -- The allow/deny switch. Disabling is soft (keeps the audit trail).
    enabled BOOLEAN NOT NULL DEFAULT true,

    -- Free-form operator note ("added for GS10 commissioning 2026-06").
    notes TEXT,

    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (tenant_id, source_system, source_tag_path)
);

-- Idempotency guard: earlier versions of this migration created approved_tags
-- without these columns, so on a persistent staging DB the CREATE TABLE above
-- is skipped (IF NOT EXISTS) and the indexes/policy below would fail against
-- the stale table. Backfill the columns the rest of this migration references.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'approved_tags'
          AND column_name = 'normalized_tag_path'
    ) THEN
        ALTER TABLE approved_tags ADD COLUMN normalized_tag_path TEXT;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'approved_tags'
          AND column_name = 'uns_path'
    ) THEN
        ALTER TABLE approved_tags ADD COLUMN uns_path LTREE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'approved_tags'
          AND column_name = 'enabled'
    ) THEN
        ALTER TABLE approved_tags ADD COLUMN enabled BOOLEAN NOT NULL DEFAULT true;
    END IF;
END $$;

-- The relay's hot path: "is (tenant, source_system, normalized_path) allowed?"
CREATE INDEX IF NOT EXISTS approved_tags_normalized_idx
    ON approved_tags (tenant_id, source_system, normalized_tag_path)
    WHERE enabled = true;

-- Subtree queries ("all approved tags under <line>").
CREATE INDEX IF NOT EXISTS approved_tags_uns_path_gist
    ON approved_tags USING GIST (uns_path)
    WHERE uns_path IS NOT NULL;

ALTER TABLE approved_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS approved_tags_tenant ON approved_tags;
CREATE POLICY approved_tags_tenant
    ON approved_tags
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID
           OR tenant_id = current_setting('app.current_tenant_id', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::UUID
                OR tenant_id = current_setting('app.current_tenant_id', true)::UUID);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'factorylm_app') THEN
        GRANT SELECT, INSERT, UPDATE ON approved_tags TO factorylm_app;
    END IF;
END $$;

COMMIT;

-- ─── Rollback ─────────────────────────────────────────────────────────
-- BEGIN;
-- DROP POLICY IF EXISTS approved_tags_tenant ON approved_tags;
-- DROP TABLE IF EXISTS approved_tags;
-- COMMIT;
