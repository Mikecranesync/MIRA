-- Migration 003: kb_dedup_state table for Redis dedup set backups
-- Status: PENDING — run via psql or ingest container
-- Write path: tools/backup_redis_dedup.py
-- Read path:  tools/restore_redis_dedup.py
--
-- Stores snapshots of Redis dedup sets so they can be restored after
-- a volume loss without re-ingesting the entire knowledge base.

CREATE TABLE IF NOT EXISTS kb_dedup_state (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_name         TEXT NOT NULL,          -- e.g. "mira:rss:seen_guids"
    key_type         TEXT NOT NULL,          -- "set" or "hash"
    members          JSONB NOT NULL,         -- set: ["id1","id2"], hash: {"url":"lastmod"}
    member_count     INTEGER NOT NULL,       -- for quick audit without parsing JSONB
    ttl_seconds      INTEGER,               -- NULL = no TTL, otherwise seconds
    backed_up_at     TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (key_name)                        -- one row per key, upserted each run
);

CREATE INDEX IF NOT EXISTS kb_dedup_state_key_idx
    ON kb_dedup_state (key_name);
