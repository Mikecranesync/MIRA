"""Nameplate Vision regime fixtures."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from tests.conftest import REPO_ROOT, TESTS_ROOT


@pytest.fixture
def sample_tag_labels() -> list[dict]:
    """Load ground truth labels for manufactured sample tags."""
    path = TESTS_ROOT / "regime3_nameplate" / "golden_labels" / "v1" / "sample_tags.json"
    with open(path) as f:
        data = json.load(f)
    return data["cases"]


@pytest.fixture
def real_photo_labels() -> list[dict]:
    """Load ground truth labels for real factory photos (may be incomplete)."""
    path = TESTS_ROOT / "regime3_nameplate" / "golden_labels" / "v1" / "real_photos.json"
    with open(path) as f:
        data = json.load(f)
    return data["cases"]
