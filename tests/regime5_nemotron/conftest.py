"""Nemotron Bulk regime fixtures."""

from __future__ import annotations

import os

import pytest


@pytest.fixture(autouse=True)
def _check_nvidia_key():
    """Skip all Nemotron tests if NVIDIA_API_KEY not available."""
    if not os.getenv("NVIDIA_API_KEY"):
        pytest.skip("Nemotron tests require NVIDIA_API_KEY in Doppler")
