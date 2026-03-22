"""Nemotron Bulk regime fixtures."""

from __future__ import annotations

import os

import pytest


@pytest.fixture
def nvidia_api_key() -> str:
    """Get NVIDIA API key, skip if not available."""
    key = os.getenv("NVIDIA_API_KEY", "")
    if not key:
        pytest.skip("NVIDIA_API_KEY not set — Nemotron live tests skipped")
    return key
