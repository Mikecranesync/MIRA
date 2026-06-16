"""SQLite-backed durable photo-batch queue for multi-photo bursts.

Replaces the in-memory ``PHOTO_BUFFER`` dict in ``mira-bots/telegram/bot.py``.
Telegram users sending multiple photos in rapid succession (a "burst") get
them collected into a single batch, queued for processing, drained by a
single async worker (vision is GPU-bound on one Ollama node), and the
result delivered back to the chat.

Why SQLite-backed: bot container restarts no longer drop in-flight bursts.
Why single worker: vision is the GPU bottleneck — multiple workers fight
for the same Ollama node, so concurrency = 1.

Schema (one table, ``photo_batches``):
    id               INTEGER PRIMARY KEY
    chat_id          TEXT
    platform         TEXT          'telegram' | 'slack'
    status           TEXT          'collecting' | 'queued' | 'processing'
                                   | 'done' | 'failed'
    caption          TEXT
    photos_json      TEXT          JSON list of base64 vision-resized bytes
    photo_count      INTEGER
    ack_message_id   INTEGER       NULL until adapter sends ack
    created_at       REAL
    queued_at        REAL
    started_at       REAL
    completed_at     REAL
    error_message    TEXT
    reply_text       TEXT

Bounds:
    MAX_PHOTOS_PER_BURST = 10      photos past cap raise BurstFull
    MAX_QUEUE_DEPTH      = 20      queued+processing past cap raise QueueFull
    BURST_WINDOW_SECONDS = 4.0     wait window before flipping collecting -> queued
"""

from __future__ import annotations

import asyncio
import json
import logging
import sqlite3
import time
from dataclasses import dataclass

from shared.photo_handler import DEFAULT_PHOTO_CAPTION, preserve_first_meaningful_caption

logger = logging.getLogger("mira-gsd")


MAX_PHOTOS_PER_BURST = 10
MAX_QUEUE_DEPTH = 20
BURST_WINDOW_SECONDS = 4.0

_SCHEMA = """
CREATE TABLE IF NOT EXISTS photo_batches (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id         TEXT NOT NULL,
    platform        TEXT NOT NULL,
    status          TEXT NOT NULL,
    caption         TEXT NOT NULL,
    photos_json     TEXT NOT NULL,
    photo_count     INTEGER NOT NULL,
    ack_message_id  INTEGER,
    created_at      REAL NOT NULL,
    queued_at       REAL,
    started_at      REAL,
    completed_at    REAL,
    error_message   TEXT,
    reply_text      TEXT
);

CREATE INDEX IF NOT EXISTS idx_photo_batches_status_created
    ON photo_batches(status, created_at);
CREATE INDEX IF NOT EXISTS idx_photo_batches_chat_status
    ON photo_batches(chat_id, platform, status);
"""


class BurstFull(Exception):
    """Raised when a single burst exceeds MAX_PHOTOS_PER_BURST."""


class QueueFull(Exception):
    """Raised when queued+processing rows exceed MAX_QUEUE_DEPTH."""


@dataclass
class PhotoBatchRecord:
    id: int
    chat_id: str
    platform: str
    caption: str
    photos_b64: list[str]
    ack_message_id: int | None
    created_at: float


class PhotoBatchQueue:
    """Durable photo-batch queue.

    SQLite is the source of truth; a small in-process ``asyncio.Queue`` is
    used purely to wake the worker when something becomes ready. On worker
    startup ``recover_orphans()`` should be called to flip any rows left in
    ``processing`` (the previous worker was killed mid-job) back to
    ``queued`` so they get retried.
    """

    def __init__(self, db_path: str) -> None:
        self.db_path = db_path
        self._conn = sqlite3.connect(db_path, isolation_level=None, check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA foreign_keys=ON")
        self._conn.executescript(_SCHEMA)
        self._notify: asyncio.Queue[int] = asyncio.Queue()
        self._lock = asyncio.Lock()

    # --------------------------------------------------------------- producer

    async def add_photo_to_burst(
        self,
        chat_id: str,
        platform: str,
        photo_b64: str,
        caption: str,
        ack_message_id: int | None = None,
    ) -> tuple[int, int]:
        """Add a photo to the current open burst for (chat_id, platform).

        If no ``collecting`` row exists, one is created. Otherwise the photo
        is appended to the existing one and the caption is merged via
        ``preserve_first_meaningful_caption``.

        Returns ``(batch_id, photo_count_after)``.

        Raises ``BurstFull`` if the resulting photo count would exceed
        ``MAX_PHOTOS_PER_BURST``.
        """
        async with self._lock:
            row = self._conn.execute(
                "SELECT id, photos_json, caption, photo_count, ack_message_id "
                "FROM photo_batches "
                "WHERE chat_id = ? AND platform = ? AND status = 'collecting' "
                "ORDER BY id DESC LIMIT 1",
                (chat_id, platform),
            ).fetchone()

            if row is None:
                now = time.time()
                photos = [photo_b64]
                cur = self._conn.execute(
                    "INSERT INTO photo_batches "
                    "(chat_id, platform, status, caption, photos_json, "
                    " photo_count, ack_message_id, created_at) "
                    "VALUES (?, ?, 'collecting', ?, ?, ?, ?, ?)",
                    (chat_id, platform, caption, json.dumps(photos), 1, ack_message_id, now),
                )
                return int(cur.lastrowid), 1

            batch_id, photos_json, existing_caption, photo_count, existing_ack = row
            new_count = photo_count + 1
            if new_count > MAX_PHOTOS_PER_BURST:
                raise BurstFull(
                    f"burst {batch_id} already at {photo_count} photos (cap {MAX_PHOTOS_PER_BURST})"
                )

            photos = json.loads(photos_json)
            photos.append(photo_b64)
            merged_caption = preserve_first_meaningful_caption(existing_caption, caption)
            new_ack = existing_ack if existing_ack is not None else ack_message_id

            self._conn.execute(
                "UPDATE photo_batches SET photos_json = ?, photo_count = ?, "
                "caption = ?, ack_message_id = ? WHERE id = ?",
                (json.dumps(photos), new_count, merged_caption, new_ack, batch_id),
            )
            return int(batch_id), new_count

    async def set_ack_message(self, batch_id: int, ack_message_id: int) -> None:
        async with self._lock:
            self._conn.execute(
                "UPDATE photo_batches SET ack_message_id = ? "
                "WHERE id = ? AND ack_message_id IS NULL",
                (ack_message_id, batch_id),
            )

    async def close_burst(self, batch_id: int) -> bool:
        """Flip a ``collecting`` batch to ``queued``.

        Returns ``True`` if the flip happened (and the worker has been
        notified), ``False`` if the batch was already past collecting (e.g.
        a concurrent close).

        Raises ``QueueFull`` if too many batches are already queued or
        processing — caller should tell the user to retry.
        """
        async with self._lock:
            depth = self._conn.execute(
                "SELECT COUNT(*) FROM photo_batches WHERE status IN ('queued', 'processing')"
            ).fetchone()[0]
            if depth >= MAX_QUEUE_DEPTH:
                raise QueueFull(f"queue depth {depth} >= cap {MAX_QUEUE_DEPTH}")

            now = time.time()
            cur = self._conn.execute(
                "UPDATE photo_batches SET status = 'queued', queued_at = ? "
                "WHERE id = ? AND status = 'collecting'",
                (now, batch_id),
            )
            if cur.rowcount == 0:
                return False

        await self._notify.put(batch_id)
        return True

    # --------------------------------------------------------------- consumer

    async def dequeue(self) -> PhotoBatchRecord:
        """Block until the next queued batch is available; flip to processing.

        Returns the record. Caller must follow with ``mark_done`` or
        ``mark_failed``.
        """
        while True:
            await self._notify.get()
            async with self._lock:
                row = self._conn.execute(
                    "SELECT id, chat_id, platform, caption, photos_json, "
                    " ack_message_id, created_at "
                    "FROM photo_batches WHERE status = 'queued' "
                    "ORDER BY queued_at ASC, id ASC LIMIT 1"
                ).fetchone()
                if row is None:
                    continue
                batch_id, chat_id, platform, caption, photos_json, ack_id, created_at = row
                now = time.time()
                self._conn.execute(
                    "UPDATE photo_batches SET status = 'processing', started_at = ? "
                    "WHERE id = ? AND status = 'queued'",
                    (now, batch_id),
                )
            return PhotoBatchRecord(
                id=int(batch_id),
                chat_id=str(chat_id),
                platform=str(platform),
                caption=str(caption),
                photos_b64=list(json.loads(photos_json)),
                ack_message_id=int(ack_id) if ack_id is not None else None,
                created_at=float(created_at),
            )

    async def mark_done(self, batch_id: int, reply_text: str) -> None:
        async with self._lock:
            self._conn.execute(
                "UPDATE photo_batches SET status = 'done', completed_at = ?, "
                " reply_text = ? WHERE id = ?",
                (time.time(), reply_text, batch_id),
            )

    async def mark_failed(self, batch_id: int, error: str) -> None:
        async with self._lock:
            self._conn.execute(
                "UPDATE photo_batches SET status = 'failed', completed_at = ?, "
                " error_message = ? WHERE id = ?",
                (time.time(), error, batch_id),
            )

    # ---------------------------------------------------------------- recovery

    async def recover_orphans(self) -> int:
        """On worker startup, flip any ``processing`` rows back to ``queued``.

        Assumes the previous worker died mid-job (container restart). The
        worker will retry from scratch — vision is idempotent, so running
        it twice on the same input is safe.

        Also re-notifies the asyncio queue for every existing ``queued``
        row so they get drained on startup.

        Returns the number of orphan rows reset.
        """
        async with self._lock:
            cur = self._conn.execute(
                "UPDATE photo_batches SET status = 'queued', started_at = NULL "
                "WHERE status = 'processing'"
            )
            n_orphans = cur.rowcount

            queued = [
                row[0]
                for row in self._conn.execute(
                    "SELECT id FROM photo_batches WHERE status = 'queued' "
                    "ORDER BY queued_at ASC, id ASC"
                ).fetchall()
            ]

        for batch_id in queued:
            await self._notify.put(int(batch_id))

        if n_orphans:
            logger.warning("PHOTO_QUEUE_RECOVER orphans=%d requeued=%d", n_orphans, len(queued))
        return n_orphans

    # ------------------------------------------------------------- diagnostics

    def stats(self) -> dict[str, int]:
        """Return current queue depth by status (for /health and tests)."""
        rows = self._conn.execute(
            "SELECT status, COUNT(*) FROM photo_batches GROUP BY status"
        ).fetchall()
        return {row[0]: int(row[1]) for row in rows}

    def close(self) -> None:
        self._conn.close()


__all__ = [
    "BURST_WINDOW_SECONDS",
    "BurstFull",
    "MAX_PHOTOS_PER_BURST",
    "MAX_QUEUE_DEPTH",
    "PhotoBatchQueue",
    "PhotoBatchRecord",
    "QueueFull",
    "DEFAULT_PHOTO_CAPTION",
]
