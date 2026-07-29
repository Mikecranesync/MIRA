"""Nameplate Vision regime fixtures."""

from __future__ import annotations

import json

import pytest

from tests.conftest import TESTS_ROOT


@pytest.fixture
def sample_tag_labels() -> list[dict]:
    """Load ground truth labels for manufactured sample tags."""
    path = TESTS_ROOT / "regime3_nameplate" / "golden_labels" / "v1" / "sample_tags.json"
    with open(path) as f:
        data = json.load(f)
    return data["cases"]


@pytest.fixture
def real_photo_labels() -> list[dict]:
    """Load ground truth labels for real factory photos (may be incomplete).

    Customer-project cases live in a gitignored local overlay
    (``real_photos.local.json``) merged when present — the committed file
    stays free of customer identifiers (privacy Bundle 3, 2026-07-16).
    An absent overlay means those cases don't run, exactly like a missing
    photo file.
    """
    path = TESTS_ROOT / "regime3_nameplate" / "golden_labels" / "v1" / "real_photos.json"
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    cases = data["cases"]
    local = path.with_name("real_photos.local.json")
    if local.exists():
        with open(local, encoding="utf-8") as f:
            cases = cases + json.load(f).get("cases", [])
    return cases
