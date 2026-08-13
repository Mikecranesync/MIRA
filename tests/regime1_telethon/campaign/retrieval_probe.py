"""Retrieval probe — what the corpus actually returns for a historical turn.

This is the instrumentation #3165 is blocked on, and #3156 turned out to need
too. Both investigations stalled at the same wall: **the campaign ledger records
what was SAID, never what was RETRIEVED.** Without that, a grounding guard
cannot have its false-positive rate measured before it ships, and this arc's
record is that every guard false-positives on first contact with real data.

What this module adds is the missing half of the evidence:

    replay.py            -> ORCHESTRATION  (which states, gates, dispatch)
    retrieval_probe.py   -> GROUNDING      (which chunks the query actually returns)

Together they populate `evidence.TurnEvidence`, whose `retrieved_ids` /
`retrieved_meta` fields have existed as empty slots since the flight-recorder
was defined. This is the producer for them.

It calls the PRODUCTION retrieval entry point — `neon_recall.recall_knowledge`,
the same function `rag_worker` calls — not a harness reimplementation. That
discipline is what falsified the #3165 hypothesis; a wrapper would have
reproduced the wrapper's behaviour instead of MIRA's.

## How the query is reconstructed

`rag_worker` builds `recall_query = state["retrieval_query"] or f"{asset} {msg}"`.
`asset` comes from `resolve_uns_path` over the technician's own words — it is
deterministic, so `replay.py` reproduces it faithfully even though replay stubs
the model's prose. That is why the asset context here is trustworthy while the
replayed reply text is not.

## What this does NOT claim, stated plainly

  * **It probes the corpus as it is TODAY, not as it was during the run.** Rows
    get seeded and re-embedded. A token unsupported now may have been supported
    then, and vice versa.
  * **Without an embedding it is a WEAKER retrieval than production.** If Ollama
    is unreachable, `recall_knowledge` skips the vector and product-rerank
    streams and only BM25 / structured-fault / ILIKE run. Fewer chunks come back,
    so more claims look unsupported. That biases a fabrication measurement toward
    OVER-counting false positives — the conservative direction for calibrating a
    guard, but it must be read as a bound, not a number. Every record therefore
    carries `embedded: true|false`; a mixed run is not a comparable set.
  * **It does not prove what MIRA saw.** It proves what a guard would see today
    if it asked the same question.

Usage:
    py -3 -m tests.regime1_telethon.campaign.retrieval_probe --campaign c12s46
    py -3 -m tests.regime1_telethon.campaign.retrieval_probe --campaign c7 \\
        --conv t2_005_pivot_after_fault --check-params
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import io
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "mira-bots"))

from tests.regime1_telethon.campaign import fabrication  # noqa: E402
from tests.regime1_telethon.campaign import replay as replay_mod  # noqa: E402
from tests.regime1_telethon.campaign.evidence import ConversationEvidence  # noqa: E402

LEDGER_DIR = HERE / "ledger"
OUT_DIR = HERE / "retrieval"

# Production default (rag_worker passes no explicit limit on the main path and
# recall_knowledge fuses streams); 10 is what the #3165 diagnosis inspected.
DEFAULT_LIMIT = 10


def recorded_replies(campaign: str, conv_id: str) -> dict[int, str]:
    """MIRA's REAL replies from the ledger, keyed by turn index.

    Deliberately separate from `replay.technician_turns`, which refuses to load
    them. Replay must not see old replies — it would stop being a replay. This
    probe is the opposite job: it grades text MIRA really emitted, so it needs
    exactly those rows and none of replay's fixture prose.
    """
    path = LEDGER_DIR / f"{campaign}.jsonl"
    if not path.exists():
        raise FileNotFoundError(f"no ledger for campaign {campaign!r}: {path}")
    out: dict[int, str] = {}
    for line in io.open(path, encoding="utf-8"):
        if not line.strip():
            continue
        rec = json.loads(line)
        if rec.get("kind") != "turn" or rec.get("conv") != conv_id:
            continue
        if rec.get("role") != "mira":
            continue
        idx = rec.get("i")
        if idx is not None:
            out[int(idx)] = rec.get("text") or ""
    return out


def recall_query(message: str, asset_identified: str | None) -> str:
    """Mirror `rag_worker`'s query construction.

    rag_worker:  embed_query = f"{state['asset_identified']} {message}"
                 recall_query = state.get("retrieval_query") or embed_query

    `retrieval_query` is a kiosk/print surface override that the Telethon lane
    never sets, so the second branch is the one campaign turns take.
    """
    asset = (asset_identified or "").strip()
    return f"{asset} {message}".strip() if asset else message.strip()


async def _embed(text: str) -> list[float] | None:
    """Embed via Ollama exactly as `rag_worker._embed_ollama` does.

    Returns None when the sidecar is unreachable — the same fall-through
    production takes, which keeps BM25 / structured-fault / ILIKE alive. The
    caller records WHICH happened; see the module docstring on why a mixed run
    is not a comparable set.
    """
    import httpx

    primary = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
    model = os.environ.get("EMBED_TEXT_MODEL", "nomic-embed-text:latest")
    candidates = [primary]
    if primary != "http://localhost:11434":
        candidates.append("http://localhost:11434")
    for url in candidates:
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                resp = await client.post(
                    f"{url}/api/embeddings", json={"model": model, "prompt": text}
                )
                resp.raise_for_status()
                return resp.json()["embedding"]
        except Exception:
            continue
    return None


def _chunk_meta(chunk: dict) -> dict:
    """Identifiers + metadata for one retrieved chunk.

    `evidence.TurnEvidence` says retrieval fields carry "identifiers + metadata
    ONLY, never corpus content" — the corpus is licensed material and a ledger
    is a file on someone's laptop. A SHA-256 of the content gives a stable id
    and lets two runs be compared without storing the text. `content_head` is a
    short excerpt kept only so a human can tell what a row IS while triaging.
    """
    content = chunk.get("content") or ""
    return {
        "sha256": hashlib.sha256(content.encode("utf-8")).hexdigest()[:16],
        "source_type": chunk.get("source_type"),
        "manufacturer": chunk.get("manufacturer"),
        "model_number": chunk.get("model_number"),
        "source_page": chunk.get("source_page"),
        "similarity": chunk.get("similarity"),
        "streams": chunk.get("retrieval_streams"),
        "content_head": content[:160],
        "content_len": len(content),
    }


def param_support(reply: str, supplied: str, chunks: list[dict]) -> list[dict]:
    """Was each parameter-shaped token in `reply` present in what was retrieved?

    This is the measurement #3165's spec asks for and could not make. CIT-006
    shipped on a strictly weaker signal — does the token exist ANYWHERE in the
    corpus — because corpus-wide existence is a sound lower bound that needs no
    per-turn snapshot. With the snapshot, the sharper question becomes
    answerable: was it in the evidence THIS answer was built on?

    `supported` is deliberately three-valued. False means "checked, absent".
    None is never returned here — chunks==[] is a real observation (retrieval
    returned nothing, so nothing supports the claim) and is reported as False
    with `n_chunks: 0` so a reader can tell the two situations apart.
    """
    tokens = sorted(fabrication.extract_param_claims(reply, supplied))
    haystack = "\n".join((c.get("content") or "") for c in chunks).lower()
    out = []
    for tok in tokens:
        out.append(
            {
                "token": tok,
                "supported": tok.lower() in haystack,
                "n_chunks": len(chunks),
            }
        )
    return out


async def probe_conversation(
    campaign: str,
    conv_id: str,
    *,
    limit: int = DEFAULT_LIMIT,
    tenant_id: str | None = None,
) -> ConversationEvidence:
    """Replay for state, then probe real retrieval for each technician turn.

    The replay half is what makes the query faithful: `asset_identified` after
    turn N-1 is what production would have carried into turn N.
    """
    from shared import neon_recall  # noqa: PLC0415 — after sys.path setup

    turns = replay_mod.technician_turns(campaign, conv_id)
    if not turns:
        raise ValueError(f"no technician turns for {campaign}/{conv_id}")

    conv = await replay_mod.replay_conversation(turns, conv_id=conv_id, source_campaign=campaign)
    replies = recorded_replies(campaign, conv_id)

    for turn in conv.turns:
        query = recall_query(turn.technician_message, turn.asset_identified)
        embedding = await _embed(query)
        try:
            chunks = neon_recall.recall_knowledge(
                embedding, tenant_id, limit=limit, query_text=query
            )
        except Exception as exc:  # a probe must never take the caller down
            turn.retrieved_meta = [{"error": f"{type(exc).__name__}: {exc}"}]
            continue
        turn.retrieved_ids = [_chunk_meta(c)["sha256"] for c in chunks]
        turn.retrieved_meta = [_chunk_meta(c) for c in chunks]
        # The RECORDED reply, not the replayed fixture — grading fixture prose
        # would measure nothing. Left on the evidence object so a detector sees
        # the real text alongside the real chunks.
        turn.mira_reply = replies.get(turn.index, "")
        turn.retrieval_query = query
        turn.retrieval_embedded = embedding is not None
        turn.param_support = param_support(turn.mira_reply, turn.technician_message, chunks)

    return conv


def write_records(conv: ConversationEvidence, campaign: str) -> Path:
    """Append one JSONL record per turn. Gitignored, like the ledgers."""
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / f"{campaign}.jsonl"
    with io.open(path, "a", encoding="utf-8") as fh:
        for turn in conv.turns:
            fh.write(
                json.dumps(
                    {
                        "campaign": campaign,
                        "conv": conv.conv_id,
                        "i": turn.index,
                        "query": turn.retrieval_query or "",
                        "embedded": turn.retrieval_embedded,
                        "asset_identified": turn.asset_identified,
                        "uns_model": turn.uns_model,
                        "uns_fault_code": turn.uns_fault_code,
                        "retrieved": turn.retrieved_meta,
                        "param_support": turn.param_support,
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )
    return path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--campaign", required=True)
    ap.add_argument("--conv", required=True)
    ap.add_argument("--limit", type=int, default=DEFAULT_LIMIT)
    ap.add_argument("--tenant", default=None)
    ap.add_argument(
        "--check-params",
        action="store_true",
        help="print the parameter-claim support table (the #3165 measurement)",
    )
    args = ap.parse_args()

    conv = asyncio.run(
        probe_conversation(args.campaign, args.conv, limit=args.limit, tenant_id=args.tenant)
    )
    path = write_records(conv, args.campaign)

    print(f"probed {conv.conv_id} from {args.campaign} ({len(conv.turns)} turns) -> {path}")
    for turn in conv.turns:
        embedded = turn.retrieval_embedded
        print(
            f"\n turn {turn.index}  embedded={embedded}  "
            f"asset={turn.asset_identified!r}  chunks={len(turn.retrieved_meta)}"
        )
        print(f"   query: {(turn.retrieval_query or '')[:110]}")
        for rank, meta in enumerate(turn.retrieved_meta[:5]):
            if "error" in meta:
                print(f"   !! {meta['error']}")
                break
            print(
                f"   [{rank}] {str(meta.get('manufacturer'))[:22]:22} "
                f"{str(meta.get('model_number'))[:12]:12} "
                f"{str(meta.get('source_type'))[:16]:16} "
                f"sim={meta.get('similarity')}"
            )
        if args.check_params:
            for row in turn.param_support:
                mark = "OK  " if row["supported"] else "MISS"
                print(
                    f"   {mark} {row['token']} — "
                    f"{'in' if row['supported'] else 'NOT in'} the {row['n_chunks']} "
                    "retrieved chunk(s)"
                )
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
