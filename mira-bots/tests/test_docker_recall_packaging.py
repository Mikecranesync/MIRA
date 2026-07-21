"""Docker packaging guard for the production recall gate.

``shared.print_recall`` imports ``materialized_evidence`` + ``printsense.recall``.
The bot images already ship ``printsense/`` but NOT ``materialized_evidence/`` — so
without a COPY the recall import fails and the gate silently disables (falls through
to paying the model every time). This test fails CI instead of shipping that
regression, on both the telegram and slack images.
"""

from __future__ import annotations

import importlib
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[2]
_DOCKERFILES = [
    _ROOT / "mira-bots" / "telegram" / "Dockerfile",
    _ROOT / "mira-bots" / "slack" / "Dockerfile",
]


@pytest.mark.parametrize("dockerfile", _DOCKERFILES, ids=lambda p: p.parent.name)
def test_bot_image_ships_recall_packages(dockerfile: Path):
    text = dockerfile.read_text("utf-8")
    assert "COPY materialized_evidence/" in text, (
        f"{dockerfile} must COPY materialized_evidence/ — without it "
        "shared.print_recall's import fails and recall silently disables"
    )
    assert "COPY printsense/" in text, (
        f"{dockerfile} must COPY printsense/ — printsense.recall needs it"
    )


def test_recall_packages_import_clean():
    # If the images ship these (above), the in-container import must succeed. Proving
    # the packages are import-clean here is the other half of the packaging guarantee.
    assert importlib.import_module("materialized_evidence")
    assert importlib.import_module("printsense.recall")
