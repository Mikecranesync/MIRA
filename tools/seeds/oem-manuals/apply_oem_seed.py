"""OEM-manual KB seed applier — garage devices (Micro820 / GS10 / RS-485).

Two phases:
  1. Backfill embeddings for existing garage-device chunks whose `embedding` is NULL
     (28 rows identified by 2026-05-15 audit — already in NeonDB, just RAG-invisible).
  2. Insert new chunks from `chunks.jsonl` targeting the 5 specific gaps the audit
     found, with nomic-embed-text embeddings.

Idempotent: re-running skips already-embedded rows and dedupes new chunks by
`metadata.chunk_key`.

Usage:
    doppler run -p factorylm -c prd -- python3 tools/seeds/oem-manuals/apply_oem_seed.py \\
        [--dry-run] [--skip-backfill] [--skip-new] [--ollama-url URL]

Env vars (required, all in Doppler factorylm/prd):
    NEON_DATABASE_URL    Postgres connection string with sslmode=require
    MIRA_TENANT_ID       Shared tenant UUID (defaults to known garage tenant)

Embedding endpoint defaults to Bravo: http://192.168.1.11:11434 — override with
--ollama-url if running from a different node. Model: nomic-embed-text (768-dim,
matches the existing vector column).
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import uuid
from pathlib import Path
from typing import Any

import httpx
from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("oem-seed")

DEFAULT_TENANT = "78917b56-f85f-43bb-9a08-1bb98a6cd6c3"
DEFAULT_OLLAMA = "http://192.168.1.11:11434"
EMBED_MODEL = "nomic-embed-text"
EMBED_DIM = 768
DEFAULT_CHUNKS_PATH = Path(__file__).parent / "chunks.jsonl"


def neon_engine() -> Any:
    url = os.environ.get("NEON_DATABASE_URL")
    if not url:
        raise SystemExit("NEON_DATABASE_URL not set — run via `doppler run -p factorylm -c prd --`")
    return create_engine(url, poolclass=NullPool, connect_args={"sslmode": "require"})


def embed_one(client: httpx.Client, base_url: str, text_in: str) -> list[float]:
    resp = client.post(
        f"{base_url}/api/embeddings",
        json={"model": EMBED_MODEL, "prompt": text_in},
        timeout=60,
    )
    resp.raise_for_status()
    vec = resp.json()["embedding"]
    if len(vec) != EMBED_DIM:
        raise ValueError(f"embedding dim {len(vec)} != expected {EMBED_DIM}")
    return vec


def backfill_missing_embeddings(
    eng: Any,
    client: httpx.Client,
    ollama_url: str,
    tenant_id: str,
    dry_run: bool,
) -> int:
    """Step 1: find garage-device chunks with NULL embedding, embed them in place."""
    log.info("Step 1: scanning for garage-device chunks with NULL embedding…")
    with eng.connect() as c:
        rows = c.execute(
            text(
                """
                SELECT id, manufacturer, model_number, content
                FROM knowledge_entries
                WHERE tenant_id = :tid
                  AND embedding IS NULL
                  AND (
                      (manufacturer ILIKE '%automationdirect%' AND model_number ILIKE 'GS1%') OR
                      (manufacturer ILIKE '%automation direct%' AND model_number ILIKE 'GS1%') OR
                      (manufacturer ILIKE '%allen-bradley%' AND model_number ILIKE '%Micro820%') OR
                      source_type ILIKE '%integration_guide%' OR
                      (source_type ILIKE '%field-guide%' AND
                       (content ILIKE '%GS10%' OR content ILIKE '%GS11%' OR
                        content ILIKE '%Micro820%' OR content ILIKE '%RS-485%'))
                  )
                """
            ),
            {"tid": tenant_id},
        ).fetchall()

    log.info("  found %d unembedded garage-device chunks", len(rows))
    if dry_run:
        for r in rows:
            log.info(
                "  [DRY] would embed id=%s mfr=%s model=%s preview=%r",
                str(r[0])[:8],
                r[1],
                r[2],
                (r[3] or "")[:60],
            )
        return len(rows)

    updated = 0
    for r in rows:
        rid, mfr, model, body = r
        if not body or not body.strip():
            log.warning("  skipping empty chunk id=%s", rid)
            continue
        try:
            vec = embed_one(client, ollama_url, body)
        except Exception as e:
            log.error("  embed failed for id=%s: %s", rid, e)
            continue
        with eng.connect() as c:
            c.execute(
                text(
                    "UPDATE knowledge_entries SET embedding = cast(:emb AS vector) WHERE id = :id"
                ),
                {"id": rid, "emb": str(vec)},
            )
            c.commit()
        updated += 1
        log.info("  embedded id=%s mfr=%s model=%s", str(rid)[:8], mfr, model)
    log.info("Step 1 complete: %d rows backfilled", updated)
    return updated


def chunk_exists(eng: Any, tenant_id: str, chunk_key: str) -> bool:
    with eng.connect() as c:
        row = c.execute(
            text(
                "SELECT 1 FROM knowledge_entries "
                "WHERE tenant_id = :tid AND metadata->>'chunk_key' = :k LIMIT 1"
            ),
            {"tid": tenant_id, "k": chunk_key},
        ).fetchone()
    return row is not None


def insert_new_chunks(
    eng: Any,
    client: httpx.Client,
    ollama_url: str,
    tenant_id: str,
    chunks: list[dict],
    dry_run: bool,
) -> tuple[int, int]:
    log.info("Step 2: inserting %d new chunks…", len(chunks))
    inserted = 0
    skipped = 0
    for i, ch in enumerate(chunks):
        key = ch.get("chunk_key")
        if not key:
            log.error("  chunk %d missing chunk_key — skipping", i)
            skipped += 1
            continue
        if chunk_exists(eng, tenant_id, key):
            log.info("  [SKIP] chunk_key=%s already in DB", key)
            skipped += 1
            continue
        body = ch["content"]
        if dry_run:
            log.info(
                "  [DRY] would insert chunk_key=%s mfr=%s model=%s len=%d",
                key,
                ch.get("manufacturer"),
                ch.get("model_number"),
                len(body),
            )
            inserted += 1
            continue
        try:
            vec = embed_one(client, ollama_url, body)
        except Exception as e:
            log.error("  embed failed for chunk_key=%s: %s", key, e)
            skipped += 1
            continue
        metadata = dict(ch.get("metadata") or {})
        metadata["chunk_key"] = key
        metadata["source_url"] = ch.get("source_url")
        metadata["chunk_index"] = i
        with eng.connect() as c:
            c.execute(
                text(
                    """
                    INSERT INTO knowledge_entries
                      (id, tenant_id, source_type, manufacturer, model_number,
                       content, embedding, source_url, source_page, metadata,
                       is_private, verified, chunk_type, created_at)
                    VALUES
                      (:id, :tid, :src, :mfr, :mdl,
                       :content, cast(:emb AS vector), :url, :page, cast(:meta AS jsonb),
                       false, true, :ctype, NOW())
                    """
                ),
                {
                    "id": str(uuid.uuid4()),
                    "tid": tenant_id,
                    "src": ch.get("source_type", "oem_manual"),
                    "mfr": ch.get("manufacturer"),
                    "mdl": ch.get("model_number"),
                    "content": body,
                    "emb": str(vec),
                    "url": ch.get("source_url"),
                    "page": i,
                    "meta": json.dumps(metadata),
                    "ctype": ch.get("chunk_type", "manual_text"),
                },
            )
            c.commit()
        inserted += 1
        log.info("  inserted chunk_key=%s", key)
    log.info("Step 2 complete: %d inserted, %d skipped", inserted, skipped)
    return inserted, skipped


def load_chunks(chunks_path: Path = DEFAULT_CHUNKS_PATH) -> list[dict]:
    if not chunks_path.exists():
        raise SystemExit(f"chunks file missing: {chunks_path}")
    chunks = []
    with chunks_path.open(encoding="utf-8") as f:
        for ln, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                chunks.append(json.loads(line))
            except json.JSONDecodeError as e:
                raise SystemExit(f"chunks.jsonl line {ln} parse error: {e}")
    return chunks


def main() -> int:
    ap = argparse.ArgumentParser(description="OEM-manual KB seed applier")
    ap.add_argument(
        "--dry-run", action="store_true", help="report actions without DB writes / embed calls"
    )
    ap.add_argument("--skip-backfill", action="store_true", help="skip Step 1 (embedding backfill)")
    ap.add_argument("--skip-new", action="store_true", help="skip Step 2 (new chunk insert)")
    ap.add_argument(
        "--ollama-url",
        default=os.environ.get("OLLAMA_URL", DEFAULT_OLLAMA),
        help="Ollama base URL (default: Bravo LAN)",
    )
    ap.add_argument("--tenant-id", default=os.environ.get("MIRA_TENANT_ID", DEFAULT_TENANT))
    ap.add_argument(
        "--chunks",
        default=str(DEFAULT_CHUNKS_PATH),
        help="path to chunks.jsonl (default: this script's directory)",
    )
    args = ap.parse_args()

    log.info("ollama: %s  tenant: %s  dry_run: %s", args.ollama_url, args.tenant_id, args.dry_run)

    chunks_path = Path(args.chunks)
    chunks = load_chunks(chunks_path)
    log.info("loaded %d chunks from %s", len(chunks), chunks_path)

    if not args.dry_run:
        try:
            ping = httpx.get(f"{args.ollama_url}/api/tags", timeout=5)
            ping.raise_for_status()
        except Exception as e:
            log.error("Ollama unreachable at %s: %s", args.ollama_url, e)
            log.error(
                "Run this script from a node that can reach Bravo "
                "(LAN 192.168.1.11) or set --ollama-url to a reachable Ollama."
            )
            return 2

    eng = neon_engine()
    with httpx.Client() as client:
        backfilled = 0
        if not args.skip_backfill:
            backfilled = backfill_missing_embeddings(
                eng, client, args.ollama_url, args.tenant_id, args.dry_run
            )
        inserted = 0
        skipped = 0
        if not args.skip_new:
            inserted, skipped = insert_new_chunks(
                eng, client, args.ollama_url, args.tenant_id, chunks, args.dry_run
            )

    log.info("DONE. backfilled=%d  new_inserted=%d  new_skipped=%d", backfilled, inserted, skipped)
    return 0


if __name__ == "__main__":
    sys.exit(main())
