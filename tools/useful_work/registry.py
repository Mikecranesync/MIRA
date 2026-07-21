"""Registry for constrained automated-agent useful-work packs."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

REGISTRY_PATH = Path(__file__).with_name("registry.json")


def load_registry(path: str | Path = REGISTRY_PATH) -> dict[str, dict[str, Any]]:
    """Load useful-work pack metadata keyed by worker id."""
    with Path(path).open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise ValueError("useful-work registry must be a JSON object")
    return data
