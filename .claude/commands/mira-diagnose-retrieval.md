# /mira-diagnose-retrieval

Run the **production** retrieval path raw for a question and report what
`recall_knowledge` actually returns — ranks, retrieval streams, and whether the
answer chunk is present and embedded. This is the discriminating check that keeps
you from specifying a fix at the wrong layer (the F004/F0004 lesson applied to
retrieval). Skill: `.claude/skills/retrieval-diagnostics/SKILL.md`.

## When to run

- A bot/chat answer refuses or hedges for content the KB should cover.
- A reply cites the wrong manufacturer (cross-vendor) or drops the right one.
- A seed/upload just landed — confirm the chunk is retrievable, not just present.
- `mira_bench` / a grounding eval regressed and you need the per-question cause.
- **Before** specifying any retrieval/ranking fix — confirm the mechanism.

## Why raw (not the benchmark)

`tests/mira_bench.py` wraps recall in a harness-only equipment rerank + SQL
fallback that can mask or distort production behavior. The benchmark tells you
*that* a question missed; this command tells you *why*, on the path that ships.

## Environment

```bash
# staging, read-only; tenant is the UUID QUICKSTART_TENANT_ID (MIRA_TENANT_ID="staging" cast-errors)
doppler run -p factorylm -c stg -- python - "$QUESTION"
```

Never point this at prod. Embedder: `nomic-embed-text` via `OLLAMA_BASE_URL`.

## What it does

```python
import os, sys, httpx
sys.path.insert(0, "mira-bots")
from shared.neon_recall import recall_knowledge, _extract_product_names, _product_search
from sqlalchemy import create_engine, text

Q = sys.argv[1]
OLLAMA = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
TEN = os.environ.get("QUICKSTART_TENANT_ID") or os.environ.get("MIRA_TENANT_ID") or ""

def embed(t):
    return httpx.post(f"{OLLAMA}/api/embeddings",
                      json={"model": "nomic-embed-text:latest", "prompt": t},
                      timeout=20).json()["embedding"]

emb = embed(Q)
print(f"Q: {Q}\nproduct names: {_extract_product_names(Q)}\n")
rows = recall_knowledge(emb, TEN, limit=10, query_text=Q)
print(f"recall_knowledge top-{len(rows)} (rank | mfr / model p | streams | rrf):")
for i, r in enumerate(rows):
    print(f"  [{i}] {r.get('manufacturer')!r}/{r.get('model_number')!r} "
          f"p{r.get('source_page')} {r.get('retrieval_streams')} rrf={r.get('rrf_score')}")

# product stream + embedding presence — the NULL-embedding smell
eng = create_engine(os.environ["NEON_DATABASE_URL"], connect_args={"sslmode": "require"})
with eng.connect() as c:
    for name in _extract_product_names(Q):
        n = len(_product_search(c, lambda s: text(s), TEN, [name], emb, 8))
        print(f"\n_product_search({name!r}) -> {n} rows" + ("   <-- 0 = likely NULL embeddings" if n == 0 else ""))
```

## How to read the output

| Symptom | Likely cause | Next step |
|---|---|---|
| Answer chunk **absent**, `_product_search(name)` → **0 rows** | NULL embeddings (seed never embedded) | `docs/runbooks/retrieval-embedding-coverage.md` — backfill |
| Answer chunk present but **low rank**, embedded | ranking / RRF / dominant-manual flooding | consider per-entity quota / product-stream boost (re-measure first) |
| Right vendor **dropped**, wrong-tag chunk shown | cross-vendor false-drop (brand-label mismatch) | `uns_resolver.canonical_vendor` / `rag_worker.chunk_matches_vendor` (#2083) |
| Answer **not in corpus at all** | content gap | seed it (then backfill embeddings) |

## Follow-ups

- After a backfill, re-run this command — the answer chunk should appear via the
  `vector`/`product` stream.
- Prove the end-to-end lift with `mira_bench` (per-question net).
- Run `/mira-test-bot-grounding` before pushing any recall/RAG change.
