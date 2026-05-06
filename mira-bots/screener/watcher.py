"""Async watcher — tails all four MIRA conversation data sources simultaneously.

Sources:
  1. SQLite interactions table  (poll every 5s)
  2. NDJSON session files       (poll every 2s for new lines)
  3. Docker logs stdout         (asyncio subprocess: docker logs -f)
  4. SQLite feedback_log        (poll every 10s)

Emits dicts via an asyncio.Queue consumed by the Scorer.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sqlite3
from pathlib import Path

logger = logging.getLogger("mira-screener")

_DB_PATH = os.getenv("MIRA_DB_PATH", "/data/mira.db")
_SESSION_DIR = Path(os.getenv("SESSION_RECORDING_PATH", "/data/sessions"))
_CONTAINER = os.getenv("SCREENER_CONTAINER", "mira-bot-telegram")

SQLITE_POLL_INTERVAL = 5.0
NDJSON_POLL_INTERVAL = 2.0
FEEDBACK_POLL_INTERVAL = 10.0


def _open_db(path: str) -> sqlite3.Connection:
    db = sqlite3.connect(path, timeout=5)
    db.execute("PRAGMA journal_mode=WAL")
    db.row_factory = sqlite3.Row
    return db


async def watch_sqlite(queue: asyncio.Queue, db_path: str = _DB_PATH) -> None:
    """Poll interactions table for new rows every SQLITE_POLL_INTERVAL seconds."""
    last_id = 0
    # Fast-forward to current tail on startup — don't replay history
    try:
        db = _open_db(db_path)
        row = db.execute("SELECT MAX(id) as m FROM interactions").fetchone()
        if row and row["m"]:
            last_id = row["m"]
        db.close()
    except Exception as exc:
        logger.warning("SQLite init failed: %s", exc)

    while True:
        await asyncio.sleep(SQLITE_POLL_INTERVAL)
        try:
            db = _open_db(db_path)
            rows = db.execute(
                "SELECT * FROM interactions WHERE id > ? ORDER BY id",
                (last_id,),
            ).fetchall()
            db.close()
            for row in rows:
                last_id = row["id"]
                await queue.put({"source": "sqlite", "row": dict(row)})
        except Exception as exc:
            logger.warning("SQLite poll error: %s", exc)


async def watch_ndjson(queue: asyncio.Queue, session_dir: Path = _SESSION_DIR) -> None:
    """Poll NDJSON session files for new lines every NDJSON_POLL_INTERVAL seconds."""
    # file_path → last byte offset
    file_offsets: dict[Path, int] = {}

    while True:
        await asyncio.sleep(NDJSON_POLL_INTERVAL)
        if not session_dir.exists():
            continue
        for path in session_dir.glob("*.ndjson"):
            try:
                offset = file_offsets.get(path, 0)
                size = path.stat().st_size
                if size <= offset:
                    continue
                with open(path, encoding="utf-8") as f:
                    f.seek(offset)
                    new_content = f.read()
                    file_offsets[path] = f.tell()
                for line in new_content.splitlines():
                    line = line.strip()
                    if line:
                        try:
                            event = json.loads(line)
                            event["source"] = "ndjson"
                            event["_file"] = str(path)
                            await queue.put(event)
                        except json.JSONDecodeError:
                            continue
            except Exception as exc:
                logger.warning("NDJSON poll error (%s): %s", path.name, exc)


async def watch_docker_logs(queue: asyncio.Queue, container: str = _CONTAINER) -> None:
    """Stream Docker container stdout/stderr via `docker logs -f --since 0s`."""
    while True:
        try:
            proc = await asyncio.create_subprocess_exec(
                "docker", "logs", "-f", "--since", "0s", container,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
            assert proc.stdout is not None
            async for raw in proc.stdout:
                line = raw.decode("utf-8", errors="replace").rstrip()
                if line:
                    await queue.put({"source": "docker", "line": line, "container": container})
        except FileNotFoundError:
            logger.warning("docker not found — Docker log tail disabled")
            return  # don't retry if docker binary missing
        except Exception as exc:
            logger.warning("Docker log tail error: %s — restarting in 10s", exc)
            await asyncio.sleep(10)


async def watch_feedback(queue: asyncio.Queue, db_path: str = _DB_PATH) -> None:
    """Poll feedback_log table for new rows every FEEDBACK_POLL_INTERVAL seconds."""
    last_id = 0
    try:
        db = _open_db(db_path)
        row = db.execute("SELECT MAX(id) as m FROM feedback_log").fetchone()
        if row and row["m"]:
            last_id = row["m"]
        db.close()
    except Exception as exc:
        logger.warning("Feedback init failed: %s", exc)

    while True:
        await asyncio.sleep(FEEDBACK_POLL_INTERVAL)
        try:
            db = _open_db(db_path)
            rows = db.execute(
                "SELECT * FROM feedback_log WHERE id > ? ORDER BY id",
                (last_id,),
            ).fetchall()
            db.close()
            for row in rows:
                last_id = row["id"]
                await queue.put({"source": "feedback", "row": dict(row)})
        except Exception as exc:
            logger.warning("Feedback poll error: %s", exc)


async def run_all_watchers(
    queue: asyncio.Queue,
    db_path: str = _DB_PATH,
    session_dir: Path = _SESSION_DIR,
    container: str = _CONTAINER,
) -> None:
    """Run all four watchers concurrently."""
    await asyncio.gather(
        watch_sqlite(queue, db_path),
        watch_ndjson(queue, session_dir),
        watch_docker_logs(queue, container),
        watch_feedback(queue, db_path),
    )


