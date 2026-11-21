-- #4844 Slice 1: conversation_state_v2 keyed by (tenant_id, chat_id).
-- Does NOT drop or alter the legacy conversation_state table. Old services
-- (mira-pipeline, mira-mcp, Telegram/Slack, mira-ask) keep writing the
-- chat_id-only table until they are redeployed. New code reads/writes only
-- conversation_state_v2. No backfill — START FRESH on the new table.

CREATE TABLE IF NOT EXISTS conversation_state_v2 (
    tenant_id        TEXT NOT NULL,
    chat_id          TEXT NOT NULL,
    state            TEXT NOT NULL DEFAULT 'IDLE',
    context          TEXT NOT NULL DEFAULT '{}',
    asset_identified TEXT,
    fault_category   TEXT,
    exchange_count   INTEGER NOT NULL DEFAULT 0,
    final_state      TEXT,
    voice_enabled    INTEGER NOT NULL DEFAULT 0,
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, chat_id)
);
