#!/usr/bin/env python3
"""Backfill NULL `embedding` values in `knowledge_entries`.

SQL seeds (`tools/seeds/*.sql`) insert text-only rows — they have no `embedding`
column, so every seeded chunk lands with `embedding = NULL`. NULL-embedding rows
are invisible to the vector and product-name retrieval streams in
`mira-bots/shared/neon_recall.py` (`_product_search` filters `embedding IS NOT
NULL`), so they can only ever be surfaced by BM25/ILIKE — where the fully-embedded
OEM manuals out-rank them. This script closes that gap by embedding the dark rows
with the SAME model + dimension the query path uses.

Spec: docs/superpowers/specs/2026-06-17-retrieval-null-embedding-coverage-gap.md
Precedent: #1385 (an embedding gap silently degrading retrieval).

Embedding contract (MUST match the query path or cosine is meaningless):
  * model     = nomic-embed-text  (via Ollama at OLLAMA_BASE_URL)
  * dimension = 768  (knowledge_entries.embedding is vector(768))
The script asserts the returned dimension before writing.

Usage (env-scoped via Doppler — NEVER psql/point at prod from a code session;
prod runs through the gated seed/deploy dispatch):
  # dry run — count what WOULD be embedded, write nothing
  doppler run -p factorylm -c stg -- python tools/backfill_knowledge_embeddings.py --dry-run
  # real backfill on staging
  doppler run -p factorylm -c stg -- python tools/backfill_knowledge_embeddings.py
  # scope to a source_type / cap the batch
  doppler run -p factorylm -c stg -- python tools/backfill_knowledge_embeddings.py --source-type field-guide --limit 50

Idempotent: only touches rows where `embedding IS NULL`; a second run finds 0.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from dataclasses import asdict, dataclass

import httpx
from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("kb-embed-backfill")

EMBED_MODEL = os.environ.get("EMBED_TEXT_MODEL", "nomic-embed-text:latest")
OLLAMA_URL = os.environ.get("OLLAMA_BASE_URL", "")
EXPECTED_DIM = 768  # knowledge_entries.embedding is vector(768)

# Only ever fill a hole: the Hub's own embed pass (or another run) may write the
# same row between our SELECT and this UPDATE, and its vector must win.
UPDATE_SQL = (
    "UPDATE knowledge_entries SET embedding = cast(:emb AS vector) "
    "WHERE id = :id AND embedding IS NULL"
)


class DimensionMismatch(ValueError):
    """The embedder answered with the wrong vector size — wrong model; stop the run."""


class PermissionDenied(RuntimeError):
    """The database role cannot UPDATE knowledge_entries — stop the run."""


@dataclass
class BackfillResult:
    candidates: int = 0
    embedded: int = 0  # rows this run actually wrote (UPDATE rowcount)
    skipped_already_embedded: int = 0  # another writer filled the row first
    skipped_empty: int = 0
    failed: int = 0
    stop_reason: str | None = None

    @property
    def exit_code(self) -> int:
        return 1 if self.failed or self.stop_reason else 0


def _is_permission_error(exc: Exception) -> bool:
    text_ = str(exc).lower()
    return isinstance(exc, PermissionDenied) or "permission denied" in text_ or "42501" in text_


def backfill_rows(conn, rows, embed_fn, batch: int) -> BackfillResult:
    """Embed and write `rows` ((id, content) pairs), committing every `batch` rows so a
    rerun resumes where this one stopped. Stops early — and reports why — on a
    dimension mismatch, a permission error, or `batch` consecutive embed failures
    (the embedder is unreachable). Never overwrites an existing vector."""
    r = BackfillResult(candidates=len(rows))
    consecutive_failures = 0
    # Counts for the open (uncommitted) batch. They reach `r` only on COMMIT, so a
    # rolled-back batch is never reported as embedded.
    pending_written = pending_skipped = 0

    def commit() -> None:
        nonlocal pending_written, pending_skipped
        conn.commit()
        r.embedded += pending_written
        r.skipped_already_embedded += pending_skipped
        pending_written = pending_skipped = 0

    for i, (row_id, content) in enumerate(rows, 1):
        if not content or not content.strip():
            r.skipped_empty += 1
            continue
        try:
            vec = embed_fn(content)
        except DimensionMismatch as exc:
            r.failed += 1
            r.stop_reason = "dimension_mismatch"
            logger.error("  stop: %s", exc)
            break
        except Exception as exc:  # noqa: BLE001 - count it; stop if the embedder is down
            r.failed += 1
            consecutive_failures += 1
            logger.warning("  embed failed for %s: %s", row_id, exc)
            if consecutive_failures >= batch:
                r.stop_reason = "embedder_unreachable"
                logger.error("  stop: %d consecutive embed failures", consecutive_failures)
                break
            continue
        consecutive_failures = 0
        try:
            written = conn.execute(text(UPDATE_SQL), {"emb": str(vec), "id": row_id}).rowcount
        except Exception as exc:  # noqa: BLE001 - classify, then stop or re-raise
            if _is_permission_error(exc):
                # The error aborted the transaction: the open batch is lost. Roll it
                # back explicitly and count its rows, plus the denied one, as failed.
                conn.rollback()
                r.failed += pending_written + 1
                pending_written = pending_skipped = 0
                r.stop_reason = "permission_denied"
                logger.error("  stop: %s", exc)
                return r
            raise
        if written:
            pending_written += 1
        else:
            pending_skipped += 1
        if i % batch == 0:
            commit()
            logger.info("  committed: embedded=%d of %d", r.embedded, len(rows))
    commit()
    return r


def embed(client: httpx.Client, content: str) -> list[float]:
    """Embed one chunk; assert the dimension matches the column."""
    resp = client.post(
        f"{OLLAMA_URL}/api/embeddings",
        json={"model": EMBED_MODEL, "prompt": content},
    )
    resp.raise_for_status()
    vec = resp.json().get("embedding") or []
    if len(vec) != EXPECTED_DIM:
        raise DimensionMismatch(
            f"embedder returned dim={len(vec)} but knowledge_entries.embedding is "
            f"vector({EXPECTED_DIM}) — wrong model ({EMBED_MODEL})? Refusing to write "
            "a dimension-mismatched vector (cosine would be meaningless)."
        )
    return vec


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true", help="count only; write nothing")
    ap.add_argument("--limit", type=int, default=0, help="max rows to embed (0 = all)")
    ap.add_argument("--source-type", default="", help="restrict to one source_type")
    ap.add_argument("--batch", type=int, default=20, help="commit every N rows")
    args = ap.parse_args()

    url = os.environ.get("NEON_DATABASE_URL")
    if not url:
        logger.error(
            "NEON_DATABASE_URL not set — run via `doppler run -p factorylm -c <env> -- ...`"
        )
        return 2
    if not os.environ.get("OLLAMA_BASE_URL"):
        logger.error("OLLAMA_BASE_URL not set — refusing to run without a reachable embedder")
        return 2

    where = "embedding IS NULL"
    params: dict[str, object] = {}
    if args.source_type:
        where += " AND source_type = :st"
        params["st"] = args.source_type
    limit_sql = ""
    if args.limit:
        limit_sql = " LIMIT :lim"
        params["lim"] = args.limit

    engine = create_engine(url, poolclass=NullPool, connect_args={"sslmode": "require"})

    # Report the gap before doing anything (observability + sanity).
    with engine.connect() as conn:
        total_null = conn.execute(
            text(f"SELECT count(*) FROM knowledge_entries WHERE {where}"), params
        ).scalar_one()
        by_type = conn.execute(
            text(
                "SELECT source_type, count(*) n FROM knowledge_entries "
                "WHERE embedding IS NULL GROUP BY source_type ORDER BY n DESC"
            )
        ).fetchall()
    logger.info(
        "NULL-embedding rows%s: %d",
        f" (source_type={args.source_type})" if args.source_type else "",
        total_null,
    )
    for st, n in by_type:
        logger.info("  %-22s %d", repr(st), n)

    if args.dry_run:
        logger.info("[dry-run] would embed %d row(s) with %s — no writes.", total_null, EMBED_MODEL)
        return 0
    if total_null == 0:
        logger.info("Nothing to do — no NULL-embedding rows match.")
        return 0

    rows = []
    with engine.connect() as conn:
        rows = conn.execute(
            text(f"SELECT id, content FROM knowledge_entries WHERE {where}{limit_sql}"), params
        ).fetchall()

    with httpx.Client(timeout=30) as client, engine.connect() as conn:
        result = backfill_rows(conn, rows, lambda content: embed(client, content), args.batch)
        if result.embedded:
            # IVFFlat recall can degrade after a bulk insert of vectors — refresh stats.
            conn.execute(text("ANALYZE knowledge_entries"))
            conn.commit()

    # One machine-readable line: what was written, what was skipped, what failed, why it stopped.
    print("BACKFILL_RESULT " + json.dumps({**asdict(result), "model": EMBED_MODEL}), flush=True)
    return result.exit_code


if __name__ == "__main__":
    sys.exit(main())
