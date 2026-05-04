-- mira-core/mira-ingest/db/migrations/007_tenant_ingested_files.sql
--
-- Unit 3.5 (90-day MVP): magic-inbox safety gates.
-- Per-tenant dedup ledger. Tracks every successfully-ingested file by
-- SHA-256 of its raw bytes so the same PDF forwarded twice doesn't
-- create double the chunks and noise.
--
-- Decoupled from knowledge_entries on purpose: that table is managed by
-- Open WebUI's chunking pipeline, and adding a hash column there would
-- require coordinating with OW's insert path. This is a separate ledger
-- with a single concern: "have we seen this exact file for this tenant
-- before?" Same pattern Pinecone, Mem.ai, Reflect use for inbox dedup.
--
-- Single-block transactional. New table, no existing readers, so no
-- CREATE INDEX CONCURRENTLY needed.

BEGIN;

CREATE TABLE IF NOT EXISTS tenant_ingested_files (
  tenant_id    TEXT NOT NULL,
  content_hash TEXT NOT NULL,                          -- SHA-256 hex of raw file bytes
  filename     TEXT NOT NULL,
  source       TEXT NOT NULL DEFAULT 'unknown',        -- 'inbox' | 'web-upload' | 'cron-oem' | 'unknown'
  ingested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, content_hash)
);

-- Recent-files lookup (admin / support queries; not on the hot path).
CREATE INDEX IF NOT EXISTS idx_tenant_ingested_files_tenant_recent
  ON tenant_ingested_files (tenant_id, ingested_at DESC);

COMMIT;

-- Verification:
--   \d tenant_ingested_files                                       -- PK on (tenant_id, content_hash)
--   \di idx_tenant_ingested_files_tenant_recent                    -- btree
--   INSERT INTO tenant_ingested_files (tenant_id, content_hash, filename, source)
--     VALUES ('00000000-...test', 'abc123', 'test.pdf', 'inbox');
--   INSERT INTO tenant_ingested_files (tenant_id, content_hash, filename, source)
--     VALUES ('00000000-...test', 'abc123', 'test.pdf', 'inbox');
--                                                                  -- second INSERT errors with "duplicate key"
--   DELETE FROM tenant_ingested_files WHERE tenant_id = '00000000-...test';
--
-- Rollback:
--   DROP TABLE IF EXISTS tenant_ingested_files;
