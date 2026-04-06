"""Synthetic Questions regime fixtures."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml

from tests.conftest import REPO_ROOT, TESTS_ROOT


@pytest.fixture
def tier_definitions() -> dict:
    """Load tier definitions."""
    path = TESTS_ROOT / "regime4_synthetic" / "tier_definitions.yaml"
    with open(path) as f:
        return yaml.safe_load(f)


@pytest.fixture
def seed_cases() -> list[dict]:
    """Load prejudged seed cases with ground truth."""
    path = REPO_ROOT / "mira-core" / "data" / "seed_cases.json"
    with open(path) as f:
        return json.load(f)
