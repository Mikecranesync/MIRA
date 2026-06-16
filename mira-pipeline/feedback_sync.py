"""Sync Open WebUI feedback ratings to MIRA pipeline feedback_log.

Polls Open WebUI's webui.db for new feedback entries and pushes them
to the pipeline's /v1/feedback endpoint. Designed to run as a periodic
background task inside the pipeline container.

Open WebUI stores ratings in the `feedback` table:
  - type: "rating"
  - data: {"rating": 1 or -1, "model_id": "...", "reason": "...", "comment": "..."}
  - meta: {"chat_id": "...", "message_id": "...", ...}
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import time

import httpx

logger = logging.getLogger("mira.feedback_sync")

WEBUI_DB = os.getenv("WEBUI_DB_PATH", "/app/backend/data/webui.db")
PIPELINE_URL = os.getenv("PIPELINE_FEEDBACK_URL", "http://localhost:9099/v1/feedback")
SYNC_STATE_PATH = os.getenv("FEEDBACK_SYNC_STATE", "/data/mem0/feedback_sync_state.json")
POLL_INTERVAL = int(os.getenv("FEEDBACK_SYNC_INTERVAL", "60"))


def _load_last_sync() -> int:
    """Load the timestamp of the last synced feedback entry."""
    try:
        with open(SYNC_STATE_PATH) as f:
            return json.load(f).get("last_sync_ts", 0)
    except (FileNotFoundError, json.JSONDecodeError):
        return 0


def _save_last_sync(ts: int) -> None:
    """Persist the timestamp of the last synced entry."""
    os.makedirs(os.path.dirname(SYNC_STATE_PATH), exist_ok=True)
    with open(SYNC_STATE_PATH, "w") as f:
        json.dump({"last_sync_ts": ts}, f)


def sync_once() -> int:
    """Pull new feedback from Open WebUI DB and push to pipeline.

    Returns the number of new ratings synced.
    """
    if not os.path.exists(WEBUI_DB):
        logger.debug("WebUI DB not found at %s — skipping sync", WEBUI_DB)
        return 0

    last_ts = _load_last_sync()

    db = sqlite3.connect(WEBUI_DB)
    db.row_factory = sqlite3.Row
    rows = db.execute(
        "SELECT id, data, meta, created_at FROM feedback "
        "WHERE type = 'rating' AND created_at > ? "
        "ORDER BY created_at ASC",
        (last_ts,),
    ).fetchall()
    db.close()

    if not rows:
        return 0

    synced = 0
    max_ts = last_ts

    for row in rows:
        data = json.loads(row["data"]) if row["data"] else {}
        meta = json.loads(row["meta"]) if row["meta"] else {}

        rating_val = data.get("rating", 0)
        rating_str = "up" if rating_val > 0 else "down"
        chat_id = meta.get("chat_id", "unknown")
        reason = data.get("comment", "") or data.get("reason", "")

        try:
            resp = httpx.post(
                PIPELINE_URL,
                json={"chat_id": chat_id, "rating": rating_str, "reason": reason},
                timeout=10,
            )
            if resp.status_code == 200:
                synced += 1
                logger.info(
                    "FEEDBACK_SYNC rating=%s chat_id=%s reason=%r",
                    rating_str,
                    chat_id[:12],
                    reason[:50],
                )
            else:
                logger.warning("FEEDBACK_SYNC failed %s: %s", resp.status_code, resp.text[:100])
        except Exception as e:
            logger.warning("FEEDBACK_SYNC error: %s", e)

        if row["created_at"] > max_ts:
            max_ts = row["created_at"]

    if synced:
        _save_last_sync(max_ts)

    return synced


def run_loop() -> None:
    """Run sync in a loop. Intended for background thread."""
    logger.info("Feedback sync started (interval=%ds, webui_db=%s)", POLL_INTERVAL, WEBUI_DB)
    while True:
        try:
            count = sync_once()
            if count:
                logger.info("FEEDBACK_SYNC batch=%d ratings synced", count)
        except Exception as e:
            logger.error("FEEDBACK_SYNC loop error: %s", e)
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    count = sync_once()
    print(f"Synced {count} ratings")
