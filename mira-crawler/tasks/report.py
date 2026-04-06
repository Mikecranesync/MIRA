"""Post-ingest reporting task.

Queries NeonDB for recent ingestion stats and logs a summary.
Optional Telegram notification via bot adapter.
"""

from __future__ import annotations

import logging
import os

from mira_crawler.celery_app import app

logger = logging.getLogger("mira-crawler.tasks.report")

MIRA_TENANT_ID = os.getenv("MIRA_TENANT_ID", "")


@app.task
def generate_ingest_report(hours: int = 24):
    """Query NeonDB for chunks inserted in the last N hours, log summary."""
    import sys

    _ingest_dir = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "..", "mira-core", "mira-ingest",
    )
    if os.path.abspath(_ingest_dir) not in sys.path:
        sys.path.insert(0, os.path.abspath(_ingest_dir))

    try:
        from db.neon import _engine
        from sqlalchemy import text
    except ImportError:
        logger.error("Cannot import db.neon for reporting")
        return {"error": "import_failed"}

    try:
        with _engine().connect() as conn:
            rows = conn.execute(text("""
                SELECT
                    source_type,
                    manufacturer,
                    COUNT(*) as chunk_count,
                    COUNT(DISTINCT source_url) as doc_count
                FROM knowledge_entries
                WHERE tenant_id = :tid
                  AND created_at > NOW() - INTERVAL ':hours hours'
                GROUP BY source_type, manufacturer
                ORDER BY chunk_count DESC
            """), {"tid": MIRA_TENANT_ID, "hours": hours}).fetchall()
    except Exception as e:
        logger.error("Report query failed: %s", e)
        return {"error": str(e)}

    total_chunks = sum(r[2] for r in rows)
    total_docs = sum(r[3] for r in rows)

    report_lines = [
        f"=== MIRA Ingest Report (last {hours}h) ===",
        f"Total: {total_chunks} chunks from {total_docs} documents",
        "",
    ]
    for row in rows:
        source_type, manufacturer, chunk_count, doc_count = row
        mfr = manufacturer or "(general)"
        report_lines.append(f"  {source_type:20s} {mfr:20s} {chunk_count:>6d} chunks / {doc_count} docs")

    report_text = "\n".join(report_lines)
    logger.info(report_text)

    return {
        "total_chunks": total_chunks,
        "total_docs": total_docs,
        "breakdown": [
            {
                "source_type": r[0],
                "manufacturer": r[1] or "",
                "chunks": r[2],
                "docs": r[3],
            }
            for r in rows
        ],
    }
