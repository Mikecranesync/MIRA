# Measured query plans — round G code finding C3 ("OR on source_url disables the index")

Head `4a1fa3b17`. Ephemeral `postgres:16` container (Docker Desktop), table + the exact partial UNIQUE index of migration 003 (`idx_ke_chunk_dedup`), 200,000 unique rows (5,000 documents x 40 chunks, one tenant), `ANALYZE`, then `EXPLAIN` of the pre-PR predicate, the post-PR predicate (`OR` on the same column) and the `IN` form the finding proposes. Raw psql transcript, unedited:

```
                                                       version                                                        
----------------------------------------------------------------------------------------------------------------------
 PostgreSQL 16.14 (Debian 16.14-1.pgdg13+1) on x86_64-pc-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit
(1 row)

CREATE TABLE
CREATE INDEX
INSERT 0 200000
ANALYZE
=== BEFORE this PR (single equality, as shipped in #3268)
                                                                QUERY PLAN                                                                
------------------------------------------------------------------------------------------------------------------------------------------
 Aggregate  (cost=77.67..77.68 rows=1 width=8)
   ->  Index Scan using idx_ke_chunk_dedup on knowledge_entries  (cost=0.42..77.67 rows=1 width=0)
         Index Cond: ((tenant_id = '78917b56-0000-0000-0000-000000000000'::uuid) AND (source_url = 'https://example.com/doc7.pdf'::text))
         Filter: ((metadata ->> 'chunk_index'::text) = '3'::text)
(4 rows)

=== AFTER this PR (OR on the same column)
                                                                                                                                                                                   QUERY PLAN                                                                                                                                                                                   
--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 Aggregate  (cost=290.60..290.61 rows=1 width=8)
   ->  Bitmap Heap Scan on knowledge_entries  (cost=9.64..290.60 rows=1 width=0)
         Recheck Cond: (((tenant_id = '78917b56-0000-0000-0000-000000000000'::uuid) AND (source_url = 'https://example.com/doc7.pdf'::text) AND ((metadata ->> 'chunk_index'::text) IS NOT NULL)) OR ((tenant_id = '78917b56-0000-0000-0000-000000000000'::uuid) AND (source_url = 'HTTPS://EXAMPLE.COM/doc7.pdf'::text) AND ((metadata ->> 'chunk_index'::text) IS NOT NULL)))
         Filter: ((metadata ->> 'chunk_index'::text) = '3'::text)
         ->  BitmapOr  (cost=9.64..9.64 rows=79 width=0)
               ->  Bitmap Index Scan on idx_ke_chunk_dedup  (cost=0.00..4.82 rows=40 width=0)
                     Index Cond: ((tenant_id = '78917b56-0000-0000-0000-000000000000'::uuid) AND (source_url = 'https://example.com/doc7.pdf'::text))
               ->  Bitmap Index Scan on idx_ke_chunk_dedup  (cost=0.00..4.82 rows=40 width=0)
                     Index Cond: ((tenant_id = '78917b56-0000-0000-0000-000000000000'::uuid) AND (source_url = 'HTTPS://EXAMPLE.COM/doc7.pdf'::text))
(9 rows)

=== IN form the finding proposes (for comparison)
                                                                                   QUERY PLAN                                                                                    
---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 Aggregate  (cost=151.89..151.90 rows=1 width=8)
   ->  Index Scan using idx_ke_chunk_dedup on knowledge_entries  (cost=0.42..151.89 rows=1 width=0)
         Index Cond: ((tenant_id = '78917b56-0000-0000-0000-000000000000'::uuid) AND (source_url = ANY ('{https://example.com/doc7.pdf,HTTPS://EXAMPLE.COM/doc7.pdf}'::text[])))
         Filter: ((metadata ->> 'chunk_index'::text) = '3'::text)
(4 rows)

```

Reading: the `OR` form is served by a `BitmapOr` of two `Bitmap Index Scan`s on `idx_ke_chunk_dedup` — the index is used, there is no sequential scan; the `IN` form is a single `Index Scan` with `= ANY(...)` at roughly half the estimated cost (151.89 vs 290.60), which is a cost refinement, not a correctness or scan-type difference. `ON CONFLICT DO NOTHING` remains the DB-level backstop either way.
