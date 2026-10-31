-- Migration 001: Add conversation_state table for GSD engine (v1.1.0)
-- Legacy chat_id-only table. Slice 1 (#4844) does not rebuild this table —
-- new code uses conversation_state_v2 (006). Old services keep writing here
-- until they are redeployed (mixed-version safe).

CREATE TABLE IF NOT EXISTS conversation_state (
    chat_id          TEXT PRIMARY KEY,
    state            TEXT NOT NULL DEFAULT 'IDLE',
    context          TEXT NOT NULL DEFAULT '{}',
    asset_identified TEXT,
    fault_category   TEXT,
    exchange_count   INTEGER NOT NULL DEFAULT 0,
    final_state      TEXT,
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
