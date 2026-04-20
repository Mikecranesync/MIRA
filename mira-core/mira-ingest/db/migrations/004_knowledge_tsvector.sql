-- mira-core/mira-ingest/db/migrations/004_knowledge_tsvector.sql
--
-- Unit 6 (90-day MVP): hybrid BM25 + pgvector retrieval.
-- Adds a STORED tsvector column on knowledge_entries.content and a GIN
-- index so neon_recall._recall_bm25() can rank by ts_rank_cd().
--
-- IMPORTANT: run Block 1 and Block 2 as SEPARATE psql statements.
-- CREATE INDEX CONCURRENTLY cannot run inside a BEGIN/COMMIT transaction.
-- Running the whole file with `psql -f` will error on the CONCURRENTLY
-- statement; run each block individually, or split into two files before
-- applying via an automated runner.

-- ──────────────────────────────────────────────────────────────────────
-- Block 1 (transactional): add the generated tsvector column.
-- Idempotent via IF NOT EXISTS. Expect ~15-30s on 25K+ rows while the
-- column is backfilled; this blocks writes to knowledge_entries. Run
-- during the nightly ingest window or a maintenance minute.
-- ──────────────────────────────────────────────────────────────────────
BEGIN;

ALTER TABLE knowledge_entries
  ADD COLUMN IF NOT EXISTS content_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED;

COMMIT;

-- ──────────────────────────────────────────────────────────────────────
-- Block 2 (NON-transactional — do NOT wrap in BEGIN/COMMIT).
-- GIN over the tsvector. CONCURRENTLY keeps writes unblocked while the
-- index builds; at 25K+ rows this finishes in well under a minute.
-- ──────────────────────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_knowledge_entries_content_tsv
  ON knowledge_entries USING GIN (content_tsv);

-- ──────────────────────────────────────────────────────────────────────
-- Verification (run after applying):
--
--   \d+ knowledge_entries                                   -- column shown as GENERATED
--   \di+ idx_knowledge_entries_content_tsv                  -- access method 'gin'
--   EXPLAIN ANALYZE SELECT content FROM knowledge_entries
--     WHERE content_tsv @@ plainto_tsquery('english', 'F023') LIMIT 10;
--                                                            -- Bitmap Index Scan on idx_knowledge_entries_content_tsv
--
-- Rollback (if required):
--   DROP INDEX CONCURRENTLY IF EXISTS idx_knowledge_entries_content_tsv;
--   ALTER TABLE knowledge_entries DROP COLUMN IF EXISTS content_tsv;
-- ──────────────────────────────────────────────────────────────────────
