"""RAG Triplets regime fixtures."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from tests.conftest import TESTS_ROOT


@pytest.fixture
def golden_triplets() -> list[dict]:
    """Load golden RAG triplets (if generated)."""
    path = TESTS_ROOT / "regime2_rag" / "golden_triplets" / "v1" / "triplets.json"
    if not path.exists():
        pytest.skip("Golden triplets not yet generated — run generate_triplets.py first")
    with open(path) as f:
        data = json.load(f)
    return data.get("triplets", data) if isinstance(data, dict) else data
