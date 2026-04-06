# HNSW Index Migration Guide

## When to Run

After the knowledge base re-ingest is complete and verified (see `REMEDIATION_CHECKLIST.md`). The HNSW index should be built on clean, sentence-boundary-aligned chunks for best graph neighborhood quality.

## How to Run

```bash
doppler run --project factorylm --config prd -- \
  psql $NEON_DATABASE_URL -f mira-core/scripts/migrate_to_hnsw.sql
```

## Expected Duration

- ~1-2 minutes per 25,000 rows with `ef_construction=64`
- `CREATE INDEX CONCURRENTLY` does NOT lock the table — queries continue during build
- NeonDB may throttle on free tier; if it times out, retry

## Query-Time Tuning

After the index is built, add `SET LOCAL hnsw.ef_search = 100` to the recall query in `mira-bots/shared/neon_recall.py`. This increases recall accuracy at query time without affecting other sessions.

In `recall_knowledge()`, before the cosine search query:
```python
conn.execute(text("SET LOCAL hnsw.ef_search = 100"))
```

Default `ef_search` is 40. Higher values improve recall but increase latency. 100 is a good balance for 25K-50K entries.

## Rollback

If HNSW causes issues, restore IVFFlat:

```sql
DROP INDEX CONCURRENTLY IF EXISTS knowledge_entries_embedding_hnsw_idx;
CREATE INDEX CONCURRENTLY knowledge_entries_embedding_idx
ON knowledge_entries USING ivfflat (embedding vector_cosine_ops);
```

## Verification

Run before and after the migration to compare:

```sql
EXPLAIN ANALYZE
SELECT content, 1 - (embedding <=> cast('[0.1,0.2,...]' AS vector)) AS similarity
FROM knowledge_entries
WHERE tenant_id = 'your-tenant-id'
  AND embedding IS NOT NULL
ORDER BY embedding <=> cast('[0.1,0.2,...]' AS vector)
LIMIT 5;
```

Verify the plan shows `Index Scan using knowledge_entries_embedding_hnsw_idx`, not `Seq Scan`.
