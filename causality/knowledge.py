"""Loader for the synthetic maintenance-knowledge fixture (the citable manual pages + checks)."""
from __future__ import annotations

import json
from pathlib import Path

DEFAULT_KNOWLEDGE = Path(__file__).resolve().parent / "fixtures" / "maintenance_knowledge.json"


def load_knowledge(path: str | Path = DEFAULT_KNOWLEDGE) -> dict:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    data.pop("_comment", None)
    return data


def manual_refs(knowledge: dict, mode_id: str) -> list[dict]:
    return list(knowledge.get(mode_id, {}).get("manual_refs", []))


def checks(knowledge: dict, mode_id: str) -> list[str]:
    return list(knowledge.get(mode_id, {}).get("checks", []))
