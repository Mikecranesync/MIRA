"""Local retention for technician-supplied documents (never drop the bytes).

A manual a technician sends is the most valuable input MIRA receives — it is the
one document we could not have crawled, uploaded by the person who owns the
machine. Before this module the Telegram document handler discarded those bytes
whenever the Hub's citable folder-upload door was unreachable (2026-08-16 prod:
``HUB_INGEST_TOKEN`` was empty, so a real Danfoss FC-202 manual was answered with
the raw internal string "Hub intake is not configured." and thrown away).

This module is the floor under that door: write the bytes to a spool directory on
the bot's own volume and record a ``pending`` row, so the file survives the outage
and can be re-driven into the Hub once the connection is repaired.

Scope, honestly: this **retains**, it does not ingest. There is no automatic
drainer today — the spool + ledger is what makes a later drain (or a manual
re-upload) possible at all. Nothing here makes a document searchable.

Design rules:
- **Content-addressed, idempotent.** The spooled name is ``<sha256[:16]>__<name>``,
  so re-sending the same PDF overwrites one file instead of accreting copies.
- **Bytes first, ledger second.** A failed SQLite write must not lose a file that
  is already safely on disk (the filename carries the hash and original name).
- **Never raises.** Callers are background tasks on the chat path.
"""

from __future__ import annotations

import hashlib
import logging
import os
import re
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger("mira.document_spool")

# Spool location. Defaults next to the bot's SQLite DB so it lands on the same
# persistent volume (`MIRA_DB_PATH` is `/data/mira.db` in every compose file).
SPOOL_DIR_ENV = "MIRA_DOC_SPOOL_DIR"

STATUS_PENDING = "pending"

_UNSAFE_NAME_RE = re.compile(r"[^A-Za-z0-9._-]+")
_MAX_NAME_LEN = 120


@dataclass(frozen=True)
class SpooledDocument:
    """A document retained on local disk, awaiting ingest."""

    doc_id: str
    path: str
    filename: str
    sha256: str
    size: int


def spool_dir() -> Path:
    """Directory holding retained documents."""
    explicit = os.environ.get(SPOOL_DIR_ENV, "")
    if explicit:
        return Path(explicit)
    db_path = os.environ.get("MIRA_DB_PATH", "/data/mira.db")
    return Path(db_path).parent / "documents"


def _safe_name(filename: str) -> str:
    """Filesystem-safe basename — no traversal, no separators, bounded length."""
    base = os.path.basename((filename or "").replace("\\", "/")).strip()
    cleaned = _UNSAFE_NAME_RE.sub("_", base).strip("._")
    return (cleaned[-_MAX_NAME_LEN:] or "upload.pdf").lstrip(".") or "upload.pdf"


def _spool_db() -> sqlite3.Connection:
    db_path = os.environ.get("MIRA_DB_PATH", "/data/mira.db")
    db = sqlite3.connect(db_path)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute(
        "CREATE TABLE IF NOT EXISTS pending_document_intake ("
        "doc_id TEXT PRIMARY KEY, filename TEXT NOT NULL, path TEXT NOT NULL, "
        "sha256 TEXT NOT NULL, size INTEGER NOT NULL, mime TEXT NOT NULL, "
        "tenant_id TEXT, uploader TEXT, caption TEXT, source TEXT NOT NULL, "
        "status TEXT NOT NULL, reason TEXT, created_at REAL NOT NULL)"
    )
    return db


def spool_document(
    *,
    raw_bytes: bytes,
    filename: str,
    mime: str = "application/pdf",
    tenant_id: str = "",
    uploader: str = "",
    caption: str = "",
    source: str = "telegram",
    reason: str = "",
) -> SpooledDocument | None:
    """Retain ``raw_bytes`` on local disk + record a ``pending`` ledger row.

    Returns the :class:`SpooledDocument` on success, or ``None`` when the bytes
    could **not** be retained — the caller must then tell the user the truth
    rather than claim the file was kept.
    """
    if not raw_bytes:
        return None

    sha = hashlib.sha256(raw_bytes).hexdigest()
    doc_id = sha[:16]
    safe = _safe_name(filename)

    try:
        directory = spool_dir()
        directory.mkdir(parents=True, exist_ok=True)
        target = directory / f"{doc_id}__{safe}"
        target.write_bytes(raw_bytes)
    except Exception as exc:  # noqa: BLE001 — retention failure must not raise
        logger.error(
            "DOCUMENT_SPOOL_FAILED file=%s bytes=%d err=%s", safe, len(raw_bytes), exc
        )
        return None

    doc = SpooledDocument(
        doc_id=doc_id,
        path=str(target),
        filename=safe,
        sha256=sha,
        size=len(raw_bytes),
    )

    # Ledger is fail-open: the bytes are already safe on disk and the filename
    # carries both the hash and the original name, so a locked DB loses metadata,
    # never the document.
    try:
        db = _spool_db()
        try:
            db.execute(
                "INSERT INTO pending_document_intake (doc_id, filename, path, sha256, "
                "size, mime, tenant_id, uploader, caption, source, status, reason, "
                "created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(doc_id) DO UPDATE SET path = excluded.path, "
                "status = excluded.status, reason = excluded.reason, "
                "created_at = excluded.created_at",
                (
                    doc_id,
                    safe,
                    doc.path,
                    sha,
                    doc.size,
                    mime,
                    tenant_id or "",
                    uploader or "",
                    caption or "",
                    source,
                    STATUS_PENDING,
                    reason or "",
                    time.time(),
                ),
            )
            db.commit()
        finally:
            db.close()
    except Exception as exc:  # noqa: BLE001 — ledger write must never raise
        logger.warning(
            "DOCUMENT_SPOOL_LEDGER_FAILED doc_id=%s path=%s err=%s", doc_id, doc.path, exc
        )

    logger.info(
        "DOCUMENT_SPOOLED doc_id=%s file=%s bytes=%d source=%s reason=%s path=%s",
        doc_id,
        safe,
        doc.size,
        source,
        reason or "unspecified",
        doc.path,
    )
    return doc
