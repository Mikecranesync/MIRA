"""MIRA Photo Handler — session photo persistence and electrical-print reply formatting.

Extracted from engine.py (Supervisor class) to be independently testable.
engine.py delegates all photo I/O and print-reply formatting here.

Dependency direction: photo_handler ← stdlib only (no engine imports)
"""

from __future__ import annotations

import base64
import logging
import os

logger = logging.getLogger("mira-gsd")


def _photos_dir(db_path: str) -> str:
    return os.path.join(os.path.dirname(db_path), "session_photos")


def save_session_photo(db_path: str, chat_id: str, photo_b64: str) -> str:
    """Save session photo to disk. Returns the file path."""
    photos_dir = _photos_dir(db_path)
    os.makedirs(photos_dir, exist_ok=True)
    path = os.path.join(photos_dir, f"{chat_id}.jpg")
    with open(path, "wb") as f:
        f.write(base64.b64decode(photo_b64))
    logger.info("Session photo saved: %s", path)
    return path


def load_session_photo(db_path: str, chat_id: str) -> str | None:
    """Load session photo as base64 if it exists. Returns None if not found."""
    path = os.path.join(_photos_dir(db_path), f"{chat_id}.jpg")
    if not os.path.exists(path):
        return None
    try:
        with open(path, "rb") as f:
            return base64.b64encode(f.read()).decode()
    except Exception as e:
        logger.warning("Failed to load session photo: %s", e)
        return None


def clear_session_photo(db_path: str, chat_id: str) -> None:
    """Remove the session photo when it expires or session resets."""
    path = os.path.join(_photos_dir(db_path), f"{chat_id}.jpg")
    if os.path.exists(path):
        os.remove(path)
        logger.info("Session photo cleared: %s", path)


def build_print_reply(vision_data: dict) -> str:
    """Build the user-facing reply for an electrical print photo."""
    items_list = vision_data.get("ocr_items", [])
    drawing_type = vision_data.get("drawing_type", "electrical drawing")
    n = len(items_list)

    if n == 0:
        quality = "Couldn't extract text — try better lighting or a closer shot."
    elif n <= 5:
        quality = f"Weak read — only {n} labels. Closer shot recommended."
    elif n <= 20:
        quality = f"Partial read — {n} labels extracted."
    else:
        quality = f"Good read — {n} labels extracted."

    chrome = [
        "ask copilot",
        "sharepoint",
        "file c:/",
        "c:\\",
        ".exe",
        ".dll",
        "microsoft",
        "adobe",
    ]
    artifact_note = (
        " (some labels may be screen UI, not drawing content)"
        if any(p in " ".join(items_list).lower() for p in chrome)
        else ""
    )

    prompts = {
        "ladder logic diagram": "Describe a fault symptom or ask what a specific rung does.",
        "one-line diagram": "Ask me to trace power flow or identify a protection device.",
        "P&ID": "Ask me to identify a tag number or trace a process line.",
        "wiring diagram": "Ask me to trace a wire run or identify connection points.",
        "panel schedule": "Ask me to look up a specific entry.",
    }
    next_step = prompts.get(drawing_type, "Ask me what you're trying to find.")
    preview = ", ".join(items_list[:8]) if items_list else "(no text extracted)"

    _FAULT_KEYWORDS = (
        "stopped",
        "fault",
        "alarm",
        "error",
        "trip",
        "warning",
        "faulted",
        "tripped",
    )
    fault_items = [
        item for item in items_list if any(kw in item.lower() for kw in _FAULT_KEYWORDS)
    ]
    if fault_items:
        preview = ", ".join(fault_items[:4])
        fault_summary = "; ".join(fault_items[:3])
        next_step = (
            f"Active fault states: {fault_summary}. "
            f"Likely caused by a trip, interlock, or upstream fault. "
            f"Describe what happened before this, or ask me to trace the fault path."
        )

    return (
        f"{drawing_type.capitalize()} — {quality}{artifact_note}\n"
        f"Labels I can see: {preview}\n"
        f"{next_step}"
    )
