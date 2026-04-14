#!/usr/bin/env python3
"""Seed the 3 KB reference documents for benchmark gaps (#80).

Ingests docs/kb-reference/*.md directly into the NeonDB knowledge_entries
table so the benchmark questions on motor efficiency, shaft voltage, and
over-greasing can be answered from retrieval, not just training data.

Each document is chunked into ~500-token sections and embedded via
Ollama nomic-embed-text:latest (same model as KB).

Usage:
    doppler run --project factorylm --config prd -- \\
      uv run --with sqlalchemy --with psycopg2-binary --with httpx \\
      python mira-core/scripts/seed_kb_gaps.py [--dry-run]
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
import uuid
from pathlib import Path

import httpx

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("seed_kb_gaps")

NEON_DATABASE_URL = os.environ.get("NEON_DATABASE_URL")
MIRA_TENANT_ID = os.environ.get("MIRA_TENANT_ID")
OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://host.docker.internal:11434")
EMBED_MODEL = os.environ.get("EMBED_TEXT_MODEL", "nomic-embed-text:latest")

# Repo root: mira-core/scripts/ → up 2
REPO_ROOT = Path(__file__).parent.parent.parent
REFERENCE_DIR = REPO_ROOT / "docs" / "kb-reference"

# Each doc has metadata used for retrieval tagging
DOCS: list[dict] = [
    {
        "filename": "motor-efficiency-nema-premium.md",
        "equipment_type": "motor",
        "topic": "motor efficiency",
        "manufacturer": "NEMA",
        "model_number": "MG1 reference",
        "source_url": "docs/kb-reference/motor-efficiency-nema-premium.md",
    },
    {
        "filename": "shaft-voltage-vfd-bearing-currents.md",
        "equipment_type": "motor",
        "topic": "shaft voltage bearing currents",
        "manufacturer": "Aegis",
        "model_number": "Shaft Grounding Ring Technical Guide",
        "source_url": "docs/kb-reference/shaft-voltage-vfd-bearing-currents.md",
    },
    {
        "filename": "motor-bearing-greasing.md",
        "equipment_type": "motor",
        "topic": "bearing lubrication greasing",
        "manufacturer": "SKF",
        "model_number": "Bearing Maintenance Handbook",
        "source_url": "docs/kb-reference/motor-bearing-greasing.md",
    },
]


def chunk_markdown(text: str, max_chars: int = 2000) -> list[str]:
    """Split markdown text into chunks of ≤max_chars, preserving section headers.

    Splits on "## " section boundaries first. If any section exceeds max_chars,
    splits further on paragraphs.
    """
    sections: list[str] = []
    current: list[str] = []

    for line in text.splitlines():
        if line.startswith("## ") and current:
            sections.append("\n".join(current).strip())
            current = [line]
        else:
            current.append(line)
    if current:
        sections.append("\n".join(current).strip())

    # Further split any section that exceeds max_chars
    chunks: list[str] = []
    for sec in sections:
        if len(sec) <= max_chars:
            chunks.append(sec)
            continue
        paras = sec.split("\n\n")
        buf: list[str] = []
        buf_len = 0
        for p in paras:
            if buf_len + len(p) + 2 > max_chars and buf:
                chunks.append("\n\n".join(buf))
                buf = [p]
                buf_len = len(p)
            else:
                buf.append(p)
                buf_len += len(p) + 2
        if buf:
            chunks.append("\n\n".join(buf))

    return [c for c in chunks if len(c) > 50]  # drop trivial fragments


def embed_text(text: str) -> list[float] | None:
    """Embed via Ollama nomic-embed-text. Returns None on failure."""
    try:
        resp = httpx.post(
            f"{OLLAMA_BASE_URL}/api/embeddings",
            json={"model": EMBED_MODEL, "prompt": text},
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json()["embedding"]
    except Exception as e:
        log.warning("Ollama embed failed: %s", e)
        return None


def _insert_chunk(conn, text_fn, tenant_id: str, content: str,
                  embedding: list[float], meta: dict, chunk_index: int) -> bool:
    """Insert one knowledge_entry row."""
    try:
        conn.execute(text_fn(
            "INSERT INTO knowledge_entries "
            "(id, tenant_id, source_type, manufacturer, model_number, equipment_type, "
            " content, embedding, source_url, source_page, metadata, is_private, "
            " verified, chunk_type, created_at) "
            "VALUES (:id, :tid, :stype, :mfr, :model, :eqt, "
            "        :content, cast(:emb AS vector), :url, :page, cast(:meta AS jsonb), "
            "        false, true, 'reference', now())"
        ), {
            "id": str(uuid.uuid4()),
            "tid": tenant_id,
            "stype": "reference_guide",
            "mfr": meta.get("manufacturer", ""),
            "model": meta.get("model_number", ""),
            "eqt": meta.get("equipment_type", ""),
            "content": content,
            "emb": str(embedding),
            "url": meta.get("source_url", ""),
            "page": chunk_index,
            "meta": "{}",
        })
        return True
    except Exception as e:
        log.warning("Insert failed for chunk %d of %s: %s",
                    chunk_index, meta.get("filename", "?"), e)
        return False


def main() -> None:
    from sqlalchemy import create_engine, text
    from sqlalchemy.pool import NullPool

    parser = argparse.ArgumentParser(description="Seed KB gaps for benchmark questions")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print chunks without inserting")
    args = parser.parse_args()

    if not all([NEON_DATABASE_URL, MIRA_TENANT_ID]):
        sys.exit("ERROR: NEON_DATABASE_URL and MIRA_TENANT_ID required")

    engine = None
    if not args.dry_run:
        engine = create_engine(
            NEON_DATABASE_URL, poolclass=NullPool,
            connect_args={"sslmode": "require"}, pool_pre_ping=True,
        )

    total_chunks = 0
    inserted = 0

    for doc_meta in DOCS:
        path = REFERENCE_DIR / doc_meta["filename"]
        if not path.exists():
            log.warning("Missing reference doc: %s", path)
            continue

        text_content = path.read_text()
        chunks = chunk_markdown(text_content)
        log.info("%s: %d chunks", doc_meta["filename"], len(chunks))
        total_chunks += len(chunks)

        if args.dry_run:
            for i, chunk in enumerate(chunks):
                first_line = chunk.split("\n", 1)[0][:80]
                log.info("  [%d] %d chars — %s", i, len(chunk), first_line)
            continue

        with engine.connect() as conn:
            for i, chunk in enumerate(chunks):
                emb = embed_text(chunk)
                if not emb:
                    log.warning("  Skipping chunk %d — embed failed", i)
                    continue
                if _insert_chunk(conn, text, MIRA_TENANT_ID, chunk, emb, doc_meta, i):
                    inserted += 1
            conn.commit()

    if args.dry_run:
        log.info("Dry run complete — %d chunks across %d docs", total_chunks, len(DOCS))
    else:
        log.info("Seeding complete — %d/%d chunks inserted", inserted, total_chunks)


if __name__ == "__main__":
    main()
