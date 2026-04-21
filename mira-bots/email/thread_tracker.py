"""Match email replies to existing MIRA chat threads.

Resolution order:
  1. In-Reply-To header  → stored message-ID lookup   (fastest, most reliable)
  2. References chain    → any ancestor message-ID lookup
  3. Same sender + normalized subject within 24h     (reply without proper headers)
  4. New thread          → generate deterministic ID from content hash

Uses SQLite for persistence (same host as mira-bridge).
Never raises on DB errors — falls back to generating a fresh thread ID.
"""

from __future__ import annotations

import hashlib
import logging
import re
import sqlite3
import time

logger = logging.getLogger("mira-email")

_RE_PREFIX = re.compile(r"^(re|fwd?|aw|wg|sv|tr)\s*:\s*", re.IGNORECASE)
_THREAD_WINDOW = 86_400  # 24 hours


class ThreadTracker:
    def __init__(self, db_path: str = "/data/email-threads.db") -> None:
        self._db = db_path
        self._init_db()

    def _init_db(self) -> None:
        try:
            with sqlite3.connect(self._db) as conn:
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS email_threads (
                        message_id      TEXT PRIMARY KEY,
                        thread_id       TEXT NOT NULL,
                        sender          TEXT NOT NULL,
                        norm_subject    TEXT NOT NULL,
                        created_at      INTEGER NOT NULL
                    )
                """)
                conn.execute(
                    "CREATE INDEX IF NOT EXISTS et_thread_idx ON email_threads(thread_id)"
                )
                conn.execute(
                    "CREATE INDEX IF NOT EXISTS et_sender_subj_idx "
                    "ON email_threads(sender, norm_subject, created_at)"
                )
                conn.commit()
        except Exception as exc:
            logger.error("THREAD_DB_INIT_FAIL path=%s error=%s", self._db, exc)

    def resolve(
        self,
        message_id: str,
        in_reply_to: str,
        references: list[str],
        subject: str,
        sender: str,
    ) -> str:
        """Return the thread_id for this email. Creates one if none matches."""
        try:
            # 1. Direct In-Reply-To lookup
            if in_reply_to:
                tid = self._lookup(in_reply_to)
                if tid:
                    self._store(message_id, tid, sender, subject)
                    return tid

            # 2. References chain (oldest ancestor first)
            for ref in references:
                tid = self._lookup(ref)
                if tid:
                    self._store(message_id, tid, sender, subject)
                    return tid

            # 3. Same sender + normalized subject within 24h
            norm = _normalize_subject(subject)
            tid = self._lookup_sender_subject(sender.lower(), norm)
            if tid:
                self._store(message_id, tid, sender, subject)
                return tid

            # 4. New thread
            tid = _make_thread_id(message_id, sender, subject)
            self._store(message_id, tid, sender, subject)
            return tid

        except Exception as exc:
            logger.error("THREAD_RESOLVE_FAIL error=%s", str(exc)[:200])
            return _make_thread_id(message_id, sender, subject)

    # ------------------------------------------------------------------

    def _lookup(self, message_id: str) -> str | None:
        if not message_id:
            return None
        try:
            with sqlite3.connect(self._db) as conn:
                row = conn.execute(
                    "SELECT thread_id FROM email_threads WHERE message_id = ?",
                    (message_id,),
                ).fetchone()
            return row[0] if row else None
        except Exception:
            return None

    def _lookup_sender_subject(self, sender: str, norm_subject: str) -> str | None:
        cutoff = int(time.time()) - _THREAD_WINDOW
        try:
            with sqlite3.connect(self._db) as conn:
                row = conn.execute(
                    "SELECT thread_id FROM email_threads "
                    "WHERE sender = ? AND norm_subject = ? AND created_at > ? "
                    "ORDER BY created_at DESC LIMIT 1",
                    (sender, norm_subject, cutoff),
                ).fetchone()
            return row[0] if row else None
        except Exception:
            return None

    def _store(self, message_id: str, thread_id: str, sender: str, subject: str) -> None:
        if not message_id:
            return
        try:
            with sqlite3.connect(self._db) as conn:
                conn.execute(
                    "INSERT OR IGNORE INTO email_threads "
                    "(message_id, thread_id, sender, norm_subject, created_at) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (
                        message_id,
                        thread_id,
                        sender.lower(),
                        _normalize_subject(subject),
                        int(time.time()),
                    ),
                )
                conn.commit()
        except Exception as exc:
            logger.warning("THREAD_STORE_FAIL error=%s", str(exc)[:200])


def _normalize_subject(subject: str) -> str:
    """Strip Re:/Fwd: prefixes and normalize whitespace."""
    s = subject.strip().lower()
    while True:
        new = _RE_PREFIX.sub("", s).strip()
        if new == s:
            break
        s = new
    # Collapse whitespace
    s = re.sub(r"\s+", " ", s)
    return s[:200]


def _make_thread_id(message_id: str, sender: str, subject: str) -> str:
    key = f"{sender.lower()}:{_normalize_subject(subject)}:{message_id}"
    digest = hashlib.sha256(key.encode()).hexdigest()[:16]
    return f"email:{digest}"
