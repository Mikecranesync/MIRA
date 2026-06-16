"""Shared pytest fixtures for MIRA evaluation framework.

Provides: tmp_db, photo loading, golden case loading, pytest markers.
"""

from __future__ import annotations

import base64
import json
import os
import sys
import tempfile
from pathlib import Path

import pytest
import yaml

# Add mira-bots to path for imports (VisionWorker, Supervisor, etc.)
REPO_ROOT = Path(__file__).parent.parent
MIRA_BOTS = REPO_ROOT / "mira-bots"
if str(MIRA_BOTS) not in sys.path:
    sys.path.insert(0, str(MIRA_BOTS))

TESTS_ROOT = Path(__file__).parent
GOLDEN_VERSION = os.getenv("MIRA_GOLDEN_VERSION", "v1")


# ── Pytest markers ──────────────────────────────────────────────────────────

def pytest_configure(config):
    config.addinivalue_line("markers", "network: requires network access (live services)")
    config.addinivalue_line("markers", "slow: long-running test (>30s)")
    config.addinivalue_line("markers", "regime1: Telethon Replay regime")
    config.addinivalue_line("markers", "regime2: RAG Triplets regime")
    config.addinivalue_line("markers", "regime3: Nameplate Vision regime")
    config.addinivalue_line("markers", "regime4: Synthetic Questions regime")
    config.addinivalue_line("markers", "regime5: Nemotron Bulk regime")


# ── Fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture
def tmp_db_path(tmp_path):
    """Temporary SQLite database path for benchmark_db."""
    return str(tmp_path / "test_benchmark.db")


@pytest.fixture
def sample_tags_dir() -> Path:
    """Path to manufactured sample tag photos."""
    return REPO_ROOT / "mira-bots" / "telegram_test_runner" / "test-assets" / "sample_tags"


@pytest.fixture
def real_photos_dir() -> Path:
    """Path to real factory test photos."""
    return REPO_ROOT / "MIRA test case 1"


@pytest.fixture
def seed_cases() -> list[dict]:
    """Load prejudged seed cases with ground truth."""
    path = REPO_ROOT / "mira-core" / "data" / "seed_cases.json"
    with open(path) as f:
        return json.load(f)


@pytest.fixture
def eval_test_cases() -> list[dict]:
    """Load intent classification eval test cases."""
    path = REPO_ROOT / "mira-bots" / "shared" / "eval" / "test_cases.json"
    with open(path) as f:
        return json.load(f)


# ── Helper functions (not fixtures — importable by regime runners) ──────────

def load_photo_b64(photo_path: str | Path) -> str:
    """Load a photo file and return its base64-encoded content."""
    photo_path = Path(photo_path)
    with open(photo_path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


def load_golden_cases(regime: str, version: str | None = None) -> list[dict]:
    """Load golden cases for a regime from its golden_cases directory.

    Supports YAML and JSON files.
    """
    ver = version or GOLDEN_VERSION
    regime_dir = TESTS_ROOT / regime

    # Find the golden directory (varies by regime name)
    golden_dirs = [
        regime_dir / "golden_cases" / ver,
        regime_dir / "golden_labels" / ver,
        regime_dir / "golden_triplets" / ver,
        regime_dir / "golden_questions" / ver,
        regime_dir / "golden_qa" / ver,
    ]

    cases: list[dict] = []
    for gdir in golden_dirs:
        if not gdir.is_dir():
            continue
        for fpath in sorted(gdir.iterdir()):
            if fpath.suffix in (".yaml", ".yml"):
                with open(fpath) as f:
                    data = yaml.safe_load(f)
                if isinstance(data, dict) and "cases" in data:
                    cases.extend(data["cases"])
                elif isinstance(data, list):
                    cases.extend(data)
            elif fpath.suffix == ".json":
                with open(fpath) as f:
                    data = json.load(f)
                if isinstance(data, list):
                    cases.extend(data)
                elif isinstance(data, dict) and "cases" in data:
                    cases.extend(data["cases"])

    return cases


def load_golden_file(regime: str, filename: str, version: str | None = None) -> dict | list:
    """Load a specific golden file by name."""
    ver = version or GOLDEN_VERSION
    regime_dir = TESTS_ROOT / regime

    # Search all golden_* directories
    for subdir in regime_dir.iterdir():
        if subdir.is_dir() and subdir.name.startswith("golden_"):
            fpath = subdir / ver / filename
            if fpath.exists():
                with open(fpath) as f:
                    if fpath.suffix == ".json":
                        return json.load(f)
                    return yaml.safe_load(f)

    raise FileNotFoundError(f"Golden file not found: {regime}/{filename} (version {ver})")
