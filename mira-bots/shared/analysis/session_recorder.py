"""Session turn recorder — fire-and-forget NDJSON write.

Writes one JSON line per turn to SESSION_RECORDING_PATH/<chat_id>.ndjson.
The analyze_sessions.py cron reads these files to grade completed sessions
and generate eval fixtures. Never raises; never blocks the conversation.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger("mira-session-recorder")


def _session_dir() -> Path:
    return Path(os.getenv("SESSION_RECORDING_PATH", "/data/sessions"))


def record_turn(turn: dict) -> None:
    """Append one turn to the NDJSON file for this chat_id. Never raises."""
    try:
        d = _session_dir()
        d.mkdir(parents=True, exist_ok=True)
        chat_id = str(turn.get("chat_id", "unknown"))
        # Sanitize for use as filename — keep alphanumeric, dash, underscore only
        safe_id = "".join(c if c.isalnum() or c in "-_" else "_" for c in chat_id)
        path = d / f"{safe_id}.ndjson"
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(turn, default=str) + "\n")
    except Exception as exc:
        logger.warning("record_turn failed: %s", exc)


def record_feedback(chat_id: str, rating: str, reason: str = "") -> None:
    """Append a feedback event so the analyzer can flag sessions with thumbs-down."""
    record_turn(
        {
            "type": "feedback",
            "chat_id": chat_id,
            "feedback_rating": rating,
            "reason": reason,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    )
