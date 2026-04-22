"""NeonDB connection layer for MIRA.

Uses NullPool so Neon's PgBouncer handles connection pooling.
Read-only lookups and manual ingest writes both live here.
"""

from __future__ import annotations

import json
import os
import uuid
from typing import Any

from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

from . import data_types as _data_types


def _engine():
    url = os.environ.get("NEON_DATABASE_URL")
    if not url:
        raise RuntimeError("NEON_DATABASE_URL not set")
    return create_engine(
        url,
        poolclass=NullPool,
        connect_args={"sslmode": "require"},
        pool_pre_ping=True,
    )


def get_tenant(tenant_id: str) -> dict[str, Any] | None:
    with _engine().connect() as conn:
        row = (
            conn.execute(
                text("SELECT * FROM tenants WHERE id = :id"),
                {"id": tenant_id},
            )
            .mappings()
            .fetchone()
        )
    return dict(row) if row else None


def get_tier_limits(tier: str) -> dict[str, Any] | None:
    with _engine().connect() as conn:
        row = (
            conn.execute(
                text("SELECT * FROM tier_limits WHERE tier = :tier"),
                {"tier": tier},
            )
            .mappings()
            .fetchone()
        )
    return dict(row) if row else None


def recall_knowledge(
    embedding: list[float],
    tenant_id: str,
    limit: int = 5,
    *,
    isa95_prefix: str | None = None,
    data_types: list[str] | None = None,
) -> list[dict[str, Any]]:
    """pgvector cosine similarity search over knowledge_entries.

    Optional filters (vision doc Problem 1):
      isa95_prefix — scope to an ISA-95 subtree (e.g. 'Plant/Line2/').
      data_types   — one of data_types.ALL values; multiple OK.
    """
    clauses = ["tenant_id = :tid", "embedding IS NOT NULL"]
    params: dict[str, Any] = {
        "emb": str(embedding),
        "tid": tenant_id,
        "lim": limit,
    }
    if isa95_prefix is not None:
        clauses.append("isa95_path LIKE :prefix || '%'")
        params["prefix"] = isa95_prefix
    if data_types:
        clauses.append("data_type = ANY(:dtypes)")
        params["dtypes"] = list(data_types)
    where = " AND ".join(clauses)
    sql = f"""
        SELECT
            content,
            manufacturer,
            model_number,
            equipment_type,
            source_type,
            isa95_path,
            equipment_id,
            data_type,
            metadata,
            1 - (embedding <=> cast(:emb AS vector)) AS similarity
        FROM knowledge_entries
        WHERE {where}
        ORDER BY embedding <=> cast(:emb AS vector)
        LIMIT :lim
    """
    with _engine().connect() as conn:
        rows = conn.execute(text(sql), params).mappings().fetchall()
    return [dict(r) for r in rows]


def recall_by_image(
    image_vector: list[float], tenant_id: str, limit: int = 5
) -> list[dict[str, Any]]:
    """pgvector cosine similarity search over image_embedding column."""
    with _engine().connect() as conn:
        rows = (
            conn.execute(
                text("""
                SELECT
                    content,
                    manufacturer,
                    model_number,
                    equipment_type,
                    source_type,
                    metadata,
                    1 - (image_embedding <=> cast(:emb AS vector)) AS similarity
                FROM knowledge_entries
                WHERE tenant_id = :tid
                  AND image_embedding IS NOT NULL
                ORDER BY image_embedding <=> cast(:emb AS vector)
                LIMIT :lim
            """),
                {"emb": str(image_vector), "tid": tenant_id, "lim": limit},
            )
            .mappings()
            .fetchall()
        )
    return [dict(r) for r in rows]


def ensure_image_embedding_column() -> None:
    """Additive migration: add image_embedding vector(768) column if absent."""
    try:
        with _engine().connect() as conn:
            conn.execute(
                text(
                    "ALTER TABLE knowledge_entries "
                    "ADD COLUMN IF NOT EXISTS image_embedding vector(768)"
                )
            )
            conn.commit()
    except Exception as exc:
        import logging

        logging.getLogger("mira-ingest").warning(
            "image_embedding column migration failed (non-fatal): %s", exc
        )


def ensure_knowledge_hierarchy_columns() -> None:
    """Additive migration: ISA-95 hierarchy columns (vision doc Problem 1).

    Adds isa95_path, equipment_id, data_type to knowledge_entries and
    creates btree indexes for (tenant_id, isa95_path) prefix scans and
    (tenant_id, data_type) exact match. Idempotent.
    """
    statements = [
        "ALTER TABLE knowledge_entries ADD COLUMN IF NOT EXISTS isa95_path TEXT",
        "ALTER TABLE knowledge_entries ADD COLUMN IF NOT EXISTS equipment_id TEXT",
        "ALTER TABLE knowledge_entries "
        "ADD COLUMN IF NOT EXISTS data_type TEXT NOT NULL DEFAULT 'manual'",
        "CREATE INDEX IF NOT EXISTS idx_knowledge_entries_isa95_path "
        "ON knowledge_entries (tenant_id, isa95_path text_pattern_ops)",
        "CREATE INDEX IF NOT EXISTS idx_knowledge_entries_data_type "
        "ON knowledge_entries (tenant_id, data_type)",
    ]
    try:
        with _engine().connect() as conn:
            for stmt in statements:
                conn.execute(text(stmt))
            conn.commit()
    except Exception as exc:
        import logging

        logging.getLogger("mira-ingest").warning(
            "knowledge hierarchy migration failed (non-fatal): %s", exc
        )


def check_tier_limit(tenant_id: str) -> tuple[bool, str]:
    """Check if tenant is within their tier's daily request limit.

    Returns (allowed, reason).
    Returns (True, '') if no limit is configured or NeonDB is unavailable.
    Wire into photo ingest endpoint — return HTTP 429 if not allowed.
    """
    try:
        tenant = get_tenant(tenant_id)
        if not tenant:
            return (True, "")  # unknown tenant — allow, log elsewhere

        tier = tenant.get("tier", "free")
        limits = get_tier_limits(tier)
        if not limits:
            return (True, "")  # no limits configured for this tier

        daily_limit = limits.get("daily_requests")
        if not daily_limit:
            return (True, "")

        with _engine().connect() as conn:
            today_count = (
                conn.execute(
                    text("""
                SELECT COUNT(*) FROM knowledge_entries
                WHERE tenant_id = :tid
                  AND created_at >= CURRENT_DATE
            """),
                    {"tid": tenant_id},
                ).scalar()
                or 0
            )

        if today_count >= daily_limit:
            return (False, f"Daily limit of {daily_limit} requests reached for tier '{tier}'")
        return (True, "")
    except Exception:
        return (True, "")  # fail open — never block on DB errors


def health_check() -> dict[str, Any]:
    """Return NeonDB status + key row counts."""
    try:
        with _engine().connect() as conn:
            tenant_count = conn.execute(text("SELECT COUNT(*) FROM tenants")).scalar()
            ke_count = conn.execute(text("SELECT COUNT(*) FROM knowledge_entries")).scalar()
        return {"status": "ok", "tenant_count": tenant_count, "knowledge_entries": ke_count}
    except Exception as exc:
        return {"status": "error", "detail": str(exc)}


# ---------------------------------------------------------------------------
# Manual ingest helpers (write path — used by mira-core/scripts/ingest_manuals.py)
# ---------------------------------------------------------------------------


def get_pending_urls() -> list[dict[str, Any]]:
    """Return all URLs queued for ingest from the three source tables.

    Returns a list of dicts with keys:
        source_table, row_id, url, manufacturer, model, title
    """
    results: list[dict[str, Any]] = []
    with _engine().connect() as conn:
        # source_fingerprints: atoms_created = 0, skip example.com sentinel
        rows = (
            conn.execute(
                text(
                    "SELECT id, url, source_type FROM source_fingerprints "
                    "WHERE atoms_created = 0 AND url NOT LIKE 'https://example.com%'"
                )
            )
            .mappings()
            .fetchall()
        )
        for r in rows:
            results.append(
                {
                    "source_table": "source_fingerprints",
                    "row_id": r["id"],
                    "url": r["url"],
                    "source_type": r["source_type"],
                    "manufacturer": None,
                    "model": None,
                    "title": None,
                }
            )

        # manual_cache: pdf_stored = false
        rows = (
            conn.execute(
                text(
                    "SELECT id, manual_url, manufacturer, model, manual_title "
                    "FROM manual_cache WHERE pdf_stored = false AND manual_url IS NOT NULL"
                )
            )
            .mappings()
            .fetchall()
        )
        for r in rows:
            url = r["manual_url"]
            source_type = "pdf" if url.lower().endswith(".pdf") else "web"
            results.append(
                {
                    "source_table": "manual_cache",
                    "row_id": r["id"],
                    "url": url,
                    "source_type": source_type,
                    "manufacturer": r["manufacturer"],
                    "model": r["model"],
                    "title": r["manual_title"],
                }
            )

        # manuals: is_verified = false, file_url present
        rows = (
            conn.execute(
                text(
                    "SELECT id, file_url, manufacturer, model_number, title "
                    "FROM manuals WHERE is_verified = false AND file_url IS NOT NULL"
                )
            )
            .mappings()
            .fetchall()
        )
        for r in rows:
            url = r["file_url"]
            source_type = "pdf" if url.lower().endswith(".pdf") else "web"
            results.append(
                {
                    "source_table": "manuals",
                    "row_id": str(r["id"]),
                    "url": url,
                    "source_type": source_type,
                    "manufacturer": r["manufacturer"],
                    "model": r["model_number"],
                    "title": r["title"],
                }
            )

    return results


def knowledge_entry_exists(tenant_id: str, source_url: str, chunk_index: int) -> bool:
    """Check if a chunk has already been ingested (dedup guard)."""
    with _engine().connect() as conn:
        count = conn.execute(
            text(
                "SELECT COUNT(*) FROM knowledge_entries "
                "WHERE tenant_id = :tid "
                "AND source_url = :url "
                "AND source_page = :chunk"
            ),
            {"tid": tenant_id, "url": source_url, "chunk": chunk_index},
        ).scalar()
    return (count or 0) > 0


def insert_knowledge_entry(
    tenant_id: str,
    content: str,
    embedding: list[float],
    manufacturer: str | None,
    model_number: str | None,
    source_url: str,
    chunk_index: int,
    page_num: int | None,
    section: str | None,
    source_type: str = "manual",
    chunk_type: str = "text",
    *,
    isa95_path: str | None = None,
    equipment_id: str | None = None,
    data_type: str = "manual",
) -> str:
    """Insert one chunk into knowledge_entries. Returns the new row id."""
    _data_types.validate(data_type)
    entry_id = str(uuid.uuid4())
    meta = {
        "source_url": source_url,
        "chunk_index": chunk_index,
        "page_num": page_num,
        "section": section,
        "chunk_type": chunk_type,
    }
    with _engine().connect() as conn:
        conn.execute(
            text("""
            INSERT INTO knowledge_entries
                (id, tenant_id, source_type, manufacturer, model_number,
                 content, embedding, source_url, source_page, metadata,
                 is_private, verified, chunk_type,
                 isa95_path, equipment_id, data_type)
            VALUES
                (:id, :tenant_id, :source_type, :manufacturer, :model_number,
                 :content, cast(:embedding AS vector), :source_url, :source_page, cast(:metadata AS jsonb),
                 false, false, :chunk_type,
                 :isa95_path, :equipment_id, :data_type)
        """),
            {
                "id": entry_id,
                "tenant_id": tenant_id,
                "source_type": source_type,
                "manufacturer": manufacturer,
                "model_number": model_number,
                "content": content,
                "embedding": str(embedding),
                "source_url": source_url,
                "source_page": chunk_index,
                "metadata": json.dumps(meta),
                "chunk_type": chunk_type,
                "isa95_path": isa95_path,
                "equipment_id": equipment_id,
                "data_type": data_type,
            },
        )
        conn.commit()
    return entry_id


def insert_knowledge_entries_batch(entries: list[dict]) -> int:
    """Batch insert chunks into knowledge_entries in a single transaction.

    Each entry dict must contain: id, tenant_id, source_type, manufacturer,
    model_number, content, embedding, source_url, source_page, metadata,
    chunk_type.

    Optional per-entry keys (vision doc Problem 1): isa95_path, equipment_id,
    data_type (defaults to 'manual'). data_type is validated per entry.

    Returns count of rows inserted.
    """
    if not entries:
        return 0
    prepared: list[dict] = []
    for e in entries:
        dt = e.get("data_type", "manual")
        _data_types.validate(dt)
        prepared.append(
            {
                **e,
                "isa95_path": e.get("isa95_path"),
                "equipment_id": e.get("equipment_id"),
                "data_type": dt,
            }
        )
    with _engine().connect() as conn:
        for entry in prepared:
            conn.execute(
                text("""
                INSERT INTO knowledge_entries
                    (id, tenant_id, source_type, manufacturer, model_number,
                     content, embedding, source_url, source_page, metadata,
                     is_private, verified, chunk_type,
                     isa95_path, equipment_id, data_type)
                VALUES
                    (:id, :tenant_id, :source_type, :manufacturer, :model_number,
                     :content, cast(:embedding AS vector), :source_url, :source_page,
                     cast(:metadata AS jsonb), false, false, :chunk_type,
                     :isa95_path, :equipment_id, :data_type)
            """),
                entry,
            )
        conn.commit()
    return len(prepared)


def mark_source_fingerprint_done(row_id: int, atoms_created: int) -> None:
    with _engine().connect() as conn:
        conn.execute(
            text("UPDATE source_fingerprints SET atoms_created = :n WHERE id = :id"),
            {"n": atoms_created, "id": row_id},
        )
        conn.commit()


def mark_manual_cache_done(row_id: int) -> None:
    with _engine().connect() as conn:
        conn.execute(
            text("UPDATE manual_cache SET pdf_stored = true WHERE id = :id"), {"id": row_id}
        )
        conn.commit()


def mark_manual_verified(row_id: str) -> None:
    with _engine().connect() as conn:
        conn.execute(
            text(
                "UPDATE manuals SET is_verified = true, access_count = COALESCE(access_count, 0) + 1 "
                "WHERE id = cast(:id AS uuid)"
            ),
            {"id": row_id},
        )
        conn.commit()


def manual_exists_for(make: str, model: str, tenant_id: str) -> bool:
    """Check if we already have manual content for a given make/model in the KB."""
    try:
        with _engine().connect() as conn:
            count = conn.execute(
                text("""
                SELECT COUNT(*) FROM knowledge_entries
                WHERE tenant_id = :tid
                  AND source_type = 'manual'
                  AND LOWER(manufacturer) = LOWER(:make)
                  AND LOWER(model_number) = LOWER(:model)
            """),
                {"tid": tenant_id, "make": make, "model": model},
            ).scalar()
        return (count or 0) > 0
    except Exception:
        return False  # fail open — don't block ingest on lookup errors


def queue_manual_url(url: str, make: str, model: str, tenant_id: str) -> bool:
    """Queue a manual URL for the nightly ingest pipeline. Wraps insert_manual_cache_url."""
    title = f"{make} {model} manual (auto-discovered from equipment photo)"
    return insert_manual_cache_url(
        manufacturer=make,
        model=model,
        manual_url=url,
        manual_title=title,
        source="photo_ingest",
        confidence=0.6,
    )


def insert_manual_cache_url(
    manufacturer: str,
    model: str | None,
    manual_url: str,
    manual_title: str | None,
    source: str = "apify",
    confidence: float = 0.8,
) -> bool:
    """Insert a newly-discovered URL into manual_cache. Returns True if inserted, False if duplicate."""
    with _engine().connect() as conn:
        exists = conn.execute(
            text("SELECT 1 FROM manual_cache WHERE manual_url = :url LIMIT 1"), {"url": manual_url}
        ).fetchone()
        if exists:
            return False
        conn.execute(
            text("""
            INSERT INTO manual_cache
                (manufacturer, model, manual_url, manual_title, pdf_stored, source, confidence)
            VALUES
                (:mfr, :model, :url, :title, false, :source, :conf)
        """),
            {
                "mfr": manufacturer,
                "model": model,
                "url": manual_url,
                "title": manual_title,
                "source": source,
                "conf": confidence,
            },
        )
        conn.commit()
    return True


# ── Session analysis (written by tests/eval/analyze_sessions.py) ──────────────

def ensure_session_analyses_table() -> None:
    """Additive migration: create session_analyses table for analyzer results."""
    statements = [
        """
        CREATE TABLE IF NOT EXISTS session_analyses (
            id SERIAL PRIMARY KEY,
            chat_id_hash TEXT NOT NULL,
            analyzed_at TIMESTAMPTZ DEFAULT NOW(),
            version TEXT,
            platform TEXT,
            turn_count INT,
            overall_score FLOAT,
            grades JSONB,
            fixture_path TEXT,
            category TEXT,
            session_timestamp TEXT
        )
        """,
        "CREATE INDEX IF NOT EXISTS idx_session_analyses_hash ON session_analyses (chat_id_hash)",
        "CREATE INDEX IF NOT EXISTS idx_session_analyses_score ON session_analyses (overall_score)",
        "CREATE INDEX IF NOT EXISTS idx_session_analyses_category ON session_analyses (category)",
    ]
    try:
        with _engine().connect() as conn:
            for stmt in statements:
                conn.execute(text(stmt))
            conn.commit()
    except Exception as exc:
        import logging
        logging.getLogger("mira-ingest").warning(
            "session_analyses table migration failed (non-fatal): %s", exc
        )


def write_session_analysis(result: dict) -> None:
    """Write one session analysis result to NeonDB."""
    with _engine().connect() as conn:
        conn.execute(
            text("""
            INSERT INTO session_analyses
                (chat_id_hash, version, platform, turn_count, overall_score,
                 grades, fixture_path, category, session_timestamp)
            VALUES
                (:hash, :ver, :platform, :turns, :score,
                 :grades, :fixture, :category, :ts)
            """),
            {
                "hash": result.get("chat_id_hash", ""),
                "ver": result.get("version", ""),
                "platform": result.get("platform", ""),
                "turns": result.get("turn_count", 0),
                "score": result.get("overall_score", 0.0),
                "grades": json.dumps(result.get("grades", {})),
                "fixture": result.get("fixture_path", ""),
                "category": result.get("category", ""),
                "ts": result.get("session_timestamp", ""),
            },
        )
        conn.commit()
