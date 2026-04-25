-- mira-core/mira-ingest/db/migrations/011_asset_context_cache.sql
--
-- Unit 7 (90-day MVP): QR scan pre-load asset context.
--
-- Two changes:
--
--   1. user_asset_sessions: add context_json + pre_loaded_at columns so the
--      Python FSM can store and surface Atlas WO history injected by the TS
--      QR handler.
--
--   2. asset_context_cache: NEW table keyed by (tenant_id, asset_tag).
--      The TS QR route writes here (it knows tenant_id + asset_tag but NOT
--      the Telegram chat_id).  The Python /start handler reads here, then
--      copies into user_asset_sessions for the actual chat_id.
--
-- Both changes are idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
-- Safe to run multiple times.
--
-- Run with:
--   doppler run -p factorylm -c prd -- psql "$NEON_DATABASE_URL" -f 011_asset_context_cache.sql
--
-- Rollback:
--   DROP TABLE IF EXISTS asset_context_cache;
--   ALTER TABLE user_asset_sessions DROP COLUMN IF EXISTS context_json;
--   ALTER TABLE user_asset_sessions DROP COLUMN IF EXISTS pre_loaded_at;

BEGIN;

-- ── 1. Extend user_asset_sessions ──────────────────────────────────────────

ALTER TABLE user_asset_sessions
  ADD COLUMN IF NOT EXISTS context_json  JSONB;

ALTER TABLE user_asset_sessions
  ADD COLUMN IF NOT EXISTS pre_loaded_at TIMESTAMPTZ;

-- ── 2. Create asset_context_cache ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS asset_context_cache (
    tenant_id       UUID        NOT NULL,
    asset_tag       TEXT        NOT NULL,
    atlas_asset_id  INTEGER,
    context_json    JSONB       NOT NULL DEFAULT '{}',
    pre_loaded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, asset_tag)
);

-- TTL index — Python cleanup job / future cron can prune rows older than 72h
CREATE INDEX IF NOT EXISTS idx_acc_pre_loaded_at
  ON asset_context_cache (pre_loaded_at);

COMMIT;

-- ── Verification ────────────────────────────────────────────────────────────
--
--   \d user_asset_sessions          -- context_json + pre_loaded_at present
--   \d asset_context_cache          -- table exists, PK on (tenant_id, asset_tag)
--   SELECT * FROM asset_context_cache LIMIT 1;
--
-- ── Comment block ────────────────────────────────────────────────────────────
COMMENT ON TABLE asset_context_cache IS
  'QR scan pre-load cache: TS handler writes Atlas WO history here keyed by '
  '(tenant_id, asset_tag); Python /start handler reads and merges into '
  'user_asset_sessions for the authed chat_id. 72h TTL enforced at read time.';

COMMENT ON COLUMN user_asset_sessions.context_json IS
  'Pre-loaded Atlas WO history JSON injected by QR scan handler. '
  'Shape: {"work_orders": [...], "asset_name": "...", "pre_loaded_at": "ISO8601"}';

COMMENT ON COLUMN user_asset_sessions.pre_loaded_at IS
  'Timestamp when context_json was injected from QR scan. '
  'Null means no QR pre-load for this session.';
