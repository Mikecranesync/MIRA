-- MIRA: Migrate pgvector index from IVFFlat to HNSW
-- Run AFTER re-ingest is complete and verified.
-- See docs/HNSW_MIGRATION.md for full instructions.
--
-- Usage:
--   psql $NEON_DATABASE_URL -f mira-core/scripts/migrate_to_hnsw.sql

-- Step 1: Drop old IVFFlat index (CONCURRENTLY = no table lock)
DROP INDEX CONCURRENTLY IF EXISTS knowledge_entries_embedding_idx;

-- Step 2: Create HNSW index
-- m=16: connections per node (default 16, good for 768-dim)
-- ef_construction=64: build-time search breadth (higher = better recall, slower build)
CREATE INDEX CONCURRENTLY knowledge_entries_embedding_hnsw_idx
ON knowledge_entries
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Step 3: Verify
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'knowledge_entries'
  AND indexname LIKE '%embedding%';
