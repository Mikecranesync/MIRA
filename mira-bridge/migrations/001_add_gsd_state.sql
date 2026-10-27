-- Migration 001: Add conversation_state table for GSD engine (v1.1.0)

-- #4844 Slice 1: keyed by (tenant_id, chat_id). Existing DBs are rebuilt
-- by 006_conversation_state_tenant_pk.sql / session_manager.ensure_table
-- (START FRESH — do not backfill old rows).
CREATE TABLE IF NOT EXISTS conversation_state (
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
