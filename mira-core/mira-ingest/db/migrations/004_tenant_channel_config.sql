-- mira-core/mira-ingest/db/migrations/004_tenant_channel_config.sql
BEGIN;

CREATE TABLE IF NOT EXISTS tenant_channel_config (
    tenant_id               UUID        PRIMARY KEY,
    enabled_channels        TEXT[]      NOT NULL DEFAULT ARRAY['openwebui', 'guest'],
    telegram_bot_username   TEXT,
    slack_workspace_id      TEXT,
    openwebui_url           TEXT        NOT NULL DEFAULT 'https://app.factorylm.com',
    allow_guest_reports     BOOLEAN     NOT NULL DEFAULT TRUE,
    allow_tech_self_signup  BOOLEAN     NOT NULL DEFAULT FALSE,
    remember_chooser_choice BOOLEAN     NOT NULL DEFAULT TRUE,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Backfill existing tenants to enabled_channels = ['openwebui', 'guest']
-- (matches today's expectation before this migration)
INSERT INTO tenant_channel_config (tenant_id, enabled_channels)
SELECT id::uuid, ARRAY['openwebui', 'guest']
FROM plg_tenants
ON CONFLICT (tenant_id) DO NOTHING;

COMMIT;
