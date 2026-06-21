---
name: retrieval-diagnostics
description: >
  Use when a MIRA bot/chat answer is ungrounded, refuses ("the KB does not contain
  enough information") for content that should exist, cites the wrong vendor, or when
  seeds/uploads just landed and you need to confirm they're retrievable. Trigger on:
  "why did MIRA refuse / not cite", "retrieval miss", "the bench regressed", "did the
  seed take", "wrong manufacturer chunks", "recall looks thin". Diagnoses retrieval at
  the PRODUCTION layer (recall_knowledge) — NOT through a benchmark harness wrapper —
  and carries the verify-before-guessing discipline that turned a wrong "ranking fix"
  into the real NULL-embedding fix (2026-06-17, PRs #2083/#2085).
---

# Retrieval Diagnostics

A repeatable toolkit for diagnosing and repairing MIRA retrieval (the
`knowledge_entries` KB → `recall_knowledge` → grounded answer path). Codifies the
four actions that found and fixed two real retrieval bugs in one session
(cross-vendor false-drop #2083, NULL-embedding coverage gap #2085).

## The one rule: diagnose on the PRODUCTION path, raw

A benchmark result measured **through a harness wrapper** is inconclusive about the
production mechanism. `tests/mira_bench.py` applies a harness-only equipment rerank +
SQL fallback on top of recall; that layer can *mask or distort* what production
`recall_knowledge` actually returns. **Before you spec or commit a fix, run the
production function raw** (`mira-bots/shared/neon_recall.recall_knowledge`, no
harness) and look at what it really returns: ranks, `retrieval_streams`, and whether
the answer chunk is present at all. This is the F004/F0004 lesson
(`.claude/rules/debugging-conventions.md` §2) applied to retrieval.

> Worked example: the `mira_bench` Q01/Q10 "ranking misses" looked like an RRF
> ranking problem. One raw `recall_knowledge(Q01)` call showed the answer chunks had
> **NULL embeddings** and never entered the vector/product streams at all — an
> RRF-reweighting fix would have done nothing. Run it raw first.

## When to use

- A bot/chat reply refuses or hedges for a question the KB should cover.
- A reply cites the wrong manufacturer, or drops the right one (cross-vendor).
- A seed (`tools/seeds/*.sql`) or upload just landed — confirm it's retrievable.
- `mira_bench` / a grounding eval regressed and you need the per-question cause.
- You're about to spec a retrieval fix — confirm the mechanism first.

## Environments (hard rules)

- Diagnose against **staging** (`doppler -p factorylm -c stg`). `recall_knowledge`
  reads are read-only. **Never `psql` prod** from a code session; verify prod state
  via `db-inspect.yml` (sanctioned read).
- The bench/diagnostic tenant is `QUICKSTART_TENANT_ID` (a UUID) — `MIRA_TENANT_ID`
  in stg is the literal string `"staging"` (not a valid UUID; will cast-error).
- Embedder: `nomic-embed-text` via Ollama (`OLLAMA_BASE_URL`, default
  `localhost:11434`). The stored column is `vector(768)` — any backfill MUST embed
  in the same model/dimension or cosine is silently meaningless.

## The four repeatable actions

### 1. Raw `recall_knowledge` diagnostic — "what does production actually return?"

The discriminating check. Run `/mira-diagnose-retrieval "<question>"` (see
`.claude/commands/mira-diagnose-retrieval.md`), or inline:

```python
# doppler run -p factorylm -c stg -- python
import os, httpx, sys; sys.path.insert(0, "mira-bots")
from shared.neon_recall import recall_knowledge
emb = httpx.post(f"{os.environ.get('OLLAMA_BASE_URL','http://localhost:11434')}/api/embeddings",
                 json={"model":"nomic-embed-text:latest","prompt":Q}, timeout=20).json()["embedding"]
rows = recall_knowledge(emb, os.environ["QUICKSTART_TENANT_ID"], limit=10, query_text=Q)
for i,r in enumerate(rows):
    print(i, r.get("manufacturer"), r.get("model_number"), "p"+str(r.get("source_page")),
          r.get("retrieval_streams"), r.get("rrf_score"))
```

Read: is the answer chunk present at all? At what rank? Via which **stream**
(`vector` / `product` / `bm25` / `like`)? **Zero `product`-stream rows when the
query names a product is the NULL-embedding smell** — go to action 2.

### 2. Corpus verify-before-spec — "does the answer even exist, and is it findable?"

Never spec a ranking/RRF fix for what is actually a content or embedding gap. Confirm:

```sql
-- answer exists?
SELECT manufacturer, model_number, source_page, left(content,120)
FROM knowledge_entries WHERE content ILIKE '%<answer phrase>%' LIMIT 10;
-- is it embedded? (NULL embedding ⇒ invisible to vector + product streams)
SELECT source_type, count(*) total, count(*) FILTER (WHERE embedding IS NULL) no_emb
FROM knowledge_entries GROUP BY source_type ORDER BY no_emb DESC;
-- manufacturer tag variants (cross-vendor false-drop risk)
SELECT manufacturer, count(*) FROM knowledge_entries GROUP BY manufacturer ORDER BY 2 DESC;
```

Decide the layer from the evidence: exists + embedded but mis-ranked → ranking;
exists + NULL embedding → coverage (action 3); doesn't exist → seed it; wrong-tag
drop → cross-vendor (`uns_resolver.canonical_vendor`, #2083).

### 3. Embedding-coverage backfill + canary — "make seeded chunks retrievable"

SQL seeds insert text-only rows (no `embedding` column) → `embedding = NULL` →
invisible to the vector + product-name streams. Repair (full procedure:
`docs/runbooks/retrieval-embedding-coverage.md`):

```bash
# dry-run, then backfill (staging; ANALYZE built-in)
doppler run -p factorylm -c stg -- python tools/backfill_knowledge_embeddings.py --dry-run
doppler run -p factorylm -c stg -- python tools/backfill_knowledge_embeddings.py
# lock it in — canary must stay green
NEON_DATABASE_URL=<stg> python -m pytest tests/test_embedding_coverage_canary.py -v
```

### 4. `mira_bench` before/after — "prove the lift, net not gross"

```bash
doppler run -p factorylm -c stg -- python tests/mira_bench.py --output docs/evaluations/runs/<date>-<label>/
```

Compare **grounded total** and **grounded-vs-baseline** against the prior run, and
report **per-question net** (a +10 on Q01 is meaningless if two others go −6). The
bench bypasses the rag_worker cross-vendor filter, so it does NOT measure that layer
(#2083) — only the recall + answer path. Say which layer your change touched.

## Anti-patterns

- ❌ Concluding a retrieval cause from the bench's post-rerank output — run recall raw.
- ❌ Specifying an RRF/ranking fix before checking the chunk has an embedding.
- ❌ Backfilling with a non-768-dim / non-`nomic-embed-text` model (silent bad cosine).
- ❌ `psql` against prod to "just check" — use `db-inspect.yml`.
- ❌ Reporting a gross bench gain without the per-question net + regressions.

## Cross-references

- `.claude/commands/mira-diagnose-retrieval.md` — the raw-recall diagnostic command.
- `docs/runbooks/retrieval-embedding-coverage.md` — the backfill repair runbook.
- `tools/backfill_knowledge_embeddings.py` — the backfill tool (dim-guarded, idempotent).
- `tests/test_embedding_coverage_canary.py` — the NULL-embedding lock-in canary.
- `docs/superpowers/specs/2026-06-17-retrieval-null-embedding-coverage-gap.md` — the spec + recorded misdiagnosis.
- `.claude/skills/bot-grounding-tests/` — the regression net (run before pushing recall/RAG changes).
- `.claude/rules/knowledge-entries-tenant-scoping.md` — hybrid read law (is_private + shared corpus).
- `.claude/rules/debugging-conventions.md` §2 — verify schema/paths before guessing.
- `mira-bots/shared/neon_recall.py` — `recall_knowledge`, `_product_search`, `_merge_results`.
