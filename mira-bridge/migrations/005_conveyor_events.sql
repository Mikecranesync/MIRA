-- 005: conveyor fault-detective event log
CREATE TABLE IF NOT EXISTS conveyor_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    ts              TEXT    NOT NULL,
    fault           TEXT    NOT NULL,
    confidence      REAL    NOT NULL,
    evidence_json   TEXT    NOT NULL DEFAULT '[]',
    affected_json   TEXT    NOT NULL DEFAULT '[]',
    resolved_ts     TEXT
);
CREATE INDEX IF NOT EXISTS idx_conveyor_events_ts ON conveyor_events(ts DESC);
CREATE INDEX IF NOT EXISTS idx_conveyor_events_fault ON conveyor_events(fault);
