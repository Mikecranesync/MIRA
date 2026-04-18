-- Migration: Create user_asset_sessions table for cross-session equipment memory (GH #329)
-- Run once against NeonDB:
--   doppler run -p factorylm -c prd -- psql "$NEON_DATABASE_URL" -f 001_user_asset_sessions.sql

CREATE TABLE IF NOT EXISTS user_asset_sessions (
    chat_id          TEXT PRIMARY KEY,
    asset_id         TEXT NOT NULL,
    open_wo_id       TEXT,
    last_seen_fault  TEXT,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Index for TTL cleanup queries
CREATE INDEX IF NOT EXISTS idx_uas_updated_at ON user_asset_sessions (updated_at);

COMMENT ON TABLE user_asset_sessions IS 'Cross-session asset context: remembers which equipment a tech was working on';
COMMENT ON COLUMN user_asset_sessions.chat_id IS 'Telegram user ID (stable across sessions)';
COMMENT ON COLUMN user_asset_sessions.asset_id IS 'Equipment identifier from vision/nameplate (e.g. "GS10 VFD")';
COMMENT ON COLUMN user_asset_sessions.open_wo_id IS 'Open work order ID from Atlas CMMS, if any';
COMMENT ON COLUMN user_asset_sessions.last_seen_fault IS 'Most recent fault code seen in this session';
COMMENT ON COLUMN user_asset_sessions.updated_at IS '72-hour TTL enforced at read time';
