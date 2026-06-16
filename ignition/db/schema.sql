-- MIRA Ignition Integration — Database Schema
-- Applies to the internal Ignition database (configured under
-- Gateway > Config > Databases).
-- Compatible with: MySQL 5.7+, MariaDB 10.3+, PostgreSQL 12+
-- Note: AUTOINCREMENT is SQLite syntax; use AUTO_INCREMENT for MySQL/MariaDB.
--       Adjust the PRIMARY KEY syntax for your database engine.
--
-- Run via: Ignition Designer > Tools > Database Query Browser
-- Or on the DB server directly (e.g. mysql -u ignition -p factorylm < schema.sql)

-- ---------------------------------------------------------------------------
-- mira_fsm_models
-- Stores learned Finite State Machine models for each monitored asset.
-- One row per build. Latest model is selected with ORDER BY created_at DESC.
-- model_json — FSM structure:
--   {
--     "STATE_A": {
--       "STATE_B": {
--         "mean_ms": 1500.0,
--         "stddev_ms": 120.0,
--         "min_ms": 900.0,
--         "max_ms": 2500.0,
--         "count": 87,
--         "is_accepting": false
--       }
--     }
--   }
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mira_fsm_models (
    id          INTEGER      PRIMARY KEY AUTOINCREMENT,
    asset_id    TEXT         NOT NULL,
    model_json  TEXT         NOT NULL,
    cycle_count INTEGER      DEFAULT 0,
    created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- mira_anomalies
-- Persisted anomaly events detected by the FSM monitor and stuck-state timer.
-- detection_type: FORBIDDEN_TRANSITION | TIMING_DEVIATION | STUCK_STATE
-- severity:       CRITICAL | WARNING | INFO
-- acknowledged:   0 = unacknowledged, 1 = acknowledged by operator
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mira_anomalies (
    id              INTEGER     PRIMARY KEY AUTOINCREMENT,
    asset_id        TEXT        NOT NULL,
    detection_type  TEXT        NOT NULL,
    severity        TEXT        NOT NULL,
    from_state      TEXT,
    to_state        TEXT,
    expected_ms     REAL,
    actual_ms       REAL,
    sigma           REAL,
    message         TEXT,
    acknowledged    INTEGER     DEFAULT 0,
    ack_by          TEXT,
    ack_at          TIMESTAMP,
    created_at      TIMESTAMP   DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- mira_chat_history
-- Audit trail for all RAG queries submitted through the Mira chat interface.
-- sources_json — JSON array of source citations returned by the sidecar:
--   [{"file": "pump_manual.pdf", "page": 12, "excerpt": "..."}]
-- operator     — optional: the logged-in Perspective session user
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mira_chat_history (
    id           INTEGER     PRIMARY KEY AUTOINCREMENT,
    asset_id     TEXT,
    query        TEXT        NOT NULL,
    answer       TEXT        NOT NULL,
    sources_json TEXT,
    operator     TEXT,
    created_at   TIMESTAMP   DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- Indexes
-- Optimize common query patterns:
--   - Alerts feed filtered and sorted by asset + time
--   - Chat history by asset
--   - FSM model lookup by asset
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_anomalies_asset
    ON mira_anomalies (asset_id);

CREATE INDEX IF NOT EXISTS idx_anomalies_created
    ON mira_anomalies (created_at);

CREATE INDEX IF NOT EXISTS idx_anomalies_asset_created
    ON mira_anomalies (asset_id, created_at);

CREATE INDEX IF NOT EXISTS idx_anomalies_unacked
    ON mira_anomalies (acknowledged, created_at);

CREATE INDEX IF NOT EXISTS idx_chat_asset
    ON mira_chat_history (asset_id);

CREATE INDEX IF NOT EXISTS idx_chat_created
    ON mira_chat_history (created_at);

CREATE INDEX IF NOT EXISTS idx_fsm_asset
    ON mira_fsm_models (asset_id);

CREATE INDEX IF NOT EXISTS idx_fsm_asset_created
    ON mira_fsm_models (asset_id, created_at);
