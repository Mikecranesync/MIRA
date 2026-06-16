"""SM Profile loader — reads + validates JSON files from profiles/."""

from __future__ import annotations

import json
from pathlib import Path

from .schema import SmProfile

_PROFILE_DIR = Path(__file__).resolve().parent / "profiles"


def profiles_dir() -> Path:
    return _PROFILE_DIR


def list_profiles() -> list[str]:
    return sorted(p.stem for p in _PROFILE_DIR.glob("*.json"))


def load_profile(name: str) -> SmProfile:
    path = _PROFILE_DIR / f"{name}.json"
    if not path.exists():
        raise FileNotFoundError(f"SM Profile not found: {name}")
    data = json.loads(path.read_text(encoding="utf-8"))
    return SmProfile(**data)


def load_all_profiles() -> dict[str, SmProfile]:
    return {name: load_profile(name) for name in list_profiles()}
