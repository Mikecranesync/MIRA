"""MD5-based document deduplication with SQLite backing store.

Prevents re-ingesting documents that have already been processed.
Thread-safe (connection per call pattern, WAL mode).

Usage:
    dedup = DedupStore(db_path=Path("/data/crawler_dedup.db"))
    if dedup.is_already_indexed(pdf_bytes):
        print("skipping — already ingested")
    else:
        # ... ingest the document
        dedup.mark_indexed(pdf_bytes, source_url="https://...", metadata={...})
"""

from __future__ import annotations

import hashlib
import json
import logging
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger("mira-crawler.dedup")


def _file_hash(data: bytes) -> str:
    """MD5 hash of file content."""
    return hashlib.md5(data).hexdigest()


class DedupStore:
    """SQLite-backed dedup store for crawled documents."""

    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        """Open a new connection (thread-safe pattern)."""
        conn = sqlite3.connect(str(self.db_path))
        conn.execute("PRAGMA journal_mode=WAL")
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        """Create the dedup table if it doesn't exist."""
        conn = self._connect()
        try:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS ingested_docs (
                    file_hash TEXT PRIMARY KEY,
                    source_url TEXT,
                    source_type TEXT,
                    equipment_id TEXT,
                    chunk_count INTEGER DEFAULT 0,
                    status TEXT DEFAULT 'indexed',
                    metadata_json TEXT DEFAULT '{}',
                    ingested_at TEXT NOT NULL
                )
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_source_url
                ON ingested_docs(source_url)
            """)
            conn.commit()
        finally:
            conn.close()

    def is_already_indexed(self, data: bytes) -> bool:
        """Check if file content has been indexed before.

        Returns True if the MD5 hash exists in the store.
        """
        h = _file_hash(data)
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT 1 FROM ingested_docs WHERE file_hash = ?", (h,)
            ).fetchone()
            return row is not None
        finally:
            conn.close()

    def is_url_indexed(self, url: str) -> bool:
        """Check if a source URL has been indexed before."""
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT 1 FROM ingested_docs WHERE source_url = ?", (url,)
            ).fetchone()
            return row is not None
        finally:
            conn.close()

    def mark_indexed(
        self,
        data: bytes,
        source_url: str = "",
        source_type: str = "",
        equipment_id: str = "",
        chunk_count: int = 0,
        metadata: dict | None = None,
    ) -> str:
        """Record a document as indexed. Returns the file hash."""
        h = _file_hash(data)
        conn = self._connect()
        try:
            conn.execute(
                """
                INSERT OR REPLACE INTO ingested_docs
                (file_hash, source_url, source_type, equipment_id,
                 chunk_count, status, metadata_json, ingested_at)
                VALUES (?, ?, ?, ?, ?, 'indexed', ?, ?)
                """,
                (
                    h,
                    source_url,
                    source_type,
                    equipment_id,
                    chunk_count,
                    json.dumps(metadata or {}),
                    datetime.now(timezone.utc).isoformat(),
                ),
            )
            conn.commit()
            logger.info("Marked indexed: %s (hash=%s, chunks=%d)", source_url or "file", h, chunk_count)
            return h
        finally:
            conn.close()

    def stats(self) -> dict:
        """Return summary statistics."""
        conn = self._connect()
        try:
            total = conn.execute("SELECT COUNT(*) FROM ingested_docs").fetchone()[0]
            by_type = dict(
                conn.execute(
                    "SELECT source_type, COUNT(*) FROM ingested_docs GROUP BY source_type"
                ).fetchall()
            )
            total_chunks = conn.execute(
                "SELECT COALESCE(SUM(chunk_count), 0) FROM ingested_docs"
            ).fetchone()[0]
            return {
                "total_documents": total,
                "total_chunks": total_chunks,
                "by_source_type": by_type,
            }
        finally:
            conn.close()
