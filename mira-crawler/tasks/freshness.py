"""Freshness task — audit stale KB entries by TTL and re-queue for recrawl."""

from __future__ import annotations

import logging
import os

try:
    from mira_crawler.celery_app import app
except ImportError:
    from celery_app import app

logger = logging.getLogger("mira-crawler.tasks.freshness")

# ---------------------------------------------------------------------------
# TTL configuration — days before a source_type is considered stale.
# None means the content never expires.
# ---------------------------------------------------------------------------

_TTL_DAYS: dict[str, int | None] = {
    "equipment_manual": 365,
    "knowledge_article": 90,
    "standard": 180,
    "forum_post": 30,
    "rss_article": 90,
    # Never expires
    "curriculum": None,
    "youtube_transcript": None,
    "patent": None,
}

_DEFAULT_TTL_DAYS = 90  # applied to unrecognised source_types


# ---------------------------------------------------------------------------
# Pure helper — testable without DB
# ---------------------------------------------------------------------------


def _get_ttl_days(source_type: str) -> int | None:
    """Return TTL in days for a given source_type.

    Returns None for types that never expire.
    Returns the default TTL (90 days) for unrecognised source_types.

    Args:
        source_type: The content source type string.

    Returns:
        Number of days before the content is stale, or None if it never expires.
    """
    if source_type in _TTL_DAYS:
        return _TTL_DAYS[source_type]
    return _DEFAULT_TTL_DAYS


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------


def _engine():
    """Get a SQLAlchemy engine with NullPool for NeonDB."""
    from sqlalchemy import create_engine
    from sqlalchemy.pool import NullPool

    url = os.environ.get("NEON_DATABASE_URL")
    if not url:
        raise RuntimeError("NEON_DATABASE_URL not set")

    return create_engine(
        url,
        poolclass=NullPool,
        connect_args={"sslmode": "require"},
        pool_pre_ping=True,
    )


def _find_stale_entries(tenant_id: str) -> list[dict]:
    """Query NeonDB for all knowledge_entries past their TTL.

    Returns list of dicts with keys: id, source_url, source_type.
    Types with TTL=None are excluded from the query.
    """
    from sqlalchemy import text

    stale: list[dict] = []

    # Build per-type CASE clauses for the TTL comparison
    # Only include types that have a finite TTL
    finite_types = {k: v for k, v in _TTL_DAYS.items() if v is not None}
    # Also catch unrecognised types via a default
    if not finite_types:
        return stale

    try:
        engine = _engine()
    except RuntimeError as exc:
        logger.error("Cannot connect to NeonDB: %s", exc)
        return stale

    # Build a CASE expression for source_type → TTL days
    # Unrecognised types get DEFAULT_TTL_DAYS
    case_parts = " ".join(
        f"WHEN source_type = '{st}' THEN INTERVAL '{days} days'"
        for st, days in finite_types.items()
    )
    case_expr = f"CASE {case_parts} ELSE INTERVAL '{_DEFAULT_TTL_DAYS} days' END"

    # Exclude never-expiring types
    never_expire_types = [f"'{k}'" for k, v in _TTL_DAYS.items() if v is None]
    exclude_clause = ""
    if never_expire_types:
        exclude_clause = f"AND source_type NOT IN ({', '.join(never_expire_types)})"

    query = text(f"""
        SELECT id, source_url, source_type
        FROM knowledge_entries
        WHERE tenant_id = :tenant_id
          {exclude_clause}
          AND (metadata->>'is_stale' IS NULL OR metadata->>'is_stale' != 'true')
          AND created_at < NOW() - {case_expr}
        LIMIT 1000
    """)

    try:
        with engine.connect() as conn:
            rows = conn.execute(query, {"tenant_id": tenant_id}).fetchall()
        for row in rows:
            stale.append(
                {
                    "id": str(row[0]),
                    "source_url": row[1] or "",
                    "source_type": row[2] or "",
                }
            )
        logger.info("Found %d stale entries for tenant %s", len(stale), tenant_id)
    except Exception as exc:
        logger.error("Stale query failed: %s", exc)

    return stale


def _mark_entry_stale(entry_id: str) -> bool:
    """Set metadata->>'is_stale' = 'true' on a single knowledge_entry row."""
    from sqlalchemy import text

    try:
        engine = _engine()
        with engine.connect() as conn:
            conn.execute(
                text("""
                    UPDATE knowledge_entries
                    SET metadata = jsonb_set(
                        COALESCE(metadata, '{}'),
                        '{is_stale}',
                        'true'
                    )
                    WHERE id = :entry_id
                """),
                {"entry_id": entry_id},
            )
            conn.commit()
        return True
    except Exception as exc:
        logger.warning("Failed to mark entry %s as stale: %s", entry_id, exc)
        return False


# ---------------------------------------------------------------------------
# Celery task
# ---------------------------------------------------------------------------


@app.task(name="tasks.freshness.audit_stale_content")
def audit_stale_content() -> dict:
    """Audit knowledge entries for staleness and re-queue expired URLs.

    Steps:
      1. Query NeonDB for entries past their source_type TTL.
      2. Mark each stale entry (metadata->>'is_stale' = 'true').
      3. Queue non-empty source_urls via ingest_url.delay() for recrawl.
      4. Return summary counts.
    """
    try:
        from mira_crawler.tasks.ingest import ingest_url
    except ImportError:
        from tasks.ingest import ingest_url

    tenant_id = os.getenv("MIRA_TENANT_ID", "")
    if not tenant_id:
        logger.error("MIRA_TENANT_ID not set — cannot audit freshness")
        return {"checked": 0, "stale_found": 0, "recrawl_queued": 0, "error": "no_tenant_id"}

    # 1. Find stale entries
    stale_entries = _find_stale_entries(tenant_id)
    checked = len(stale_entries)
    stale_found = checked
    recrawl_queued = 0

    for entry in stale_entries:
        entry_id = entry["id"]
        source_url = entry["source_url"]
        source_type = entry["source_type"]

        # 2. Mark as stale
        _mark_entry_stale(entry_id)

        # 3. Queue for recrawl if URL is present and not a file:// URI
        if source_url and source_url.startswith("http"):
            try:
                ingest_url.delay(url=source_url, source_type=source_type)
                recrawl_queued += 1
                logger.debug(
                    "Queued recrawl for stale entry %s (%s)", entry_id, source_url[:60]
                )
            except Exception as exc:
                logger.warning(
                    "Failed to queue recrawl for %s: %s", source_url[:60], exc
                )

    logger.info(
        "audit_stale_content complete: %d checked, %d stale, %d recrawl queued",
        checked,
        stale_found,
        recrawl_queued,
    )
    return {"checked": checked, "stale_found": stale_found, "recrawl_queued": recrawl_queued}
