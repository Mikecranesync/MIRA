-- #4844 Slice 1: rebuild conversation_state with PRIMARY KEY (tenant_id, chat_id).
-- Owner decision: existing rows have no tenant to backfill from; state is
-- short-lived — START FRESH. Do not assign old rows to a tenant.
-- Runtime path: mira-bots/shared/session_manager.ensure_table() performs the
-- same drop+create when it detects the chat_id-only schema.

DROP TABLE IF EXISTS conversation_state;

CREATE TABLE conversation_state (
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
