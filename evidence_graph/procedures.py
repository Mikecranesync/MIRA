"""Reference-procedure loader."""
from __future__ import annotations

import json
from pathlib import Path

DEFAULT_PROCEDURES = Path(__file__).resolve().parent / "fixtures" / "procedures.json"


def load_procedures(path: str | Path = DEFAULT_PROCEDURES) -> dict:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    data.pop("_comment", None)
    return data


def get(procedures: dict, pid: str) -> dict:
    return procedures.get(pid, {"title": pid, "steps": []})
