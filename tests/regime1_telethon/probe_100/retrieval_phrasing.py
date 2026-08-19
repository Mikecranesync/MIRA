"""Does PHRASING decide whether retrieval finds the manual?

The 100-question probe produced a result neither open issue predicted. Three
questions about the same two fault codes in the same corpus:

    "PowerFlex 525 showing F004. What does that fault mean...?"    5/5 cited
    "PowerFlex 525 throwing F004 after the conveyor jammed..."     1/5 cited
    "Got an F013 on a PowerFlex 525. What causes it?"              0/5 cited

The 0/5 case answered *"I don't have PowerFlex 525 docs for F013"* — while
another phrasing proves the drive's fault table is indexed and reachable. So the
corpus is not missing; the query is.

The suspected mechanism is BM25 built with `plainto_tsquery`, which joins terms
with AND: every extra narrative word ("throwing", "conveyor", "jammed",
"yesterday") becomes another term a chunk MUST contain, and a fault-table row
contains none of them.

This calls the PRODUCTION entry point — `neon_recall.recall_knowledge`, the same
function `rag_worker` calls — and reports how many chunks each phrasing returns.
A wrapper would prove only what the wrapper does; that mistake is what stalled
the #3165 diagnosis.

Read-only. No writes, staging corpus.

    doppler run -p factorylm -c stg -- py -3 -m tests.regime1_telethon.probe_100.retrieval_phrasing
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "mira-bots"))

# Same fault, five phrasings, increasing narrative noise. If the hypothesis
# holds, hit count falls as word count rises — not as relevance falls.
PHRASINGS = [
    ("bare code", "F004"),
    ("code + model", "PowerFlex 525 F004"),
    (
        "clean question",
        "PowerFlex 525 showing F004. What does that fault mean and what do I check first?",
    ),
    ("casual", "Got an F004 on a PowerFlex 525. What causes it?"),
    (
        "narrative",
        "PowerFlex 525 throwing F004 after the conveyor jammed yesterday — what should I check?",
    ),
    ("bare code f013", "F013"),
    ("clean f013", "PowerFlex 525 showing F013. What does that fault mean?"),
    ("casual f013", "Got an F013 on a PowerFlex 525. What causes it?"),
]


async def _embed(text: str) -> list[float] | None:
    """Best-effort embedding; recall_knowledge degrades to BM25 without one."""
    try:
        import httpx

        url = os.getenv("EMBEDDING_API_URL") or os.getenv("OPENWEBUI_URL")
        key = os.getenv("EMBEDDING_API_KEY") or os.getenv("OPENWEBUI_API_KEY")
        if not url or not key:
            return None
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.post(
                f"{url.rstrip('/')}/api/embeddings",
                headers={"Authorization": f"Bearer {key}"},
                json={"model": os.getenv("EMBEDDING_MODEL", "nomic-embed-text"), "prompt": text},
            )
            r.raise_for_status()
            return r.json().get("embedding")
    except Exception:
        return None


async def amain(args) -> int:
    from shared import neon_recall  # noqa: PLC0415 — needs the sys.path above

    print(f"{'phrasing':<16} {'words':>5} {'chunks':>7}  top source")
    print("-" * 78)
    rows = []
    for label, query in PHRASINGS:
        emb = await _embed(query) if not args.no_embed else None
        try:
            chunks = neon_recall.recall_knowledge(
                emb, args.tenant, limit=args.limit, query_text=query
            )
        except Exception as exc:
            print(f"{label:<16} {'':>5} {'ERROR':>7}  {type(exc).__name__}: {exc}")
            continue
        chunks = chunks or []
        top = ""
        if chunks:
            c0 = chunks[0]
            top = str(c0.get("source_url") or c0.get("title") or c0.get("doc_id") or "")[:44]
        rows.append((label, len(query.split()), len(chunks)))
        print(f"{label:<16} {len(query.split()):>5} {len(chunks):>7}  {top}")

    print()
    hits = [r for r in rows if r[2] > 0]
    dead = [r for r in rows if r[2] == 0]
    if dead:
        print(f"{len(dead)}/{len(rows)} phrasings returned ZERO chunks: {[r[0] for r in dead]}")
    if hits and dead:
        print(
            f"shortest LIVE query: {min(h[1] for h in hits)} words · "
            f"shortest dead query: {min(d[1] for d in dead)} words"
        )
    print("\nSame corpus, same fault. Any zero above is a retrieval failure, not a corpus gap.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tenant", default=os.getenv("MIRA_TENANT_ID"))
    ap.add_argument("--limit", type=int, default=10)
    ap.add_argument("--no-embed", action="store_true", help="force the BM25-only path")
    return asyncio.run(amain(ap.parse_args()))


if __name__ == "__main__":
    raise SystemExit(main())
