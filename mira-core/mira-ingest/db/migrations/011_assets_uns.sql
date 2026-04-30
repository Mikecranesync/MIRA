-- mira-core/mira-ingest/db/migrations/011_assets_uns.sql
--
-- Unit 5 (90-day MVP): UNS-style asset model.
-- Adds ltree extension + an `assets` table with hierarchical uns_path
-- (e.g. enterprise.site_a.line_2.cell_3) so the Telegram /asset command
-- can walk the customer's plant hierarchy.
--
-- Numbered 011 (not 005 as in the original plan). The plan was drafted
-- when 003 was the latest; 004-010 were merged in flight (channel
-- config, guest reports, knowledge tsvector, ingested files, hub
-- users/tenants, tenant_id backfills). 011 is the next free slot.
--
-- Companion path (read): mira-bots/shared/assets.py
-- Companion path (backfill): mira-core/scripts/backfill_uns.py
--
-- Reuses asset_qr_tags (migration 003) for the QR scan path; the new
-- `assets` table is additive and joined on (tenant_id, asset_tag).
--
-- Per CLAUDE.md NeonDB rules: use `IF NOT EXISTS` everywhere (idempotent
-- replays); UUID for tenant_id matches asset_qr_tags (NOT the TEXT
-- 'mike' default used by hub-readable tables in 009/010).

BEGIN;

-- ──────────────────────────────────────────────────────────────────────
-- 1. ltree extension. Safe to call repeatedly; CREATE EXTENSION IF NOT
--    EXISTS is a Postgres-native idempotent op.
-- ──────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS ltree;

-- ──────────────────────────────────────────────────────────────────────
-- 2. assets table.
--    uns_path examples:
--      enterprise
--      enterprise.site_a
--      enterprise.site_a.line_2
--      enterprise.site_a.line_2.cell_3
--    ltree labels are [A-Za-z0-9_], max 256 chars per label, max 65535
--    levels — plenty for 4-6 level UNS hierarchies.
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS assets (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID         NOT NULL,
    atlas_asset_id  TEXT,
    asset_tag       TEXT,
    name            TEXT,
    uns_path        LTREE        NOT NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ──────────────────────────────────────────────────────────────────────
-- 3. Indexes.
--    GIST on uns_path is the canonical ltree index — supports ancestor
--    (@>), descendant (<@), and lquery (~) operators in O(log n).
--    BTREE on tenant_id keeps simple "all assets for tenant X" queries
--    fast even when ltree isn't part of the predicate.
--    UNIQUE on (tenant_id, uns_path) prevents duplicate rows for the
--    same physical asset when backfill is replayed.
-- ──────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_assets_uns_path
    ON assets USING GIST (uns_path);

CREATE INDEX IF NOT EXISTS idx_assets_tenant
    ON assets (tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_assets_tenant_uns_path
    ON assets (tenant_id, uns_path);

-- ──────────────────────────────────────────────────────────────────────
-- 4. Optional unique on (tenant_id, asset_tag) to keep the QR join sane.
--    asset_tag may be NULL (top-level nodes don't have QR codes); the
--    partial index excludes those.
-- ──────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uniq_assets_tenant_tag
    ON assets (tenant_id, asset_tag)
    WHERE asset_tag IS NOT NULL;

COMMIT;

-- ──────────────────────────────────────────────────────────────────────
-- Verification (run after applying):
--
--   SELECT extname FROM pg_extension WHERE extname = 'ltree';
--                                                  -- 1 row
--   \d+ assets                                    -- columns + indexes shown
--   \di+ idx_assets_uns_path                      -- access method 'gist'
--
--   -- Smoke test: insert a 4-level hierarchy + walk it.
--   INSERT INTO assets (tenant_id, name, uns_path) VALUES
--     ('00000000-0000-0000-0000-000000000001'::uuid, 'Acme Corp',  'acme'),
--     ('00000000-0000-0000-0000-000000000001'::uuid, 'Site A',     'acme.site_a'),
--     ('00000000-0000-0000-0000-000000000001'::uuid, 'Line 2',     'acme.site_a.line_2'),
--     ('00000000-0000-0000-0000-000000000001'::uuid, 'Cell 3',     'acme.site_a.line_2.cell_3');
--
--   -- Children one level below 'acme.site_a':
--   SELECT name, uns_path FROM assets
--     WHERE uns_path ~ 'acme.site_a.*{1}'
--       AND tenant_id = '00000000-0000-0000-0000-000000000001'::uuid;
--                                                  -- 1 row: Line 2
--
--   -- All descendants:
--   SELECT name, uns_path FROM assets
--     WHERE uns_path <@ 'acme.site_a'
--       AND tenant_id = '00000000-0000-0000-0000-000000000001'::uuid;
--                                                  -- 3 rows
--
-- Rollback (if required):
--   DROP INDEX IF EXISTS uniq_assets_tenant_tag;
--   DROP INDEX IF EXISTS uniq_assets_tenant_uns_path;
--   DROP INDEX IF EXISTS idx_assets_tenant;
--   DROP INDEX IF EXISTS idx_assets_uns_path;
--   DROP TABLE IF EXISTS assets;
--   -- ltree extension left in place — may be in use by other migrations.
-- ──────────────────────────────────────────────────────────────────────
