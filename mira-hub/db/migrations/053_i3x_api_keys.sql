-- Migration 053: i3x_api_keys — bearer keys for the read-only i3X API.
-- Each key is tenant-scoped, stores only a SHA-256 hash (never the plaintext),
-- and is read-only by construction (the i3X server has no write paths).
BEGIN;

CREATE TABLE IF NOT EXISTS i3x_api_keys (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  key_hash    TEXT NOT NULL UNIQUE,          -- sha256(hex) of the plaintext key
  label       TEXT,
  enabled     BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_i3x_api_keys_hash ON i3x_api_keys(key_hash) WHERE enabled;

-- Resolved BEFORE a tenant context exists (the key IS what identifies the
-- tenant), so the lookup runs as owner; do NOT enable RLS on this table.
COMMIT;
