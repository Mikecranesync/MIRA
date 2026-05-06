-- Migration 004: Atlas WO outbox (Unit 8 hardening — CRA-17)
--
-- Persists work-order payloads that failed to write to Atlas/MCP after the
-- in-process retry budget exhausted. A drain task in mira-bots picks them
-- up every 5 minutes and re-attempts; rows that stay unsent past 3h fire
-- exactly one admin alert via notifications/push.send_push.

CREATE TABLE IF NOT EXISTS wo_outbox (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    payload_json    TEXT NOT NULL,             -- create_work_order kwargs
    attempts        INTEGER NOT NULL DEFAULT 0,
    last_error      TEXT,
    created_at      REAL NOT NULL,             -- unix timestamp
    last_attempt_at REAL,
    sent_at         REAL,                      -- NULL until Atlas accepts
    atlas_wo_id     INTEGER,                   -- populated on success
    alerted_at      REAL                       -- NULL until 3h-stale alert fired
);

CREATE INDEX IF NOT EXISTS idx_wo_outbox_pending
    ON wo_outbox(sent_at, last_attempt_at) WHERE sent_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_wo_outbox_stale
    ON wo_outbox(sent_at, alerted_at, created_at) WHERE sent_at IS NULL AND alerted_at IS NULL;
