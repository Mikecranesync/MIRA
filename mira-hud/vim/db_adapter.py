"""VIM database adapter — NeonDB integration for TM chunks.

Extends the existing knowledge_entries table with chunk_type and image_path
columns (additive migration — existing rows get defaults, no data loss).

Provides VIM-specific insert and recall functions that surface multimodal
metadata (chunk_type, image_path, table_type, severity) alongside the
standard content + embedding fields.

Usage:
    # Run schema migration (additive, reversible)
    doppler run --project factorylm --config prd -- \\
      python -m vim.db_adapter --migrate

    # Ingest parsed TM manifests into NeonDB
    doppler run --project factorylm --config prd -- \\
      python -m vim.db_adapter --ingest data/tm_manifests/

    # Test connection and schema
    doppler run --project factorylm --config prd -- \\
      python -m vim.db_adapter --test

    # Rollback migration (remove added columns)
    doppler run --project factorylm --config prd -- \\
      python -m vim.db_adapter --rollback
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import uuid
from pathlib import Path

import httpx

from .config import DBConfig

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("vim-db-adapter")


# ---------------------------------------------------------------------------
# Engine (lazy, reuses pattern from mira-ingest/db/neon.py)
# ---------------------------------------------------------------------------

_ENGINE = None


def _engine():
    """Get or create SQLAlchemy engine with NullPool."""
    global _ENGINE  # noqa: PLW0603
    if _ENGINE is not None:
        return _ENGINE

    from sqlalchemy import create_engine
    from sqlalchemy.pool import NullPool

    url = os.environ.get("NEON_DATABASE_URL")
    if not url:
        raise RuntimeError(
            "NEON_DATABASE_URL not set — run with: "
            "doppler run --project factorylm --config prd -- ..."
        )
    _ENGINE = create_engine(
        url,
        poolclass=NullPool,
        connect_args={"sslmode": "require"},
        pool_pre_ping=True,
    )
    return _ENGINE


# ---------------------------------------------------------------------------
# Schema migration
# ---------------------------------------------------------------------------

_MIGRATION_COLUMNS = [
    ("chunk_type", "TEXT DEFAULT 'text'"),
    ("image_path", "TEXT"),
]


def migrate_schema() -> bool:
    """Add chunk_type and image_path columns to knowledge_entries.

    Additive ALTER TABLE — existing rows get default values ('text' and NULL).
    Safe to run multiple times (checks if columns exist first).

    Returns True if migration was applied, False if already up-to-date.
    """
    from sqlalchemy import text

    applied = False
    with _engine().connect() as conn:
        for col_name, col_def in _MIGRATION_COLUMNS:
            # Check if column exists
            exists = conn.execute(
                text("""
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'knowledge_entries'
                      AND column_name = :col
                """),
                {"col": col_name},
            ).fetchone()

            if exists:
                logger.info("  Column '%s' already exists — skipping", col_name)
                continue

            logger.info("  Adding column '%s' (%s)", col_name, col_def)
            conn.execute(text(f"ALTER TABLE knowledge_entries ADD COLUMN {col_name} {col_def}"))
            applied = True

        if applied:
            conn.commit()
            logger.info("Migration applied successfully")
        else:
            logger.info("Schema already up-to-date — no changes needed")

    return applied


def rollback_schema() -> bool:
    """Remove chunk_type and image_path columns (reverse migration).

    Returns True if rollback was applied.
    """
    from sqlalchemy import text

    applied = False
    with _engine().connect() as conn:
        for col_name, _ in _MIGRATION_COLUMNS:
            exists = conn.execute(
                text("""
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'knowledge_entries'
                      AND column_name = :col
                """),
                {"col": col_name},
            ).fetchone()

            if not exists:
                logger.info("  Column '%s' does not exist — skipping", col_name)
                continue

            logger.info("  Dropping column '%s'", col_name)
            conn.execute(text(f"ALTER TABLE knowledge_entries DROP COLUMN {col_name}"))
            applied = True

        if applied:
            conn.commit()
            logger.info("Rollback applied successfully")
        else:
            logger.info("Nothing to rollback — columns don't exist")

    return applied


# ---------------------------------------------------------------------------
# Embedding via Ollama
# ---------------------------------------------------------------------------


def _embed_text(text_content: str, config: DBConfig | None = None) -> list[float] | None:
    """Embed text via Ollama nomic-embed-text:v1.5."""
    if config is None:
        config = DBConfig()

    try:
        resp = httpx.post(
            f"{config.ollama_base_url}/api/embeddings",
            json={"model": config.text_embed_model, "prompt": text_content},
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json()["embedding"]
    except Exception as e:
        logger.warning("Embedding failed: %s", e)
        return None


# ---------------------------------------------------------------------------
# Insert TM chunks
# ---------------------------------------------------------------------------


def vim_chunk_exists(tenant_id: str, tm_number: str, chunk_id: str) -> bool:
    """Check if a TM chunk has already been ingested (dedup guard).

    Uses composite key: tenant_id + source_url (tm_number) + metadata->chunk_id.
    """
    from sqlalchemy import text

    try:
        with _engine().connect() as conn:
            count = conn.execute(
                text("""
                    SELECT COUNT(*) FROM knowledge_entries
                    WHERE tenant_id = :tid
                      AND source_url = :tm
                      AND metadata->>'chunk_id' = :cid
                """),
                {"tid": tenant_id, "tm": tm_number, "cid": chunk_id},
            ).scalar()
        return (count or 0) > 0
    except Exception as e:
        logger.warning("Dedup check failed: %s", e)
        return False


def insert_vim_chunk(
    tenant_id: str,
    tm_number: str,
    chunk_id: str,
    content: str,
    embedding: list[float],
    chunk_type: str = "text",
    image_path: str | None = None,
    page_num: int | None = None,
    section: str | None = None,
    severity: str | None = None,
    table_type: str | None = None,
    headers: list[str] | None = None,
    adjacent_text: str | None = None,
) -> str:
    """Insert a single TM chunk into knowledge_entries.

    Returns the new row ID, or empty string on failure.
    """
    from sqlalchemy import text

    entry_id = str(uuid.uuid4())
    metadata = {
        "chunk_id": chunk_id,
        "page_num": page_num,
        "section": section,
        "tm_source": "vim_tm_parser",
    }
    # Add type-specific metadata
    if severity:
        metadata["severity"] = severity
    if table_type:
        metadata["table_type"] = table_type
    if headers:
        metadata["headers"] = headers
    if adjacent_text:
        metadata["adjacent_text"] = adjacent_text

    try:
        with _engine().connect() as conn:
            conn.execute(
                text("""
                    INSERT INTO knowledge_entries
                        (id, tenant_id, source_type, manufacturer, model_number,
                         content, embedding, source_url, source_page,
                         metadata, is_private, verified,
                         chunk_type, image_path)
                    VALUES
                        (:id, :tenant_id, :source_type, :manufacturer, :model_number,
                         :content, cast(:embedding AS vector), :source_url, :source_page,
                         cast(:metadata AS jsonb), false, false,
                         :chunk_type, :image_path)
                """),
                {
                    "id": entry_id,
                    "tenant_id": tenant_id,
                    "source_type": "military_tm",
                    "manufacturer": "US Military",
                    "model_number": tm_number,
                    "content": content,
                    "embedding": str(embedding),
                    "source_url": tm_number,
                    "source_page": page_num,
                    "metadata": json.dumps(metadata),
                    "chunk_type": chunk_type,
                    "image_path": image_path,
                },
            )
            conn.commit()
        return entry_id
    except Exception as e:
        logger.error("Insert failed for %s: %s", chunk_id, e)
        return ""


# ---------------------------------------------------------------------------
# Multimodal recall (enhanced)
# ---------------------------------------------------------------------------


def recall_vim_knowledge(
    embedding: list[float],
    tenant_id: str,
    limit: int = 5,
    chunk_types: list[str] | None = None,
) -> list[dict]:
    """pgvector cosine similarity search with multimodal metadata.

    Returns list of dicts with keys:
        content, manufacturer, model_number, equipment_type, source_type,
        chunk_type, image_path, metadata, similarity

    Optionally filters by chunk_type (e.g., ["text", "warning", "image"]).
    """
    from sqlalchemy import text

    try:
        # Build query with optional chunk_type filter
        type_filter = ""
        params = {"emb": str(embedding), "tid": tenant_id, "lim": limit}

        if chunk_types:
            placeholders = ", ".join(f":ct{i}" for i in range(len(chunk_types)))
            type_filter = f"AND chunk_type IN ({placeholders})"
            for i, ct in enumerate(chunk_types):
                params[f"ct{i}"] = ct

        query = f"""
            SELECT
                content,
                manufacturer,
                model_number,
                equipment_type,
                source_type,
                chunk_type,
                image_path,
                metadata,
                1 - (embedding <=> cast(:emb AS vector)) AS similarity
            FROM knowledge_entries
            WHERE tenant_id = :tid
              AND embedding IS NOT NULL
              {type_filter}
            ORDER BY embedding <=> cast(:emb AS vector)
            LIMIT :lim
        """

        with _engine().connect() as conn:
            rows = conn.execute(text(query), params).mappings().fetchall()

        results = []
        for r in rows:
            d = dict(r)
            # Parse metadata JSONB if it's a string
            if isinstance(d.get("metadata"), str):
                try:
                    d["metadata"] = json.loads(d["metadata"])
                except (json.JSONDecodeError, TypeError):
                    pass
            results.append(d)

        logger.info(
            "VIM_RECALL tenant=%s hits=%d types=%s",
            tenant_id,
            len(results),
            chunk_types or "all",
        )
        return results
    except Exception as e:
        logger.warning("VIM recall failed: %s", e)
        return []


# ---------------------------------------------------------------------------
# Manifest ingest pipeline
# ---------------------------------------------------------------------------


def ingest_manifest(manifest_path: Path, config: DBConfig | None = None) -> int:
    """Ingest a parsed TM manifest JSON into NeonDB.

    Reads manifest, embeds each chunk's content, inserts into knowledge_entries.
    Skips chunks that already exist (dedup by chunk_id).

    Returns number of chunks inserted.
    """
    if config is None:
        config = DBConfig()

    if not config.tenant_id:
        logger.error("MIRA_TENANT_ID not set — cannot ingest")
        return 0

    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    tm_number = data.get("tm_number", "UNKNOWN")
    chunks = data.get("chunks", [])

    logger.info("Ingesting %s (%d chunks)", tm_number, len(chunks))
    inserted = 0

    for chunk in chunks:
        chunk_id = chunk.get("chunk_id", "")
        content = chunk.get("content", "")
        chunk_type = chunk.get("chunk_type", "text")

        # Skip chunks with no meaningful content
        if not content or len(content) < 20:
            # Image chunks may have no content but have adjacent_text
            adj = chunk.get("adjacent_text", "")
            if adj:
                content = adj
            else:
                continue

        # Dedup check
        if vim_chunk_exists(config.tenant_id, tm_number, chunk_id):
            logger.debug("  Skipping duplicate: %s", chunk_id)
            continue

        # Embed
        embedding = _embed_text(content, config)
        if embedding is None:
            logger.warning("  Skipping (embed failed): %s", chunk_id)
            continue

        # Insert
        entry_id = insert_vim_chunk(
            tenant_id=config.tenant_id,
            tm_number=tm_number,
            chunk_id=chunk_id,
            content=content,
            embedding=embedding,
            chunk_type=chunk_type,
            image_path=chunk.get("image_path"),
            page_num=chunk.get("page_num"),
            section=chunk.get("section"),
            severity=chunk.get("severity"),
            table_type=chunk.get("table_type"),
            headers=chunk.get("headers"),
            adjacent_text=chunk.get("adjacent_text"),
        )

        if entry_id:
            inserted += 1
            logger.debug("  Inserted: %s → %s", chunk_id, entry_id)

    logger.info("Ingested %d / %d chunks from %s", inserted, len(chunks), tm_number)
    return inserted


def ingest_manifests_dir(manifests_dir: Path, config: DBConfig | None = None) -> int:
    """Ingest all manifest JSONs from a directory. Returns total chunks inserted."""
    if config is None:
        config = DBConfig()

    manifest_files = sorted(manifests_dir.glob("*.json"))
    if not manifest_files:
        logger.warning("No manifest files found in %s", manifests_dir)
        return 0

    total = 0
    for mf in manifest_files:
        total += ingest_manifest(mf, config)

    logger.info("Total ingested: %d chunks from %d manifests", total, len(manifest_files))
    return total


# ---------------------------------------------------------------------------
# Test / diagnostic
# ---------------------------------------------------------------------------


def test_connection() -> bool:
    """Test NeonDB connection and verify schema has VIM columns."""
    from sqlalchemy import text

    try:
        with _engine().connect() as conn:
            # Basic connectivity
            count = conn.execute(text("SELECT COUNT(*) FROM knowledge_entries")).scalar()
            logger.info("Connection OK — %d total knowledge_entries", count)

            # Check VIM columns exist
            for col_name, _ in _MIGRATION_COLUMNS:
                exists = conn.execute(
                    text("""
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'knowledge_entries'
                          AND column_name = :col
                    """),
                    {"col": col_name},
                ).fetchone()
                if exists:
                    logger.info("  Column '%s': present", col_name)
                else:
                    logger.warning("  Column '%s': MISSING — run --migrate", col_name)

            # Count VIM-specific entries
            vim_count = conn.execute(
                text("SELECT COUNT(*) FROM knowledge_entries WHERE source_type = 'military_tm'")
            ).scalar()
            logger.info("  VIM TM chunks: %d", vim_count)

        return True
    except Exception as e:
        logger.error("Connection test failed: %s", e)
        return False


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _build_cli_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m vim.db_adapter",
        description="VIM database adapter — NeonDB schema migration and TM ingest",
    )
    p.add_argument("--migrate", action="store_true", help="Run schema migration")
    p.add_argument("--rollback", action="store_true", help="Rollback schema migration")
    p.add_argument("--test", action="store_true", help="Test connection and schema")
    p.add_argument("--ingest", type=str, help="Ingest manifests from directory")
    p.add_argument("--ingest-file", type=str, help="Ingest a single manifest JSON file")
    return p


def main() -> None:
    args = _build_cli_parser().parse_args()
    config = DBConfig()

    if args.migrate:
        logger.info("=== Running VIM schema migration ===")
        migrate_schema()
        return

    if args.rollback:
        logger.info("=== Rolling back VIM schema migration ===")
        rollback_schema()
        return

    if args.test:
        logger.info("=== Testing NeonDB connection ===")
        test_connection()
        return

    if args.ingest:
        manifests_dir = Path(args.ingest)
        if not manifests_dir.exists():
            logger.error("Directory not found: %s", manifests_dir)
            return
        ingest_manifests_dir(manifests_dir, config)
        return

    if args.ingest_file:
        manifest_path = Path(args.ingest_file)
        if not manifest_path.exists():
            logger.error("File not found: %s", manifest_path)
            return
        ingest_manifest(manifest_path, config)
        return

    _build_cli_parser().print_help()


if __name__ == "__main__":
    main()
