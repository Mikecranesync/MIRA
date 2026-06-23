"""Historical memory loader — synthetic-but-realistic maintenance history (the future CMMS bridge)."""
from __future__ import annotations

import json
from pathlib import Path

DEFAULT_HISTORY = Path(__file__).resolve().parent / "fixtures" / "maintenance_history.json"


def load_history(path: str | Path = DEFAULT_HISTORY) -> dict:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    data.pop("_comment", None)
    return data


def summary(history: dict, mode_id: str) -> dict:
    h = history.get(mode_id, {})
    return {
        "occurrences": h.get("occurrences", 0),
        "avg_duration_min": h.get("avg_duration_min", 0),
        "last_corrective_action": h.get("last_corrective_action", "n/a"),
    }


def events(history: dict, mode_id: str) -> list[dict]:
    return list(history.get(mode_id, {}).get("events", []))
