"""Ensures the pinned model is present locally before any test imports `app`.

Mirrors the Docker build-time fetch (`fetch_model.py`) but caches across test
runs in a tmp directory so repeated local `pytest` invocations don't
re-download ~90MB every time. Runs at collection time, before test modules
import `app`, so `app.MODEL_DIR` resolves to the cached, verified copy.
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

_HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_HERE))

import fetch_model  # noqa: E402

_CACHE_DIR = Path(
    os.environ.get(
        "MIRA_RERANKER_MODEL_CACHE",
        Path(tempfile.gettempdir()) / "mira-reranker-model-cache" / "ms-marco-MiniLM-L-6-v2",
    )
)


def _already_verified(expected: dict[str, str]) -> bool:
    for rel_path, want in expected.items():
        dest = _CACHE_DIR / rel_path
        if not dest.exists():
            return False
        if fetch_model.sha256_of(dest) != want:
            return False
    return True


def _ensure_model_cached() -> Path:
    sha_file = _HERE / "MODEL_SHA256"
    expected = fetch_model.load_expected_hashes(sha_file)
    if not _already_verified(expected):
        os.environ["MODEL_DIR"] = str(_CACHE_DIR)
        fetch_model.main()
    return _CACHE_DIR


os.environ["MODEL_DIR"] = str(_ensure_model_cached())
