# Runbook — Retrieval Embedding Coverage (backfill + verify)

**Owner:** retrieval / KB
**First written:** 2026-06-17 (after PR #2085 — the GS11/Micro820 garage-demo seed
chunks were 100% NULL-embedded and invisible to retrieval).
**Skill:** `.claude/skills/retrieval-diagnostics/SKILL.md`
**Tool:** `tools/backfill_knowledge_embeddings.py`
**Canary:** `tests/test_embedding_coverage_canary.py`

## What this fixes

SQL seeds (`tools/seeds/*.sql`) `INSERT INTO knowledge_entries (… content …)` with
**no `embedding` column**, so every seeded chunk lands with `embedding = NULL`.
NULL-embedding rows are invisible to the vector and product-name retrieval streams
in `mira-bots/shared/neon_recall.py` (`_product_search` filters
`embedding IS NOT NULL`) — they can only be surfaced by BM25/ILIKE, where the
fully-embedded OEM manuals out-rank them. Result: MIRA refuses or hedges answers it
should ground. This runbook embeds the dark rows so they re-enter retrieval.

Run it **whenever a text seed lands**, or when the canary
(`test_embedding_coverage_canary.py`) goes red, or when
`/mira-diagnose-retrieval` shows the answer chunk present in the corpus but absent
from the vector/product streams.

## Preconditions

- Ollama reachable with `nomic-embed-text` (`OLLAMA_BASE_URL`, default
  `localhost:11434`). CHARLIE has it; CI/prod need a reachable embedder.
- `knowledge_entries.embedding` is `vector(768)`; the tool asserts the dim before
  writing (a wrong model = silently broken cosine).
- Doppler access to the target env (`dev` / `stg` / `prd`).

## Hard rules

- **Never `psql` prod** from a code session. Verify prod coverage via `db-inspect.yml`.
- Backfill order is **dev → staging → prod**. Prove the lift on staging first.
- The prod backfill is a **write** — it runs through the gated dispatch, not ad hoc.

## Procedure

### 1. See the gap (dry run — writes nothing)

```bash
doppler run -p factorylm -c stg -- python tools/backfill_knowledge_embeddings.py --dry-run
```

Reports the NULL-embedding count by `source_type`. The curated retrieval types
(`field-guide`, `integration_guide`, `component_template`) should be the offenders
after a seed; the bulk OEM corpus (`equipment_manual`, …) should already be 0.

### 2. Backfill (staging)

```bash
doppler run -p factorylm -c stg -- python tools/backfill_knowledge_embeddings.py
# scope if needed:  --source-type field-guide   --limit 50
```

Idempotent (touches only NULLs); runs `ANALYZE knowledge_entries` after the batch
to refresh IVFFlat stats. Expect `embedded=N failed=0`.

### 3. Verify on the production path, raw (the acceptance check)

```bash
NEON_DATABASE_URL=<stg-url> python -m pytest tests/test_embedding_coverage_canary.py -v
```

Then confirm the target question now retrieves its answer chunk:

```bash
/mira-diagnose-retrieval "How do I read a parameter from a GS11 drive using a Micro820 over Modbus RTU?"
```

Pass = the answer chunk appears in top-k via the `vector`/`product` stream, and
`_product_search` for the named product returns > 0 rows (was 0).

### 4. Prove the lift (optional but expected for a fix PR)

```bash
doppler run -p factorylm -c stg -- python tests/mira_bench.py --output docs/evaluations/runs/<date>-<label>/
```

Compare grounded total + grounded-vs-baseline to the prior run; report per-question
net. (Reference: #2085 moved grounded 261→286 and flipped grounded-vs-baseline −5→+20.)

### 5. Promote to prod (gated)

1. Verify prod NULL-embedding coverage read-only via `db-inspect.yml`.
2. If confirmed, run the backfill against prod through the gated deploy/seed
   dispatch (same embedder + dim). Never psql prod, never run the tool against a
   prod connection string from a code session.
3. Re-run the canary against prod (read-only) to confirm 0 offenders.

## Don't recur — the seed-path guarantee

A seed is not "live" until its rows are embedded. After applying any text seed,
run step 2 (or wire the backfill into the seed workflow). The canary in CI is the
backstop, but the discipline is: **seed → backfill → verify**, every time.

## Rollback

Embeddings are additive (the tool only sets `embedding` on previously-NULL rows; it
never changes `tenant_id` / `is_private` / `content`). If a backfill used the wrong
model, null the affected rows and re-run with the correct one:

```sql
-- ONLY on dev/staging; identify the bad batch by source_type/time, then:
UPDATE knowledge_entries SET embedding = NULL WHERE <scoped predicate>;
```

## Cross-references

- `.claude/skills/retrieval-diagnostics/SKILL.md` — the diagnostic toolkit.
- `docs/superpowers/specs/2026-06-17-retrieval-null-embedding-coverage-gap.md` — root cause + spec.
- `tools/backfill_knowledge_embeddings.py` — the tool.
- `tests/test_embedding_coverage_canary.py` — the lock-in canary.
- `.claude/rules/knowledge-entries-tenant-scoping.md` — KB read/write law.
- `docs/environments.md` — dev → staging → prod promotion + db-inspect.
